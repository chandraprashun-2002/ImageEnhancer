# Clarity — Image Enhancer

Local web app that sharpens and upscales photos with **Real-ESRGAN** on **CPU**.  
No cloud account — runs entirely on your machine.

## Features

- Interactive **before / after** demo slider on first load
- Upload JPG, PNG, or WebP and pick a **target resolution** (240p–2160p)
- Shows image **length**, **breadth**, and current resolution tier
- Upscale factor is computed as `target_p ÷ min(width, height)` and passed to Real-ESRGAN
- Progress overlay with elapsed time while enhancing
- Responsive UI for mobile, tablet, and desktop (React + Vite + Tailwind CSS)

## What you need

1. Python 3.10+
2. Node.js 18+
3. Model weights (you add this yourself):

```
weights/RealESRGAN_x4plus.pth
```

Download from the [Real-ESRGAN releases](https://github.com/xinntao/Real-ESRGAN/releases/download/v0.1.0/RealESRGAN_x4plus.pth) and place the file in `weights/`. The app does **not** download weights automatically.

## Project layout

```
imageInhancer/
  backend/          FastAPI + Real-ESRGAN (CPU)
  frontend/         Vite + React + Tailwind UI
  weights/          Put RealESRGAN_x4plus.pth here
  uploads/          Temp uploads
  outputs/          Enhanced images
```

## Backend setup

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\activate
pip install torch torchvision --index-url https://download.pytorch.org/whl/cpu
pip install -r requirements.txt
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

Health check: [http://127.0.0.1:8000/api/health](http://127.0.0.1:8000/api/health)

## Frontend setup

In a second terminal:

```powershell
cd frontend
npm install
npm run dev
```

Open the URL Vite prints (usually [http://127.0.0.1:5173](http://127.0.0.1:5173)).  
API calls are proxied to the backend (`/api` and `/files`).

**Run order:** start the backend first, then the frontend. If port 8000 is down, the UI shows a backend-offline message.

## Usage

1. Drag the demo slider to preview a sample enhance
2. Click **Try with your photo** and upload an image
3. Review **Length**, **Breadth**, and current resolution (e.g. `360p`)
4. Choose a higher **target resolution** from the dropdown (current tier and below are disabled; options needing more than 4× are also blocked)
5. Click **Enhance to Xp**
6. Compare with the before/after slider, then download the PNG

CPU enhancement can take from tens of seconds to several minutes depending on image size.

## How resolution → scale works

Real-ESRGAN takes an overall scale factor (`outscale`), not a “720p” label.

```
short_side = min(length, breadth)
outscale   = target_p / short_side
```

Example: `447 × 447` image, target `720p` → `outscale ≈ 1.61`.

Allowed targets: **240, 360, 480, 720, 1080, 1440, 2160**.  
Maximum upscale is **4×** (limit of the x4plus model on this CPU setup).

## API

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/health` | Status, device, whether weights are present |
| POST | `/api/enhance` | Multipart form: `file`, `target_p` (one of the tiers above) |
| GET | `/api/download/{id}` | Download enhanced PNG |

### Enhance response (shape)

```json
{
  "id": "...",
  "target_p": 720,
  "scale": 1.61,
  "original_size": { "width": 447, "height": 447 },
  "output_size": { "width": 720, "height": 720 },
  "original_url": "/files/uploads/....jpg",
  "enhanced_url": "/files/outputs/....png",
  "download_url": "/api/download/..."
}
```

## Notes

- Large inputs are auto-capped (~6 megapixels) before upscaling to keep CPU/RAM usable.
- Inference uses tiled Real-ESRGAN (tile size 400).
- Only one enhance job runs at a time on this machine.
- Frontend stack: React 19, Vite 8, Tailwind CSS 4.
