"""Gera os ícones do PWA em web/icons/. Uso: python scripts/make_icons.py"""
from pathlib import Path

from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parent.parent / "web" / "icons"
S = 1024  # desenha grande e reduz (antialiasing)


def plane(draw: ImageDraw.ImageDraw, color) -> None:
    c = S / 2
    u = S / 100
    # fuselagem
    draw.rounded_rectangle([c - 5 * u, c - 34 * u, c + 5 * u, c + 30 * u], radius=5 * u, fill=color)
    # asas
    draw.polygon([(c - 4 * u, c - 8 * u), (c - 36 * u, c + 8 * u), (c - 36 * u, c + 14 * u),
                  (c + 36 * u, c + 14 * u), (c + 36 * u, c + 8 * u), (c + 4 * u, c - 8 * u)], fill=color)
    # empenagem
    draw.polygon([(c - 3 * u, c + 20 * u), (c - 15 * u, c + 28 * u), (c - 15 * u, c + 32 * u),
                  (c + 15 * u, c + 32 * u), (c + 15 * u, c + 28 * u), (c + 3 * u, c + 20 * u)], fill=color)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    img = Image.new("RGB", (S, S), "#0b5cff")
    d = ImageDraw.Draw(img)
    # leve gradiente diagonal
    for i in range(S):
        d.line([(0, i), (S, i)], fill=(11, int(92 - 40 * i / S), int(255 - 70 * i / S)))
    layer = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    plane(ImageDraw.Draw(layer), "#ffffff")
    layer = layer.rotate(-35, resample=Image.BICUBIC)
    img.paste(layer, (0, 0), layer)
    for name, size in [("icon-512.png", 512), ("icon-192.png", 192), ("apple-touch-icon.png", 180)]:
        img.resize((size, size), Image.LANCZOS).save(OUT / name, optimize=True)
    print("ícones gerados em", OUT)


if __name__ == "__main__":
    main()
