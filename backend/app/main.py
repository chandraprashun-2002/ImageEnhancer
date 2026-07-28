"""FastAPI app for Real-ESRGAN image enhancement (CPU)."""

from __future__ import annotations

import asyncio
import uuid
from pathlib import Path

from . import torchvision_compat  # noqa: F401 — must run before basicsr

import cv2
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from .config import (
    ALLOWED_CONTENT_TYPES,
    ALLOWED_EXTENSIONS,
    MAX_MEGAPIXELS,
    MAX_UPLOAD_BYTES,
    MODEL_FILENAME,
    MODEL_PATH,
    OUTPUTS_DIR,
    RESOLUTION_TIERS,
    UPLOADS_DIR,
)
from .enhancer import enhance_image, get_device, maybe_downscale_for_cpu, weights_present
from .resolution import compute_outscale

UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
OUTPUTS_DIR.mkdir(parents=True, exist_ok=True)

app = FastAPI(title="Image Enhancer", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/files/uploads", StaticFiles(directory=str(UPLOADS_DIR)), name="uploads")
app.mount("/files/outputs", StaticFiles(directory=str(OUTPUTS_DIR)), name="outputs")


@app.get("/api/health")
def health():
    present = weights_present()
    return {
        "status": "ok" if present else "degraded",
        "device": get_device(),
        "weights_present": present,
        "weights_path": MODEL_PATH.as_posix(),
        "expected_filename": MODEL_FILENAME,
        "message": (
            "Ready"
            if present
            else f"Place {MODEL_FILENAME} in weights/ before enhancing."
        ),
    }


def _validate_upload(file: UploadFile, data: bytes) -> str:
    if not data:
        raise HTTPException(status_code=400, detail="Empty file.")
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(
            status_code=400,
            detail=f"File too large. Max {MAX_UPLOAD_BYTES // (1024 * 1024)} MB.",
        )

    filename = file.filename or "upload.png"
    ext = Path(filename).suffix.lower()
    content_type = (file.content_type or "").lower()

    if ext not in ALLOWED_EXTENSIONS and content_type not in ALLOWED_CONTENT_TYPES:
        raise HTTPException(
            status_code=400,
            detail="Unsupported image type. Use JPG, PNG, or WebP.",
        )

    if not ext or ext not in ALLOWED_EXTENSIONS:
        if "png" in content_type:
            ext = ".png"
        elif "webp" in content_type:
            ext = ".webp"
        else:
            ext = ".jpg"

    return ext


@app.post("/api/enhance")
async def enhance(
    file: UploadFile = File(...),
    target_p: int = Form(...),
):
    if target_p not in RESOLUTION_TIERS:
        raise HTTPException(
            status_code=400,
            detail=f"target_p must be one of: {', '.join(str(t) for t in RESOLUTION_TIERS)}.",
        )

    if not weights_present():
        raise HTTPException(
            status_code=503,
            detail=(
                f"Model weights not found. Place '{MODEL_FILENAME}' in the "
                f"weights/ folder and try again."
            ),
        )

    data = await file.read()
    ext = _validate_upload(file, data)

    job_id = uuid.uuid4().hex
    input_path = UPLOADS_DIR / f"{job_id}{ext}"
    output_path = OUTPUTS_DIR / f"{job_id}_enhanced.png"

    input_path.write_bytes(data)

    # Optional CPU-friendly downscale before upscaling
    img = cv2.imread(str(input_path), cv2.IMREAD_UNCHANGED)
    if img is None:
        input_path.unlink(missing_ok=True)
        raise HTTPException(status_code=400, detail="Could not decode image.")

    resized = maybe_downscale_for_cpu(img, MAX_MEGAPIXELS)
    if resized is not img:
        cv2.imwrite(str(input_path), resized)
        img = resized

    height, width = img.shape[:2]
    outscale, current_tier, short = compute_outscale(width, height, target_p)

    # CPU inference is blocking — run in a worker thread so the event loop stays alive.
    await asyncio.to_thread(enhance_image, input_path, output_path, outscale)

    out_img = cv2.imread(str(output_path), cv2.IMREAD_UNCHANGED)
    out_h, out_w = (out_img.shape[:2] if out_img is not None else (0, 0))

    return {
        "id": job_id,
        "target_p": target_p,
        "scale": round(outscale, 4),
        "original_size": {"width": width, "height": height},
        "current_tier": current_tier,
        "short_side": short,
        "output_size": {"width": out_w, "height": out_h},
        "original_url": f"/files/uploads/{input_path.name}",
        "enhanced_url": f"/files/outputs/{output_path.name}",
        "download_url": f"/api/download/{job_id}",
    }


@app.get("/api/download/{job_id}")
def download(job_id: str):
    # Prevent path traversal
    if not job_id.isalnum() or len(job_id) > 64:
        raise HTTPException(status_code=400, detail="Invalid job id.")

    path = OUTPUTS_DIR / f"{job_id}_enhanced.png"
    if not path.is_file():
        raise HTTPException(status_code=404, detail="Enhanced image not found.")

    return FileResponse(
        path,
        media_type="image/png",
        filename=f"enhanced_{job_id}.png",
    )


@app.on_event("startup")
def ensure_dirs():
    UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
    OUTPUTS_DIR.mkdir(parents=True, exist_ok=True)
