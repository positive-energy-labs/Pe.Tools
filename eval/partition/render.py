"""Render every fixture of a partition bench run (rails brief, W3). stdlib + PIL only.

    python eval/partition/render.py .artifacts/runs/bench/<stamp>

Per fixture: knee ink grey, header ink lighter, zone black, accepted faces at 35 percent fill with a
1 px edge, held faces dashed, slivers (under 15 sf) red, truth rooms (when the truth file exists)
in blue. Partly transparent by ruling: edges are judged against the walls under them.
"""
import json
import os
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

sys.path.insert(0, str(Path(__file__).parent))
from metrics import TRUTH, SLIVER_SQFT, pts  # noqa: E402

LONG_PX = 2400
MARGIN_FT = 3.0
FILL = [(31, 119, 180), (44, 160, 44), (255, 127, 14), (148, 103, 189), (23, 190, 207), (188, 189, 34), (140, 86, 75)]


def render(fixture_dir, truth_root):
    answer = json.loads((fixture_dir / "answer.json").read_text())
    ink = json.loads((fixture_dir / "ink.json").read_text())
    zone_pts = [p for z in answer["Zones"] for loop in z for p in pts(loop)]
    x0, y0 = min(p[0] for p in zone_pts) - MARGIN_FT, min(p[1] for p in zone_pts) - MARGIN_FT
    x1, y1 = max(p[0] for p in zone_pts) + MARGIN_FT, max(p[1] for p in zone_pts) + MARGIN_FT
    scale = LONG_PX / max(x1 - x0, y1 - y0)
    size = (int((x1 - x0) * scale) + 1, int((y1 - y0) * scale) + 1)

    def px(p):
        return ((p[0] - x0) * scale, (y1 - p[1]) * scale)

    def visible(flat):
        ps = pts(flat)
        return any(x0 <= x <= x1 and y0 <= y <= y1 for x, y in ps)

    img = Image.new("RGBA", size, (255, 255, 255, 255))
    d = ImageDraw.Draw(img)
    for band, grey in (("Header", 228), ("Knee", 190)):
        for piece in ink[band]:
            if len(piece) >= 6 and visible(piece):
                d.polygon([px(p) for p in pts(piece)], fill=(grey, grey, grey, 255))
    faces = Image.new("RGBA", size, (0, 0, 0, 0))
    fd = ImageDraw.Draw(faces)
    for i, r in enumerate(answer["Rooms"]):
        ring = [px(p) for p in pts(r["Loop"])]
        if r["AreaSqft"] < SLIVER_SQFT:
            fd.polygon(ring, fill=(220, 30, 30, 200), outline=(160, 0, 0, 255))
        elif r["Disposition"] == "Accepted":
            fd.polygon(ring, fill=FILL[i % len(FILL)] + (90,), outline=(20, 20, 20, 255))
        elif r["Disposition"] == "Excluded":
            fd.polygon(ring, fill=(90, 90, 90, 60))
        else:
            dashed(fd, ring, (120, 60, 160, 255), 3)
        for hole in r.get("Holes") or []:
            fd.polygon([px(p) for p in pts(hole)], fill=(255, 255, 255, 0))
    for z in answer["Zones"]:
        for loop in z:
            fd.line([px(p) for p in pts(loop)] + [px(pts(loop)[0])], fill=(0, 0, 0, 255), width=3)
    truth = truth_root / TRUTH.get(fixture_dir.name, "-")
    if truth.is_file():
        for room in json.loads(truth.read_text())["rooms"]:
            for loop in room["loops"]:
                fd.line([px(p) for p in pts(loop)] + [px(pts(loop)[0])], fill=(0, 60, 255, 255), width=3)
    img = Image.alpha_composite(img, faces)
    d = ImageDraw.Draw(img)
    m = json.loads((fixture_dir / "metrics.json").read_text()) if (fixture_dir / "metrics.json").is_file() else {}
    caption = (f"{fixture_dir.name}  straight {m.get('straight')}  vert/100ft {m.get('vert/100ft')}  ortho {m.get('ortho')} "
               f"axes {m.get('axes_deg')}  ink p50/p90 {m.get('ink_p50')}/{m.get('ink_p90')}  floating {m.get('floating')} "
               f"slivers {m.get('slivers')} ({m.get('sliver_sf')} sf)  holes {m.get('holes_sf')} sf  "
               f"truth symdiff/hausdorff {m.get('truth_symdiff')}/{m.get('truth_hausdorff')}")
    d.rectangle((0, 0, size[0], 28), fill=(255, 255, 255, 230))
    d.text((6, 6), caption, fill=(0, 0, 0, 255), font=ImageFont.load_default(16))
    out = fixture_dir / "render.png"
    img.convert("RGB").save(out)
    return out


def dashed(d, ring, color, width, on=8, off=6):
    for a, b in zip(ring, ring[1:] + ring[:1]):
        length = ((b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2) ** 0.5
        if length == 0:
            continue
        ux, uy = (b[0] - a[0]) / length, (b[1] - a[1]) / length
        t = 0.0
        while t < length:
            e = min(t + on, length)
            d.line([(a[0] + ux * t, a[1] + uy * t), (a[0] + ux * e, a[1] + uy * e)], fill=color, width=width)
            t += on + off


def main(run):
    run = Path(run)
    truth_root = Path(os.environ.get("PE_PRIVATE_FIXTURES") or Path(__file__).resolve().parents[2] / ".private" / "fixtures")
    for d in sorted(run.iterdir()):
        if (d / "answer.json").is_file():
            print(render(d, truth_root))


if __name__ == "__main__":
    main(sys.argv[1])
