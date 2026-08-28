#!/usr/bin/env python3
"""
Filo brand asset pipeline.

Reads the CANONICAL logo at public/logo.png and regenerates every derived
brand asset from it:

  public/favicon.ico
  public/apple-touch-icon.png
  public/icons/icon-{72,96,128,144,152,192,384,512}.png
  public/logo-128.png            (crisp small mark for dense UI spots)
  public/og-image.png            (1200x630 social card w/ logo + wordmark)

Drop a new public/logo.png in place and re-run:
    python3 scripts/generate-brand-assets.py

If public/logo.png is missing, a built-in interim mark is drawn first
(rounded-square indigo->violet gradient, white document monogram) so the
pipeline always produces a complete, consistent set.
"""

from PIL import Image, ImageDraw, ImageFont, ImageOps
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PUBLIC = os.path.join(ROOT, "public")
ICONS = os.path.join(PUBLIC, "icons")
CANONICAL = os.path.join(PUBLIC, "logo.png")

ICON_SIZES = [72, 96, 128, 144, 152, 192, 384, 512]


def draw_interim_logo(size: int = 1024) -> Image.Image:
    """Interim Filo mark: rounded-square gradient + white document monogram.

    Purely a placeholder so the pipeline is runnable before the real logo
    lands — overwritten the moment public/logo.png is replaced.
    """
    s = size
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    # diagonal gradient indigo -> violet
    c1, c2 = (79, 70, 229), (124, 58, 237)
    grad = Image.new("RGBA", (s, s))
    gd = ImageDraw.Draw(grad)
    for y in range(s):
        for x in range(0, s, 8):
            t = (x + y) / (2 * s)
            r = int(c1[0] + (c2[0] - c1[0]) * t)
            g = int(c1[1] + (c2[1] - c1[1]) * t)
            b = int(c1[2] + (c2[2] - c1[2]) * t)
            gd.rectangle([x, y, x + 8, y + 1], fill=(r, g, b, 255))

    # rounded-square mask (squircle-ish radius 22%)
    mask = Image.new("L", (s, s), 0)
    md = ImageDraw.Draw(mask)
    md.rounded_rectangle([0, 0, s - 1, s - 1], radius=int(s * 0.22), fill=255)
    img.paste(grad, (0, 0), mask)

    # white document glyph with folded corner + "F" lines
    m = s * 0.26  # glyph margin
    doc = [m, m * 0.9, s - m, s - m * 0.9]
    fold = s * 0.14
    white = (255, 255, 255, 255)
    # document body
    d.rounded_rectangle(doc, radius=s * 0.035, fill=white)
    # folded corner (cut with gradient color block)
    d.polygon(
        [(doc[2] - fold, doc[1]), (doc[2], doc[1] + fold), (doc[2] - fold, doc[1] + fold)],
        fill=c2,
    )
    # F strokes
    stroke = max(int(s * 0.045), 8)
    fx, fy = doc[0] + s * 0.10, doc[1] + s * 0.16
    fw = (doc[2] - doc[0]) - s * 0.20
    fh = (doc[3] - doc[1]) - s * 0.28
    ink = c1
    d.rounded_rectangle([fx, fy, fx + fw, fy + stroke], radius=stroke // 2, fill=ink)
    d.rounded_rectangle([fx, fy, fx + stroke, fy + fh], radius=stroke // 2, fill=ink)
    mid = fy + fh * 0.48
    d.rounded_rectangle([fx, mid, fx + fw * 0.62, mid + stroke], radius=stroke // 2, fill=ink)
    return img


def fit_square(src: Image.Image, size: int, safe_area: float = 1.0) -> Image.Image:
    """Center-fit a square canvas with optional safe-area padding."""
    if safe_area < 1.0:
        inner = int(size * safe_area)
        src = src.resize((inner, inner), Image.LANCZOS)
        canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        canvas.paste(src, ((size - inner) // 2, (size - inner) // 2), src)
        return canvas
    return src.resize((size, size), Image.LANCZOS).convert("RGBA")


def main() -> None:
    os.makedirs(ICONS, exist_ok=True)

    if os.path.exists(CANONICAL):
        logo = Image.open(CANONICAL).convert("RGBA")
        print(f"[brand] using canonical public/logo.png ({logo.size[0]}x{logo.size[1]})")
    else:
        logo = draw_interim_logo(1024)
        logo.save(CANONICAL)
        print("[brand] public/logo.png missing — drew interim mark (replace it any time)")

    # Normalize canonical to a clean 1024 master (idempotent)
    if logo.size != (1024, 1024):
        logo = fit_square(logo, 1024)
        logo.save(CANONICAL)
        print("[brand] normalized canonical logo to 1024x1024")

    # PWA icons (maskable needs ~80% safe area)
    for size in ICON_SIZES:
        fit_square(logo, size, safe_area=0.80).save(os.path.join(ICONS, f"icon-{size}x{size}.png"))
    print(f"[brand] wrote {len(ICON_SIZES)} PWA icons")

    # favicon.ico (16/32/48)
    logo.save(
        os.path.join(PUBLIC, "favicon.ico"),
        format="ICO",
        sizes=[(16, 16), (32, 32), (48, 48)],
    )
    print("[brand] wrote favicon.ico")

    # apple touch icon (opaque background per Apple HIG)
    apple = Image.new("RGB", (180, 180), (79, 70, 229))
    mark = fit_square(logo, 180, safe_area=0.84)
    apple.paste(mark, (0, 0), mark)
    apple.save(os.path.join(PUBLIC, "apple-touch-icon.png"))
    print("[brand] wrote apple-touch-icon.png")

    # small crisp mark for dense UI
    fit_square(logo, 128).save(os.path.join(PUBLIC, "logo-128.png"))

    # og-image 1200x630
    og = Image.new("RGB", (1200, 630), (250, 250, 252))
    d = ImageDraw.Draw(og)
    # subtle brand band
    for y in range(630):
        t = y / 630
        d.line([(0, y), (1200, y)], fill=(int(79 + 45 * t), int(70 + -12 * t), int(229 + 8 * t)))
    mark = fit_square(logo, 160)
    og.paste(mark, (80, 235), mark)
    try:
        font = ImageFont.truetype(
            "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 96
        )
        small = ImageFont.truetype(
            "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 34
        )
    except OSError:
        font = small = ImageFont.load_default()
    d.text((290, 240), "Filo", font=font, fill=(255, 255, 255))
    d.text(
        (292, 360),
        "AI documents, spreadsheets & presentations",
        font=small,
        fill=(235, 235, 245),
    )
    og.save(os.path.join(PUBLIC, "og-image.png"))
    print("[brand] wrote og-image.png")

    print("[brand] done.")


if __name__ == "__main__":
    main()
