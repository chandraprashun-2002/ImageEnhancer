"""Real-ESRGAN CPU enhancer — loads weights from weights/ (no auto-download)."""

from __future__ import annotations

import threading
from pathlib import Path

from . import torchvision_compat  # noqa: F401 — must run before basicsr

import cv2
import numpy as np
import torch
from basicsr.archs.rrdbnet_arch import RRDBNet
from fastapi import HTTPException
from realesrgan import RealESRGANer

from .config import MODEL_PATH, TILE_PAD, TILE_SIZE

_lock = threading.Lock()
_upsampler: RealESRGANer | None = None


def weights_present() -> bool:
    return MODEL_PATH.is_file()


def get_device() -> str:
    return "cpu"


def _build_upsampler() -> RealESRGANer:
    if not weights_present():
        raise HTTPException(
            status_code=503,
            detail=(
                f"Model weights not found. Place '{MODEL_PATH.name}' in "
                f"'{MODEL_PATH.parent.as_posix()}/' and restart the server."
            ),
        )

    # RealESRGAN_x4plus architecture
    model = RRDBNet(
        num_in_ch=3,
        num_out_ch=3,
        num_feat=64,
        num_block=23,
        num_grow_ch=32,
        scale=4,
    )

    return RealESRGANer(
        scale=4,
        model_path=str(MODEL_PATH),
        model=model,
        tile=TILE_SIZE,
        tile_pad=TILE_PAD,
        pre_pad=0,
        half=False,
        device=torch.device("cpu"),
    )


def get_upsampler() -> RealESRGANer:
    """Load the model once. Safe to call while not already holding _lock."""
    global _upsampler
    with _lock:
        if _upsampler is None:
            _upsampler = _build_upsampler()
        return _upsampler


def enhance_image(input_path: Path, output_path: Path, outscale: float = 4.0) -> Path:
    """Enhance an image on CPU. outscale is overall size multiplier (any float > 1)."""
    if outscale <= 1:
        raise HTTPException(status_code=400, detail="outscale must be greater than 1.")

    img = cv2.imread(str(input_path), cv2.IMREAD_UNCHANGED)
    if img is None:
        raise HTTPException(status_code=400, detail="Could not read uploaded image.")

    # Hold the lock for load + inference only (never nest Lock acquires).
    with _lock:
        global _upsampler
        if _upsampler is None:
            _upsampler = _build_upsampler()
        try:
            output, _ = _upsampler.enhance(img, outscale=float(outscale))
        except Exception as exc:  # noqa: BLE001 — surface ML errors to API
            raise HTTPException(
                status_code=500,
                detail=f"Enhancement failed: {exc}",
            ) from exc

    output_path.parent.mkdir(parents=True, exist_ok=True)
    ok = cv2.imwrite(str(output_path), output)
    if not ok:
        raise HTTPException(status_code=500, detail="Failed to write enhanced image.")
    return output_path


def maybe_downscale_for_cpu(img_bgr: np.ndarray, max_megapixels: float) -> np.ndarray:
    h, w = img_bgr.shape[:2]
    mp = (h * w) / 1_000_000
    if mp <= max_megapixels:
        return img_bgr
    scale = (max_megapixels / mp) ** 0.5
    new_w = max(1, int(w * scale))
    new_h = max(1, int(h * scale))
    return cv2.resize(img_bgr, (new_w, new_h), interpolation=cv2.INTER_AREA)
