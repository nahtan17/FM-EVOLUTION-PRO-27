"""Generate the desktop and web icons from the original FM Evolution PRO shield.

Run with Pillow installed:

    python3 app/src-tauri/icons/make-icon.py "/path/to/Escudo Neon FM Evolution Pro.png"
"""

import argparse
from pathlib import Path

from PIL import Image

ICONS = Path(__file__).resolve().parent
WEB = ICONS.parents[1] / "src" / "assets"
ICO_SIZES = (16, 24, 32, 48, 64, 96, 128, 256)
PNG_SIZES = {
    "32x32.png": 32,
    "128x128.png": 128,
    "128x128@2x.png": 256,
    "icon.png": 512,
    "app-icon.png": 512,
    "StoreLogo.png": 50,
    **{f"Square{size}x{size}Logo.png": size for size in (30, 44, 71, 89, 107, 142, 150, 284, 310)},
}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("logo", type=Path, help="Original square artwork")
    logo = Image.open(parser.parse_args().logo).convert("RGBA")
    if logo.width != logo.height:
        parser.error("The original artwork must be square.")
    # Keep the FM initials legible in the smallest Windows frames and in the browser tab.
    small_logo = logo.crop(tuple(round(logo.width * edge) for edge in (.205, .245, .765, .805)))

    def at(size, image=logo):
        return image.resize((size, size), Image.Resampling.LANCZOS)

    for name, size in PNG_SIZES.items():
        at(size).save(ICONS / name, optimize=True)

    frames = {size: at(size, small_logo if size <= 24 else logo) for size in ICO_SIZES}
    frames[256].save(
        ICONS / "icon.ico",
        sizes=[(size, size) for size in ICO_SIZES],
        append_images=[frames[size] for size in ICO_SIZES if size < 256],
    )
    at(1024).save(ICONS / "icon.icns")

    WEB.mkdir(parents=True, exist_ok=True)
    at(256).save(WEB / "evolution-logo.png", optimize=True)
    at(32, small_logo).save(WEB / "evolution-icon.png", optimize=True)


if __name__ == "__main__":
    main()
