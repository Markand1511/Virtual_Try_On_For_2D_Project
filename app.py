#!/usr/bin/env python3
"""Static file server for the 2D jewellery try-on app (same role as python -m http.server),
plus a small local-only /api/upload endpoint that lets the "Upload Your Jewellery" flow
persist a new item into objects/<folder>/ and objects/index.json on disk."""
from __future__ import annotations

import argparse
import functools
import json
import os
import re
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent
OBJECTS_DIR = ROOT / "objects"
INDEX_JSON = OBJECTS_DIR / "index.json"

CATEGORY_FOLDER_PREFIX = {
    "necklace": "necklace",
    "earring": "earring",
    "ring": "ring",
    "bangles": "bangles",
}

# Matches the extension sniffing already done client-side in engine2d.js
ALLOWED_EXTENSIONS = {".png", ".jpg", ".jpeg"}
MAX_UPLOAD_BYTES = 12 * 1024 * 1024  # keep in step with engine2d.js's own 12MB cap

PNG_MAGIC = b"\x89PNG\r\n\x1a\n"
JPEG_MAGIC = b"\xff\xd8\xff"


def _safe_slug(name: str) -> str:
    """Filesystem-safe slug for a folder/name fragment. Never empty."""
    slug = re.sub(r"[^a-zA-Z0-9]+", "-", (name or "").strip().lower()).strip("-")
    return slug or "custom"


def _unique_folder_name(base: str) -> str:
    """Never overwrite an existing objects/ folder — append -2, -3, ... until free."""
    candidate = base
    n = 2
    while (OBJECTS_DIR / candidate).exists():
        candidate = f"{base}-{n}"
        n += 1
    return candidate


def _sniff_extension(raw: bytes, declared_ext: str) -> str | None:
    if raw.startswith(PNG_MAGIC):
        return ".png"
    if raw.startswith(JPEG_MAGIC):
        return ".jpg"
    # Fall back to the declared extension only if it's one we allow — belt & suspenders
    return declared_ext if declared_ext in ALLOWED_EXTENSIONS else None


def _load_index() -> dict:
    if INDEX_JSON.exists():
        try:
            with INDEX_JSON.open("r", encoding="utf-8") as f:
                data = json.load(f)
            if isinstance(data, dict) and isinstance(data.get("items"), list):
                return data
        except (OSError, json.JSONDecodeError):
            pass
    return {"items": []}


def _save_index(data: dict) -> None:
    tmp = INDEX_JSON.with_suffix(".json.tmp")
    with tmp.open("w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)
        f.write("\n")
    tmp.replace(INDEX_JSON)


class ApiError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status
        self.message = message


class NoCacheHandler(SimpleHTTPRequestHandler):
    def end_headers(self) -> None:
        self.send_header("Cache-Control", "no-cache, must-revalidate")
        self.send_header("Access-Control-Allow-Origin", "*")
        super().end_headers()

    def log_message(self, fmt: str, *args) -> None:
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))

    def do_OPTIONS(self) -> None:  # CORS preflight, harmless for same-origin use too
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header(
            "Access-Control-Allow-Headers",
            "Content-Type, X-Jewellery-Name, X-Jewellery-Category, X-Jewellery-Ext, "
            "X-Jewellery-Layer, X-Jewellery-Folder",
        )
        self.end_headers()

    def do_POST(self) -> None:
        if self.path.split("?", 1)[0].rstrip("/") == "/api/upload":
            self._handle_upload()
        else:
            self.send_error(404, "Not found")

    def _send_json(self, status: int, payload: dict) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def _read_body(self) -> bytes:
        length = int(self.headers.get("Content-Length", "0"))
        if length <= 0:
            raise ApiError(400, "No file was received.")
        if length > MAX_UPLOAD_BYTES:
            raise ApiError(400, "Image is too large (max 12 MB).")
        return self.rfile.read(length)

    def _extract_image(self, declared_ext: str) -> tuple[bytes, str]:
        raw = self._read_body()
        if declared_ext and not declared_ext.startswith("."):
            declared_ext = f".{declared_ext}"
        ext = _sniff_extension(raw, declared_ext)
        if not ext:
            raise ApiError(400, "Only PNG, JPG and JPEG images are supported.")
        return raw, ext

    def _handle_upload(self) -> None:
        try:
            layer = (self.headers.get("X-Jewellery-Layer") or "").strip().lower()
            if layer == "back":
                self._handle_upload_ring_back()
            else:
                self._handle_upload_single(ring_front=(layer == "front"))
        except ApiError as err:
            self._send_json(err.status, {"ok": False, "error": err.message})
        except Exception as err:  # noqa: BLE001 - last-resort guard, must not leak a traceback to the client
            sys.stderr.write(f"[upload] unexpected error: {err!r}\n")
            self._send_json(500, {"ok": False, "error": "Upload failed. Please try again."})

    def _handle_upload_single(self, ring_front: bool) -> None:
        """Plain single-image upload (necklace/earring/bangles), OR the first
        half of a ring upload (front.png) when ring_front is True — in that
        case the folder is created here and the second POST (X-Jewellery-
        Layer: back) fills in back.png + finalises the index.json entry."""
        declared_ext = (self.headers.get("X-Jewellery-Ext") or "").strip().lower()
        raw, ext = self._extract_image(declared_ext)

        category = (self.headers.get("X-Jewellery-Category") or "").strip().lower()
        if category not in CATEGORY_FOLDER_PREFIX:
            raise ApiError(400, "Please choose a valid jewellery category.")

        declared_name = (self.headers.get("X-Jewellery-Name") or "").strip()

        prefix = CATEGORY_FOLDER_PREFIX[category]
        name_slug = _safe_slug(declared_name) if declared_name else "custom"
        # e.g. ring + "My Gold Ring" -> ring-my-gold-ring ; ring + "" -> ring-custom
        base_folder = f"{prefix}-{name_slug}" if name_slug != prefix else prefix
        base_folder = _safe_slug(base_folder)
        folder_name = _unique_folder_name(base_folder)

        folder_path = OBJECTS_DIR / folder_name
        folder_path.mkdir(parents=True, exist_ok=False)
        label = declared_name or folder_name.replace("-", " ").title()

        if ring_front:
            # Ring front photo only — no index.json entry yet. It's added once
            # the matching back photo arrives, so the item never shows on the
            # homepage half-finished (missing back.png).
            (folder_path / "front.png" if ext == ".png" else folder_path / f"front{ext}").write_bytes(raw)
            front_name = "front.png" if ext == ".png" else f"front{ext}"
            self._send_json(200, {
                "ok": True,
                "folder": folder_name,
                "front": front_name,
                "category": category,
                "label": label,
                "awaitingBack": True,
            })
            return

        asset_name = f"jewellery{ext}"
        (folder_path / asset_name).write_bytes(raw)

        index_data = _load_index()
        index_data["items"].append({
            "folder": folder_name,
            "model": asset_name,
            "image": asset_name,
            "category": category,
            "label": label,
        })
        try:
            _save_index(index_data)
        except OSError as err:
            # Roll back the folder so a half-done upload doesn't linger
            try:
                (folder_path / asset_name).unlink(missing_ok=True)
                folder_path.rmdir()
            except OSError:
                pass
            raise ApiError(500, "Could not update the jewellery catalogue. Please try again.") from err

        self._send_json(200, {
            "ok": True,
            "folder": folder_name,
            "asset": asset_name,
            "category": category,
            "label": label,
        })

    def _handle_upload_ring_back(self) -> None:
        """Second half of a ring upload: saves back.png into the folder the
        front-photo request created, then finalises the index.json entry so
        the ring only ever appears once both photos exist."""
        declared_ext = (self.headers.get("X-Jewellery-Ext") or "").strip().lower()
        raw, ext = self._extract_image(declared_ext)

        folder_name = (self.headers.get("X-Jewellery-Folder") or "").strip()
        # Folder names are generated server-side (see _unique_folder_name) —
        # re-validate the shape rather than trusting the client's echo of it.
        if not folder_name or not re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", folder_name):
            raise ApiError(400, "Missing or invalid ring folder — please start the upload again.")

        folder_path = OBJECTS_DIR / folder_name
        if not folder_path.is_dir() or not folder_path.is_relative_to(OBJECTS_DIR):
            raise ApiError(400, "Ring folder not found — please start the upload again.")

        front_candidates = [p for p in folder_path.glob("front.*") if p.suffix.lower() in ALLOWED_EXTENSIONS]
        if not front_candidates:
            raise ApiError(400, "Front photo is missing — please start the upload again.")
        front_name = front_candidates[0].name

        back_name = "back.png" if ext == ".png" else f"back{ext}"
        (folder_path / back_name).write_bytes(raw)

        category = (self.headers.get("X-Jewellery-Category") or "ring").strip().lower()
        declared_name = (self.headers.get("X-Jewellery-Name") or "").strip()
        label = declared_name or folder_name.replace("-", " ").title()

        index_data = _load_index()
        index_data["items"].append({
            "folder": folder_name,
            "front": front_name,
            "back": back_name,
            "category": category,
            "label": label,
        })
        try:
            _save_index(index_data)
        except OSError as err:
            try:
                (folder_path / back_name).unlink(missing_ok=True)
            except OSError:
                pass
            raise ApiError(500, "Could not update the jewellery catalogue. Please try again.") from err

        self._send_json(200, {
            "ok": True,
            "folder": folder_name,
            "front": front_name,
            "back": back_name,
            "category": category,
            "label": label,
        })


def main() -> None:
    parser = argparse.ArgumentParser(description="Serve Jewellery Try On (2D) over HTTP")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8000)
    args = parser.parse_args()

    os.chdir(ROOT)
    handler = functools.partial(NoCacheHandler, directory=str(ROOT))
    server = ThreadingHTTPServer((args.host, args.port), handler)
    print(f"Jewellery Try On (2D)")
    print(f"Serving {ROOT}")
    print(f"Open http://{args.host}:{args.port}/")
    print("Camera needs localhost or HTTPS. Ctrl+C to stop.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")
        server.server_close()


if __name__ == "__main__":
    main()
