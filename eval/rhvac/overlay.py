# Render a curation overlay: the takeoff's persisted ink raster (wall evidence) + candidate room
# polygons + labels, all in model feet so registration is exact by construction. This is the
# visual-evidence surface for room-map curation and detection debugging.
#
#   python eval/rhvac/overlay.py Level_1_Main_Level                    # fixture TSV + fixture-era ink
#   python eval/rhvac/overlay.py Level_1_Main_Level --live             # live Documents TSV + ink
#   python eval/rhvac/overlay.py Level_1_Main_Level --out out.png --thumb 2000
#
# Ink bins live next to the TSVs (Documents\Pe.Tools\takeoff); the eval fixture commits TSVs only,
# so --live is the norm right after a detection run, and fixture mode needs an ink dir whose run
# produced the committed TSVs (pass --ink-dir).
import argparse, os, struct
from PIL import Image, ImageDraw, ImageFont

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
LIVE = next((d for d in [
    os.path.expanduser(r"~\OneDrive\Documents\Pe.Tools\takeoff"),
    os.path.expanduser(r"~\Documents\Pe.Tools\takeoff"),
] if os.path.isdir(d)), None)

PALETTE = [(230,60,60),(60,120,230),(40,160,90),(220,140,30),(160,70,200),(200,60,150),
           (30,170,170),(120,120,40),(240,90,110),(90,90,240),(80,190,60),(250,110,40)]


def load_ink(path):
    with open(path, "rb") as f:
        magic, w, h = struct.unpack("<Iii", f.read(12))
        if magic != 0x504B4E49:
            raise ValueError(f"{path}: not an INKP raster")
        minx, miny, cell = struct.unpack("<ddd", f.read(24))
        bits = f.read((w * h + 7) // 8)
    return w, h, minx, miny, cell, bits


def load_tsv(path):
    rooms, polys = {}, {}
    for line in open(path, encoding="utf-8"):
        parts = line.rstrip("\n").split("\t")
        if parts[0] == "ROOM":
            rooms[parts[1]] = dict(sqft=float(parts[2]), lx=float(parts[4]), ly=float(parts[5]),
                                   ceil=float(parts[6]))
        elif parts[0] == "POLY":
            loop = [tuple(map(float, p.split(";"))) for p in parts[3].split("|")]
            polys.setdefault(parts[1], []).append((parts[2], loop))
    return rooms, polys


def render(ink_path, tsv_path, out_path, scale=4, thumb=None):
    w, h, minx, miny, cell, bits = load_ink(ink_path)
    rooms, polys = load_tsv(tsv_path)
    img = Image.new("RGB", (w * scale, h * scale), (255, 255, 255))
    px = img.load()
    for y in range(h):
        row = (h - 1 - y) * scale
        for x in range(w):
            if (bits[(y * w + x) >> 3] >> ((y * w + x) & 7)) & 1:
                for dy in range(scale):
                    for dx in range(scale):
                        px[x * scale + dx, row + dy] = (170, 170, 170)
    dr = ImageDraw.Draw(img)

    def tp(pt):
        return ((pt[0] - minx) / cell * scale, (h - (pt[1] - miny) / cell) * scale)

    try:
        font = ImageFont.truetype("arial.ttf", 26)
    except OSError:
        font = ImageFont.load_default()
    for i, (rid, meta) in enumerate(sorted(rooms.items())):
        col = PALETTE[i % len(PALETTE)]
        for kind, loop in polys.get(rid, []):
            dr.line([tp(p) for p in loop] + [tp(loop[0])], fill=col, width=3 if kind == "outer" else 2)
        lx, ly = tp((meta["lx"], meta["ly"]))
        label = f'{rid} {meta["sqft"]:.0f}sf h{meta["ceil"]:.1f}'
        dr.text((lx + 2, ly + 2), label, fill=(255, 255, 255), font=font)
        dr.text((lx, ly), label, fill=col, font=font)
    img.save(out_path)
    print(out_path, img.size)
    if thumb:
        small = img.copy()
        small.thumbnail((thumb, thumb))
        root, ext = os.path.splitext(out_path)
        small.save(f"{root}_small{ext}")
        print(f"{root}_small{ext}", small.size)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("slug", help="e.g. Level_1_Main_Level")
    ap.add_argument("--project", default="project-a")
    ap.add_argument("--live", action="store_true", help="use live Documents TSV+ink, not fixtures")
    ap.add_argument("--ink-dir", default=LIVE, help="dir with ink_<slug>.bin")
    ap.add_argument("--out", default=None)
    ap.add_argument("--thumb", type=int, default=2000)
    ap.add_argument("--tsv-dir", default=None, help="score any TSV dir (e.g. an offline replay dump)")
    a = ap.parse_args()
    tsv_dir = a.tsv_dir or (a.ink_dir if a.live else os.path.join(REPO, "eval", "rhvac", a.project, "takeoff"))
    render(
        os.path.join(a.ink_dir, f"ink_{a.slug}.bin"),
        os.path.join(tsv_dir, f"rooms_{a.slug}.tsv"),
        a.out or os.path.join(os.getcwd(), f"overlay_{a.slug}.png"),
        thumb=a.thumb,
    )
