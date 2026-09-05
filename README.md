# Jewellery Try On (2D)

Try on necklaces, earrings, rings, and bangles in real-time using your camera. Everything runs in the browser — no photos or data ever leave your device.

## What is this?

A lightweight **2D virtual try-on** for jewellery. Uses MediaPipe (face, hand, pose tracking) + Canvas 2D to overlay PNG/JPG jewellery images onto your live camera feed. No 3D models, no build step, no backend required.

## Quick Start

```bash
# Option 1: Python server (supports upload feature)
python app.py

# Option 2: Any static server
python -m http.server 8000
# or
npx serve
```

Then open **http://localhost:8000** (or the port shown).

> **Camera requires HTTPS or `localhost`** — won't work on plain HTTP.

## Add Your Jewellery

1. Create a folder under `objects/` (e.g., `objects/my-ring/`)
2. Add images:
   - `jewellery.png` — transparent PNG overlay (preferred)
   - `demo.jpg` — thumbnail for the homepage grid
3. Add the folder name to `objects/index.json`:
   ```json
   { "items": ["necklace-gold", "my-ring"] }
   ```
4. Reload the page.

### Ring & Bangle need 2 images:
- `front.png` — camera-facing side
- `back.png` — behind finger/wrist side

## Upload via UI

1. Click **"Upload your own jewellery"** on the homepage
2. Choose category (Necklace, Earring, Ring, Bangle)
3. Pick image(s) — background is auto-removed if needed
4. Name it → saved to `objects/` permanently

## URL Options

| Parameter | Effect |
|-----------|--------|
| `?category=ring` | Show only rings |
| `?item=ring-band` | Auto-select that piece |
| `?tune=1` | Show positioning sliders |
| `?debug=1` | On-screen console (mobile) |
| `?anchors=1` | Draw tracking dots |

## Project Structure

```
├── index.html          # Main page
├── app.js              # UI, camera, catalogue
├── engine2d.js         # Landmark placement + Canvas 2D overlay
├── mediapipe.js        # Face/hand/pose tracking (CDN)
├── bg-removal.js       # Client-side background removal (CDN)
├── tuning.js           # ?tune=1 sliders
├── style.css           # Styling
├── app.py              # Static server + /api/upload endpoint
├── objects/            # Jewellery images + thumbnails
│   └── index.json      # Catalogue manifest
└── requirements.txt    # Optional: Pillow for asset generation
```

## Requirements

- Modern browser (Chrome, Firefox, Safari, Edge)
- Camera permission
- HTTPS or `localhost`

## License

MIT — free to use, modify, distribute.