# Regenerates the web, PWA and desktop-shortcut icons from the pea mark.
# python ts/apps/web/brand/make-icons.py <source.png> ts/apps/web/public ts/apps/web/brand
# The source may be the original white-background art or brand/pea.png itself.
import sys
from PIL import Image

src, public, brand = sys.argv[1], sys.argv[2], sys.argv[3]
im = Image.open(src).convert("RGBA")

# Key out the paper-white background: alpha follows distance from white, so anti-aliased
# edges stay smooth and the light fibres inside the green stay opaque.
px = im.load()
w, h = im.size
for y in range(h):
    for x in range(w):
        r, g, b, _ = px[x, y]
        d = 255 - min(r, g, b)  # 0 on white, ~90 on the green
        a = 0 if d < 8 else 255 if d > 40 else int((d - 8) * 255 / 32)
        px[x, y] = (r, g, b, a)

# Crop to the mark, then pad to a square with a small margin so it fills the icon.
box = im.getbbox()
mark = im.crop(box)
side = int(max(mark.size) * 1.06)
square = Image.new("RGBA", (side, side), (0, 0, 0, 0))
square.paste(mark, ((side - mark.width) // 2, (side - mark.height) // 2))

master = square.resize((1024, 1024), Image.LANCZOS)
master.save(f"{brand}/pea.png", optimize=True)
master.resize((512, 512), Image.LANCZOS).save(f"{public}/logo512.png", optimize=True)
master.resize((192, 192), Image.LANCZOS).save(f"{public}/logo192.png", optimize=True)
master.save(f"{public}/favicon.ico", sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)], bitmap_format="bmp")  # BMP frames: GDI+ and Explorer misread PNG frames

# Sample the mark's fill colour for the manifest theme.
opaque = [p for p in master.resize((64, 64)).get_flattened_data() if p[3] == 255]
avg = tuple(sum(c[i] for c in opaque) // len(opaque) for i in range(3))
print("bbox", box, "square", side, "theme #%02x%02x%02x" % avg)
