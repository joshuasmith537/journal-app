"""Build PWA icons from the book-and-pencil artwork.

The source JPEG has an off-white field and a faint rounded-square outline.
Neutral light pixels become pure white. The artwork stays centered, and the
maskable icon keeps that artwork inside the 80% safe circle.
"""

from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SOURCE = Path(__file__).with_name("journal-icon-source.jpg")
OUT = ROOT / "public" / "icons"


def is_background(r: int, g: int, b: int) -> bool:
    chroma = max(r, g, b) - min(r, g, b)
    return chroma < 14 and (r + g + b) / 3 > 200


def artwork() -> Image.Image:
    src = Image.open(SOURCE).convert("RGB")
    width, height = src.size
    pixels = src.load()
    min_x, min_y, max_x, max_y = width, height, 0, 0
    for y in range(height):
        for x in range(width):
            if not is_background(*pixels[x, y]):
                min_x = min(min_x, x)
                min_y = min(min_y, y)
                max_x = max(max_x, x)
                max_y = max(max_y, y)
    pad = 2
    crop = src.crop((max(0, min_x - pad), max(0, min_y - pad), min(width, max_x + pad + 1), min(height, max_y + pad + 1)))
    cleaned = crop.load()
    for y in range(crop.height):
        for x in range(crop.width):
            if is_background(*cleaned[x, y]):
                cleaned[x, y] = (255, 255, 255)
    return crop


def render(art: Image.Image, size: int, maskable: bool) -> Image.Image:
    canvas = Image.new("RGB", (size, size), (255, 255, 255))
    aw, ah = art.size
    if maskable:
        # The safe zone is a centered circle whose diameter is 80% of the icon.
        scale = (size * 0.8) / (aw**2 + ah**2) ** 0.5
    else:
        scale = (size * 0.86) / max(aw, ah)
    resized = art.resize((max(1, round(aw * scale)), max(1, round(ah * scale))), Image.Resampling.LANCZOS)
    canvas.paste(resized, ((size - resized.width) // 2, (size - resized.height) // 2))
    pixels = canvas.load()
    for y in range(size):
        for x in range(size):
            if is_background(*pixels[x, y]):
                pixels[x, y] = (255, 255, 255)
    return canvas


def main() -> None:
    art = artwork()
    OUT.mkdir(parents=True, exist_ok=True)
    icons = {
        "icon-192.png": render(art, 192, False),
        "icon-512.png": render(art, 512, False),
        "icon-maskable-512.png": render(art, 512, True),
        "apple-touch-icon.png": render(art, 180, False),
    }
    for name, image in icons.items():
        image.save(OUT / name, "PNG")
    favicon = render(art, 32, False)
    favicon.save(ROOT / "public" / "favicon.ico", sizes=[(32, 32), (16, 16)])


if __name__ == "__main__":
    main()
