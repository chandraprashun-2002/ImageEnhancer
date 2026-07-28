from pathlib import Path

# Project root: imageInhancer/
ROOT_DIR = Path(__file__).resolve().parents[2]
WEIGHTS_DIR = ROOT_DIR / "weights"
UPLOADS_DIR = ROOT_DIR / "uploads"
OUTPUTS_DIR = ROOT_DIR / "outputs"

MODEL_FILENAME = "RealESRGAN_x4plus.pth"
MODEL_PATH = WEIGHTS_DIR / MODEL_FILENAME

# CPU-friendly limits
MAX_UPLOAD_BYTES = 15 * 1024 * 1024  # 15 MB
MAX_MEGAPIXELS = 6.0
ALLOWED_CONTENT_TYPES = {
    "image/jpeg",
    "image/jpg",
    "image/png",
    "image/webp",
}
ALLOWED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp"}
# Kept for reference; enhance now uses target_p → outscale
ALLOWED_SCALES = {2, 4}

# Resolution tiers (short-side pixels) for target_p
RESOLUTION_TIERS = (240, 360, 480, 720, 1080, 1440, 2160)
# RealESRGAN_x4plus is a 4× model; outscale above this is CPU-heavy / low quality
MAX_OUTSCALE = 4.0

# Real-ESRGAN tile size (lower = less RAM, slower)
TILE_SIZE = 400
TILE_PAD = 10
