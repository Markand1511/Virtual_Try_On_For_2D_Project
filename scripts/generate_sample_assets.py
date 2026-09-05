#!/usr/bin/env python3
"""Generate simple transparent PNG jewellery samples + demo previews."""
from __future__ import annotations

import math
import struct
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OBJECTS = ROOT / "objects"

GOLD = (197, 164, 100, 255)
GOLD_LIGHT = (230, 215, 180, 255)
GOLD_DARK = (126, 103, 51, 255)
DIAMOND = (200, 230, 255, 230)
HOOP = (212, 175, 55, 255)


def png_chunk(tag: bytes, data: bytes) -> bytes:
    return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)


def write_png(path: Path, width: int, height: int, rgba: list[int]) -> None:
    """rgba: flat list length width*height*4"""
    raw = bytearray()
    stride = width * 4
    for y in range(height):
        raw.append(0)  # filter none
        start = y * stride
        raw.extend(rgba[start : start + stride])
    compressed = zlib.compress(bytes(raw), 9)
    ihdr = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(
        b"\x89PNG\r\n\x1a\n"
        + png_chunk(b"IHDR", ihdr)
        + png_chunk(b"IDAT", compressed)
        + png_chunk(b"IEND", b"")
    )


def blank(w: int, h: int) -> list[int]:
    return [0] * (w * h * 4)


def set_px(buf: list[int], w: int, x: int, y: int, rgba: tuple[int, int, int, int]) -> None:
    if x < 0 or y < 0 or x >= w:
        return
    h = len(buf) // (w * 4)
    if y >= h:
        return
    i = (y * w + x) * 4
    buf[i : i + 4] = list(rgba)


def blend(buf: list[int], w: int, x: int, y: int, rgba: tuple[int, int, int, int]) -> None:
    if x < 0 or y < 0 or x >= w:
        return
    h = len(buf) // (w * 4)
    if y >= h:
        return
    i = (y * w + x) * 4
    sr, sg, sb, sa = rgba
    if sa <= 0:
        return
    dr, dg, db, da = buf[i], buf[i + 1], buf[i + 2], buf[i + 3]
    a = sa / 255.0
    out_a = a + (da / 255.0) * (1 - a)
    if out_a <= 0:
        return
    buf[i] = int((sr * a + dr * (da / 255.0) * (1 - a)) / out_a)
    buf[i + 1] = int((sg * a + dg * (da / 255.0) * (1 - a)) / out_a)
    buf[i + 2] = int((sb * a + db * (da / 255.0) * (1 - a)) / out_a)
    buf[i + 3] = int(out_a * 255)


def fill_circle(buf: list[int], w: int, cx: float, cy: float, r: float, color: tuple[int, int, int, int]) -> None:
    r2 = r * r
    x0, x1 = int(cx - r - 1), int(cx + r + 1)
    y0, y1 = int(cy - r - 1), int(cy + r + 1)
    for y in range(y0, y1 + 1):
        for x in range(x0, x1 + 1):
            if (x - cx) ** 2 + (y - cy) ** 2 <= r2:
                blend(buf, w, x, y, color)


def stroke_circle(buf: list[int], w: int, cx: float, cy: float, r: float, thickness: float, color: tuple[int, int, int, int]) -> None:
    outer = (r + thickness / 2) ** 2
    inner = max(0.0, r - thickness / 2) ** 2
    x0, x1 = int(cx - r - thickness - 1), int(cx + r + thickness + 1)
    y0, y1 = int(cy - r - thickness - 1), int(cy + r + thickness + 1)
    for y in range(y0, y1 + 1):
        for x in range(x0, x1 + 1):
            d2 = (x - cx) ** 2 + (y - cy) ** 2
            if inner <= d2 <= outer:
                blend(buf, w, x, y, color)


def fill_ellipse(buf: list[int], w: int, cx: float, cy: float, rx: float, ry: float, color: tuple[int, int, int, int]) -> None:
    x0, x1 = int(cx - rx - 1), int(cx + rx + 1)
    y0, y1 = int(cy - ry - 1), int(cy + ry + 1)
    for y in range(y0, y1 + 1):
        for x in range(x0, x1 + 1):
            if ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1:
                blend(buf, w, x, y, color)


def stroke_poly(buf: list[int], w: int, points: list[tuple[float, float]], thickness: float, color: tuple[int, int, int, int]) -> None:
    for i in range(len(points) - 1):
        x0, y0 = points[i]
        x1, y1 = points[i + 1]
        steps = max(int(math.hypot(x1 - x0, y1 - y0)), 1)
        for s in range(steps + 1):
            t = s / steps
            fill_circle(buf, w, x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, thickness / 2, color)


def make_earring(style: str) -> tuple[list[int], int, int]:
    w, h = 256, 384
    buf = blank(w, h)
    cx = w / 2
    if style == "gold":
        # hook
        stroke_circle(buf, w, cx, 36, 18, 6, GOLD)
        fill_circle(buf, w, cx, 90, 10, GOLD_LIGHT)
        # drop
        fill_ellipse(buf, w, cx, 180, 42, 70, GOLD)
        fill_ellipse(buf, w, cx, 180, 22, 40, GOLD_LIGHT)
        fill_circle(buf, w, cx, 250, 18, GOLD_DARK)
    elif style == "diamond":
        stroke_circle(buf, w, cx, 34, 16, 5, GOLD)
        fill_circle(buf, w, cx, 80, 8, GOLD)
        # diamond kite
        pts = [(cx, 110), (cx + 55, 190), (cx, 300), (cx - 55, 190), (cx, 110)]
        for y in range(110, 301):
            for x in range(int(cx - 60), int(cx + 61)):
                # point-in-diamond approx
                dy = (y - 190) / 95.0
                dx = (x - cx) / 55.0
                if abs(dx) + abs(dy) <= 1.05:
                    blend(buf, w, x, y, DIAMOND if (x + y) % 7 else GOLD_LIGHT)
        stroke_poly(buf, w, pts, 3, GOLD)
    else:  # hoop
        stroke_circle(buf, w, cx, 200, 110, 18, HOOP)
        stroke_circle(buf, w, cx, 200, 110, 6, GOLD_LIGHT)
        fill_circle(buf, w, cx, 90, 8, GOLD)
    return buf, w, h


def make_necklace(style: str) -> tuple[list[int], int, int]:
    w, h = 512, 320
    buf = blank(w, h)
    # chain arc
    for a in range(-70, 71):
        rad = math.radians(a)
        x = w / 2 + math.sin(rad) * 210
        y = 40 + (1 - math.cos(rad)) * 70
        fill_circle(buf, w, x, y, 5 if style == "gold" else 4, GOLD if a % 3 else GOLD_LIGHT)
    # pendant
    if style == "diamond":
        fill_ellipse(buf, w, w / 2, 200, 36, 50, DIAMOND)
        fill_circle(buf, w, w / 2, 155, 10, GOLD)
        stroke_circle(buf, w, w / 2, 200, 28, 3, GOLD)
    else:
        fill_ellipse(buf, w, w / 2, 195, 48, 36, GOLD)
        fill_ellipse(buf, w, w / 2, 195, 28, 18, GOLD_LIGHT)
        fill_circle(buf, w, w / 2, 150, 8, GOLD_DARK)
    return buf, w, h


def split_rgba_depth_arc(
    rgba: list[int],
    w: int,
    h: int,
    cx: float,
    cy: float,
) -> tuple[list[int], list[int]]:
    """Worn depth split: upper band arc = front (camera), lower arc = back (behind finger/wrist)."""
    front = blank(w, h)
    back = blank(w, h)
    seam = max(3.0, min(w, h) * 0.02)
    for y in range(h):
        for x in range(w):
            i = (y * w + x) * 4
            a = rgba[i + 3]
            if a <= 0:
                continue
            px = (rgba[i], rgba[i + 1], rgba[i + 2], a)
            dy = y - cy
            t_front = min(1.0, max(0.0, (-dy + seam) / (seam * 2)))
            t_back = 1.0 - t_front
            if t_back > 0:
                blend(back, w, x, y, (px[0], px[1], px[2], int(a * t_back)))
            if t_front > 0:
                blend(front, w, x, y, (px[0], px[1], px[2], int(a * t_front)))
    return front, back


def paint_solitaire_stone(buf: list[int], w: int, cx: float, cy: float) -> None:
    fill_circle(buf, w, cx, cy, 22, DIAMOND)
    fill_circle(buf, w, cx, cy, 10, GOLD_LIGHT)


def make_ring(style: str) -> tuple[list[int], int, int]:
    w, h = 256, 256
    buf = blank(w, h)
    cx, cy = w / 2, h / 2
    stroke_circle(buf, w, cx, cy, 70, 22, GOLD)
    stroke_circle(buf, w, cx, cy, 70, 8, GOLD_LIGHT)
    if style == "solitaire":
        fill_circle(buf, w, cx, cy - 78, 22, DIAMOND)
        fill_circle(buf, w, cx, cy - 78, 10, GOLD_LIGHT)
    return buf, w, h


def make_ring_layers(style: str) -> tuple[list[int], list[int], list[int], int, int]:
    """Full ring + worn depth split. Solitaire stone stays on front only."""
    full, w, h = make_ring(style)
    cx, cy = w / 2, h / 2
    band_only, _, _ = make_ring("band")
    front, back = split_rgba_depth_arc(band_only, w, h, cx, cy)
    if style == "solitaire":
        paint_solitaire_stone(front, w, cx, h / 2 - 78)
    return front, back, full, w, h


def make_ring_front(style: str) -> tuple[list[int], int, int]:
    front, _, _, w, h = make_ring_layers(style)
    return front, w, h


def make_ring_back(style: str) -> tuple[list[int], int, int]:
    _, back, _, w, h = make_ring_layers(style)
    return back, w, h


def make_bangle(style: str) -> tuple[list[int], int, int]:
    w, h = 384, 256
    buf = blank(w, h)
    cx, cy = w / 2, h / 2
    color = GOLD if style == "gold" else HOOP
    stroke_circle(buf, w, cx, cy, 95, 20, color)
    stroke_circle(buf, w, cx, cy, 95, 6, GOLD_LIGHT)
    if style == "diamond":
        for a in range(0, 360, 30):
            rad = math.radians(a)
            fill_circle(buf, w, cx + math.cos(rad) * 95, cy + math.sin(rad) * 95, 7, DIAMOND)
    return buf, w, h


def make_bangle_layers(style: str) -> tuple[list[int], list[int], list[int], int, int]:
    full, w, h = make_bangle(style)
    cx, cy = w / 2, h / 2
    plain, _, _ = make_bangle("gold")
    front, back = split_rgba_depth_arc(plain, w, h, cx, cy)
    if style == "diamond":
        for a in range(0, 360, 30):
            rad = math.radians(a)
            sx = int(cx + math.cos(rad) * 95)
            sy = int(cy + math.sin(rad) * 95)
            target = front if sy <= cy else back
            fill_circle(target, w, sx, sy, 7, DIAMOND)
    return front, back, full, w, h


def make_bangle_front(style: str) -> tuple[list[int], int, int]:
    front, _, _, w, h = make_bangle_layers(style)
    return front, w, h


def make_bangle_back(style: str) -> tuple[list[int], int, int]:
    _, back, _, w, h = make_bangle_layers(style)
    return back, w, h


def with_demo_bg(src: list[int], w: int, h: int) -> list[int]:
    """Opaque cream card preview for product grid."""
    out = blank(w, h)
    for y in range(h):
        for x in range(w):
            # subtle gradient card
            t = y / max(h - 1, 1)
            r = int(28 + t * 8)
            g = int(26 + t * 6)
            b = int(22 + t * 4)
            set_px(out, w, x, y, (r, g, b, 255))
    for i in range(0, len(src), 4):
        a = src[i + 3]
        if a:
            x = (i // 4) % w
            y = (i // 4) // w
            blend(out, w, x, y, (src[i], src[i + 1], src[i + 2], a))
    return out


# Folders where jewellery.png may be user-uploaded — never overwrite large files
MANUAL_OVERLAY_FOLDERS = frozenset({"necklace-gold", "necklace-diamond"})


def write_demo_preview(dest: Path, buf: list[int], w: int, h: int) -> None:
    """Homepage thumbnail — demo.jpg (or demo.png fallback)."""
    preview = with_demo_bg(buf, w, h)
    demo_png = dest / "demo.png"
    if not demo_png.exists():
        write_png(demo_png, w, h, preview)
        print(f"wrote {dest.name}/demo.png")
    demo_jpg = dest / "demo.jpg"
    if demo_jpg.exists():
        return
    try:
        from PIL import Image  # type: ignore

        img = Image.frombytes("RGBA", (w, h), bytes(preview)).convert("RGB")
        img.save(demo_jpg, quality=88)
        print(f"wrote {dest.name}/demo.jpg")
    except Exception:
        print(f"kept {dest.name}/demo.png (install Pillow for demo.jpg)")


def save_piece(
    folder: str,
    maker,
    style: str,
    front_maker=None,
    back_maker=None,
    *,
    manual_overlay: bool = False,
) -> None:
    dest = OBJECTS / folder
    dest.mkdir(parents=True, exist_ok=True)
    overlay = dest / "jewellery.png"
    preview_buf = None
    preview_size = None

    if manual_overlay:
        if overlay.exists() and overlay.stat().st_size > 20_000:
            print(f"kept {folder}/jewellery.png (manual overlay)")
        elif not overlay.exists():
            buf, w, h = maker(style)
            write_png(overlay, w, h, buf)
            preview_buf, preview_size = buf, (w, h)
            print(f"wrote placeholder {folder}/jewellery.png (replace with your file)")
        else:
            print(f"kept {folder}/jewellery.png")
    else:
        if overlay.exists() and overlay.stat().st_size > 20_000:
            print(f"kept {folder}/jewellery.png (existing overlay)")
        else:
            buf, w, h = maker(style)
            write_png(overlay, w, h, buf)
            preview_buf, preview_size = buf, (w, h)
            print(f"wrote {folder}/jewellery.png")

    if front_maker and back_maker:
        fbuf, fw, fh = front_maker(style)
        bbuf, bw, bh = back_maker(style)
        write_png(dest / "front.png", fw, fh, fbuf)
        write_png(dest / "back.png", bw, bh, bbuf)
        print(f"wrote {folder}/front.png + back.png (depth arc split)")
        if preview_buf is None:
            preview_buf, preview_size = fbuf, (fw, fh)

    if preview_buf is None and overlay.exists():
        # Build demo from existing overlay dimensions — reuse maker output size
        buf, w, h = maker(style)
        preview_buf, preview_size = buf, (w, h)

    if preview_buf is not None and not (dest / "demo.jpg").exists() and not (dest / "demo.png").exists():
        write_demo_preview(dest, preview_buf, preview_size[0], preview_size[1])


def main() -> None:
    save_piece("earring-gold", make_earring, "gold")
    save_piece("earring-diamond", make_earring, "diamond")
    save_piece("earring-hoop", make_earring, "hoop")
    save_piece("necklace-gold", make_necklace, "gold", manual_overlay=True)
    save_piece("necklace-diamond", make_necklace, "diamond", manual_overlay=True)
    save_piece("ring-band", make_ring, "band", make_ring_front, make_ring_back)
    save_piece("ring-solitaire", make_ring, "solitaire", make_ring_front, make_ring_back)
    save_piece("bangles-gold", make_bangle, "gold", make_bangle_front, make_bangle_back)
    save_piece("bangles-diamond", make_bangle, "diamond", make_bangle_front, make_bangle_back)

    # one JPG sample (no alpha) for format coverage
    buf, w, h = make_earring("gold")
    opaque = with_demo_bg(buf, w, h)
    # Write a minimal JPEG via PNG rename is wrong; create true JPEG if pillow else skip
    try:
        from PIL import Image  # type: ignore

        img = Image.frombytes("RGBA", (w, h), bytes(opaque)).convert("RGB")
        jpg_dir = OBJECTS / "earring-gold"
        img.save(jpg_dir / "sample.jpg", quality=90)
        print("wrote earring-gold/sample.jpg (JPG support sample)")
    except Exception:
        # Pure-Python JPEG is heavy; PNG demo is enough. JPG upload still works in-app.
        print("Pillow not installed — skipped sample.jpg (upload still accepts JPG)")

    index = {
        "_comment": [
            "Homepage thumbnails are pinned via \"image\": \"demo.jpg\".",
            "Try-on overlays use \"model\": \"jewellery.png\" (or jewellery.jpg).",
            "necklace-gold and necklace-diamond: manual jewellery.png only — do not replace.",
            "Rings/bangles: front.png + back.png = worn depth arc split (NOT flat ∩/∪)."
        ],
        "items": [
            {"folder": "necklace-gold", "model": "jewellery.png", "image": "demo.jpg"},
            {"folder": "necklace-diamond", "model": "jewellery.png", "image": "demo.jpg"},
            {"folder": "earring-gold", "model": "jewellery.png", "image": "demo.jpg"},
            {"folder": "earring-diamond", "model": "jewellery.png", "image": "demo.jpg"},
            {"folder": "earring-hoop", "model": "jewellery.png", "image": "demo.jpg"},
            {"folder": "ring-band", "model": "jewellery.png", "image": "demo.jpg", "front": "front.png", "back": "back.png"},
            {"folder": "ring-solitaire", "model": "jewellery.png", "image": "demo.jpg", "front": "front.png", "back": "back.png"},
            {"folder": "bangles-gold", "model": "jewellery.png", "image": "demo.jpg", "front": "front.png", "back": "back.png"},
            {"folder": "bangles-diamond", "model": "jewellery.png", "image": "demo.jpg", "front": "front.png", "back": "back.png"}
        ],
    }
    import json

    (OBJECTS / "index.json").write_text(json.dumps(index, indent=2), encoding="utf-8")
    print("wrote objects/index.json")


if __name__ == "__main__":
    main()
