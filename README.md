# Clarity — Local Image Enhancer

Clarity is a lightweight local web app for sharpening and upscaling photos with Real-ESRGAN on CPU. It runs entirely on your machine, does not require a cloud account, and keeps the full workflow in a simple browser UI.

This project is composed of:

- a FastAPI backend that validates uploads, computes enhancement scale, and runs Real-ESRGAN inference
- a React + Vite frontend that lets users preview before/after results and compare image output interactively
- a local `weights/` folder where the pretrained `RealESRGAN_x4plus.pth` model must be placed manually

## What the app does

- accepts JPG, PNG, and WebP uploads
- reads image dimensions and determines the current resolution tier from the shorter side
- lets users choose a higher target resolution from a fixed list: 240, 360, 480, 720, 1080, 1440, 2160
- computes the Real-ESRGAN outscale as `target_p / min(width, height)`
- resizes large images down before inference when needed to keep CPU memory usage more manageable
- saves the enhanced output as a PNG and exposes a file download endpoint
- provides a demo comparison slider so the app can be tested without uploading a photo

## Project architecture

### Backend

The backend is implemented in `backend/app` and uses:

- FastAPI for the HTTP API
- OpenCV for image pre-processing and output writing
- Real-ESRGAN and BasicSR for super-resolution
- a module-level lock around the loaded model to serialize inference safely

Important runtime behavior from the code:

- the app exposes `GET /api/health` to report backend status, device, and whether weights are available
- it validates uploads for size and extension
- it rejects unsupported file types and empty uploads
- it enforces a maximum upload size of 15 MB
- it automatically downscales oversized images to roughly 6 megapixels before running enhancement
- output is written under `outputs/` and served via `/files/outputs`

### Frontend

The frontend under `frontend/src` uses:

- React 19
- Vite 8
- Tailwind CSS 4

It includes:

- a demo comparison view
- an upload panel with drag-and-drop support
- target resolution selection based on current image size
- a before/after drag slider
- elapsed-time indicator while enhancement runs
- health detection for the backend status

## Repository structure

```text
ImageEnhancer/
├── backend/
│   ├── app/
│   │   ├── __init__.py
│   │   ├── config.py
│   │   ├── enhancer.py
│   │   ├── main.py
│   │   ├── resolution.py
│   │   └── torchvision_compat.py
│   ├── requirements.txt
│   └── ...
├── frontend/
│   ├── src/
│   ├── public/
│   ├── index.html
│   ├── package.json
│   ├── vite.config.js
│   └── README.md
├── weights/
│   └── README.md
├── uploads/
├── outputs/
├── README.md
└── .gitignore
```

## Prerequisites

Before running the app, install:

- Python 3.10 or newer
- Node.js 18 or newer
- a Real-ESRGAN model file placed at:

```text
weights/RealESRGAN_x4plus.pth
```

Download the model from the official Real-ESRGAN release and place it in the `weights/` folder. The app does not download the model automatically.

## Setup

### 1) Create and activate a Python environment

From the project root:

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
```

On Windows PowerShell, use:

```powershell
cd backend
py -m venv .venv
.\.venv\Scripts\Activate.ps1
```

### 2) Install Python dependencies

```bash
pip install --upgrade pip
pip install -r requirements.txt
```

The backend requirements include FastAPI, Uvicorn, OpenCV, NumPy, Pillow, BasicSR, and Real-ESRGAN.

### 3) Download the model weights

Place the official file here:

```text
weights/RealESRGAN_x4plus.pth
```

### 4) Start the backend

```bash
cd backend
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

Check health at:

```text
http://127.0.0.1:8000/api/health
```

The health response includes:

- `status`
- `device`
- `weights_present`
- `weights_path`
- `message`

### 5) Install frontend dependencies

Open a second terminal and run:

```bash
cd frontend
npm install
```

### 6) Start the frontend

```bash
npm run dev
```

Then open the Vite URL printed in the terminal, typically:

```text
http://127.0.0.1:5173
```

The frontend is configured with a dev proxy:

- `/api` -> `http://127.0.0.1:8000`
- `/files` -> `http://127.0.0.1:8000`

## How the app decides the target scale

The backend computes the Real-ESRGAN `outscale` from the requested target resolution and the shorter image side:

```python
short_side = min(width, height)
outscale = target_p / short_side
```

Example:

- image is 447 × 447
- target is 720p
- short side is 447
- `outscale = 720 / 447 ≈ 1.61`

The app enforces these resolution tiers:

```text
240, 360, 480, 720, 1080, 1440, 2160
```

And it keeps the enhancement within the Real-ESRGAN x4plus limit, which is why the UI blocks options that would require more than 4× scale.

## Usage flow

1. Open the app in the browser.
2. Choose the demo preview or upload your own image.
3. The app reads the image dimensions and shows the current resolution tier.
4. Select a higher target resolution from the dropdown.
5. Click the enhance button.
6. When processing finishes, compare the original and enhanced versions using the before/after slider.
7. Download the generated PNG file.

## API reference

### Health check

```http
GET /api/health
```

Response example:

```json
{
  "status": "ok",
  "device": "cpu",
  "weights_present": true,
  "weights_path": "/absolute/path/to/weights/RealESRGAN_x4plus.pth",
  "expected_filename": "RealESRGAN_x4plus.pth",
  "message": "Ready"
}
```

### Enhance image

```http
POST /api/enhance
```

Form fields:

- `file`: uploaded image file
- `target_p`: target short-side resolution, such as 720

Response example:

```json
{
  "id": "d6ef2d3d0b884bb0bbd6a9d880b2ef8c",
  "target_p": 720,
  "scale": 1.61,
  "original_size": { "width": 447, "height": 447 },
  "current_tier": 360,
  "short_side": 447,
  "output_size": { "width": 720, "height": 720 },
  "original_url": "/files/uploads/d6ef2d3d0b884bb0bbd6a9d880b2ef8c.jpg",
  "enhanced_url": "/files/outputs/d6ef2d3d0b884bb0bbd6a9d880b2ef8c_enhanced.png",
  "download_url": "/api/download/d6ef2d3d0b884bb0bbd6a9d880b2ef8c"
}
```

### Download output

```http
GET /api/download/{job_id}
```

Returns the enhanced PNG file with a generated filename.

## Operational notes and limitations

- uploaded files are limited to 15 MB
- images are validated for JPG, PNG, and WebP
- the app uses a maximum effective input size of around 6 megapixels before inference to reduce CPU and RAM strain
- Real-ESRGAN is configured with a tile size of 400 and a tile pad of 10
- inference is serialized via a lock in the backend so model access is safe on a single machine
- the app currently targets CPU inference only; the device is reported as `cpu`
- model weights are not downloaded automatically; the user must add them manually

## Troubleshooting

### The app says weights are missing

Make sure the file exists at:

```text
weights/RealESRGAN_x4plus.pth
```

Then restart the backend.

### The frontend cannot reach the API

Check that the backend is running on port 8000 and that the frontend dev server is running on port 5173.

### Enhancement is slow

This is expected on CPU. Large images can take tens of seconds to several minutes depending on dimensions and the requested target resolution.

### The target resolution dropdown is empty or blocked

Your image is already at or above that tier, or the target would require more than the x4plus model limit. Choose a higher target that stays within the allowed range for that image.

## Useful commands

```bash
# backend
cd backend
source .venv/bin/activate
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000

# frontend
cd frontend
npm install
npm run dev
```

## Summary

Clarity is a compact local image-upscaling tool designed around Real-ESRGAN x4plus, FastAPI, and React. It is built for personal use, privacy, and local processing rather than online inference, making it useful for quick on-device enhancement without external services.
