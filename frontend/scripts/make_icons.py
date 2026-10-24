"""App icons and Android launch screens from one drawing (an open book on paper).

    python3 scripts/make_icons.py      (needs Pillow; run from frontend/)

Writes public/icons/icon-{192,512}.png and the Android mipmaps, adaptive-icon foregrounds and splash images.
"""

from pathlib import Path

from PIL import Image, ImageDraw

PAPER, INK, LINES, PAGE = "#faf8f3", "#3d5a80", "#9aa9bd", "#ffffff"
RES = Path("android/app/src/main/res")


def book(size: int, scale: float = 1.0, background: str | None = PAPER) -> Image.Image:
    """The open book centred on a `size` square; `scale` < 1 leaves room (adaptive-icon safe zone)."""
    s = 4 * size
    im = Image.new("RGBA", (s, s), background or (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    cx, cy = s / 2, s / 2
    w, h = s * 0.30 * scale, s * 0.42 * scale
    top, bot = cy - h * 0.48, cy + h * 0.52
    line = max(2, int(s * 0.018 * scale))
    for sign in (-1, 1):
        outer = cx + sign * w
        d.polygon([(cx, top + s * 0.03 * scale), (outer, top - s * 0.01 * scale), (outer, bot), (cx, bot + s * 0.04 * scale)],
                  fill=PAGE, outline=INK, width=line)
        for i in range(4):
            y = top + s * 0.08 * scale + i * s * 0.075 * scale
            x0, x1 = cx + sign * s * 0.05 * scale, cx + sign * (w - s * 0.05 * scale)
            d.line([(min(x0, x1), y), (max(x0, x1), y)], fill=LINES, width=max(1, int(s * 0.012 * scale)))
    d.line([(cx, top + s * 0.03 * scale), (cx, bot + s * 0.04 * scale)], fill=INK, width=max(2, int(s * 0.02 * scale)))
    return im.resize((size, size), Image.LANCZOS)


def round_mask(im: Image.Image) -> Image.Image:
    mask = Image.new("L", im.size, 0)
    ImageDraw.Draw(mask).ellipse([0, 0, im.size[0] - 1, im.size[1] - 1], fill=255)
    out = Image.new("RGBA", im.size, (0, 0, 0, 0))
    out.paste(im, mask=mask)
    return out


def main() -> None:
    for size in (192, 512):
        book(size).convert("RGB").save(f"public/icons/icon-{size}.png")
    if not RES.exists():
        return
    for density, px in {"mdpi": 48, "hdpi": 72, "xhdpi": 96, "xxhdpi": 144, "xxxhdpi": 192}.items():
        folder = RES / f"mipmap-{density}"
        book(px).save(folder / "ic_launcher.png")
        round_mask(book(px)).save(folder / "ic_launcher_round.png")
        # adaptive icon: 108dp canvas, the visible part is the middle 72dp
        book(int(px * 108 / 48), scale=0.62, background=None).save(folder / "ic_launcher_foreground.png")
    for folder in RES.glob("drawable*"):
        splash = folder / "splash.png"
        if splash.exists():
            w, h = Image.open(splash).size
            canvas = Image.new("RGB", (w, h), PAPER)
            icon = book(min(w, h) // 3, background=None)
            canvas.paste(icon, ((w - icon.width) // 2, (h - icon.height) // 2), icon)
            canvas.save(splash)
    (RES / "values" / "ic_launcher_background.xml").write_text(
        '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n'
        f'    <color name="ic_launcher_background">{PAPER.upper()}</color>\n</resources>\n')


if __name__ == "__main__":
    main()
