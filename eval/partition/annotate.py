"""Annotate a Revit view image with a rooms snapshot: numbered callouts both parties can point at.

    python eval/partition/annotate.py <rooms-snapshot.json> <view-image.out.json> <out.png>
        [--focus R1,R7] [--truth <truth.json>] [--crop] [--title "..."]

Inputs are `pea host operations call` outputs (the CLI envelope, log noise before the JSON is fine) or the bare
response: `rooms.snapshot` and `revit.context.view-image`. The underlay is Revit's picture, never redrawn. Pixels come
from the view image's `registration` (model XY of the top-left, top-right and bottom-left corners); the PNG used is
the first of the response's `filePath` or a PNG beside the view-image JSON whose sha256 equals `imageSha256`, else
the run fails.

Numbering is `regionLabel` / `roomRows` in ts/apps/web/src/rooms/{plan,table}.tsx, mirrored by `rows`: a region's
label is its name, else `R{n}` by its place in the whole snapshot's table order. The label printed here is the
label in the /rooms table. Colours: room orange, held red, zone purple dashed, truth blue; fill alpha 70, outline
4 px. `--focus` draws only the named labels' callouts and dims every other region to its outline.
"""
import argparse
import hashlib
import json
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont
from shapely.geometry import Point, Polygon, box as shapely_box

ROOM, HELD, TRUTH, ZONE = (224, 112, 27), (215, 38, 61), (31, 79, 214), (120, 40, 160)
INK = {"room": ROOM, "held": HELD, "zone": ZONE}
FILL_ALPHA, OUTLINE_PX = 70, 4
RINGS = (0, 3, 5, 8, 11, 15, 20)  # callout search radii, in pin radii
COMPASS = ((1, -1), (1, 1), (-1, -1), (-1, 1), (1, 0), (0, -1), (0, 1), (-1, 0))


def rows(regions, levels):
    """`roomRows` in table.tsx: level (the snapshot's levels by elevation), then zones, their rooms zone by zone,
    unassigned rooms, held; area largest first within each. Zones rank by area across the whole snapshot. The sort
    is stable, so ties keep snapshot order. Returns [(label, region)] with label = name, else `R{index + 1}`.
    Residual: level-name ties use Python ordering where the route uses `localeCompare`; they meet only for two
    levels absent from the level list."""
    order = [level["name"] for level in sorted(levels, key=lambda level: level["elevation"])]
    zones = [z["guid"] for z in sorted((r for r in regions if r["role"] == "zone"), key=lambda z: -z["sqft"])]

    def rank(level):
        return order.index(level) if level in order else len(order)

    def zone_at(guid):
        return zones.index(guid) if guid in zones else len(zones)

    def group(r):
        if r["role"] == "zone":
            return 0
        if r["role"] == "held":
            return 3
        return 2 if r["role"] == "room" and r.get("zone") is None else 1

    ranked = sorted(regions, key=lambda r: (rank(r["level"]), r["level"], group(r), zone_at(r.get("zone")), -r["sqft"]))
    return [(r["name"] or f"R{i + 1}", r) for i, r in enumerate(ranked)]


def load(path):
    """The operation's response from a CLI output file or a bare response."""
    text = Path(path).read_text(encoding="utf-8-sig", errors="replace")
    decoder, at = json.JSONDecoder(), text.find("{")
    while at >= 0:
        try:
            doc, _ = decoder.raw_decode(text[at:])
            return doc.get("response", doc.get("result", doc))
        except json.JSONDecodeError:
            at = text.find("{", at + 1)
    sys.exit(f"{path}: no JSON object")


def mapper(reg):
    """Model XY -> pixel: the inverse of the registration's corner affine (rotated crops included)."""
    (x0, y0), (x1, y1), (x2, y2) = reg["topLeft"], reg["topRight"], reg["bottomLeft"]
    a, c = (x1 - x0) / reg["width"], (x2 - x0) / reg["height"]
    b, d = (y1 - y0) / reg["width"], (y2 - y0) / reg["height"]
    det = a * d - b * c
    return lambda p: ((d * (p[0] - x0) - c * (p[1] - y0)) / det, (a * (p[1] - y0) - b * (p[0] - x0)) / det)


def image_for(view_image, vi_path):
    want = view_image["registration"]["imageSha256"]
    candidates = [Path(view_image.get("filePath", ""))] + sorted(Path(vi_path).parent.glob("*.png"))
    for png in candidates:
        if png.is_file() and hashlib.sha256(png.read_bytes()).hexdigest() == want:
            return png
    sys.exit(f"no PNG with sha256 {want[:12]} at filePath or beside {vi_path}")


def font(size, bold=True):
    try:
        return ImageFont.truetype("C:/Windows/Fonts/arialbd.ttf" if bold else "C:/Windows/Fonts/arial.ttf", size)
    except OSError:
        return ImageFont.load_default(size)


def dashed(d, ring, fill, width, on=18, off=12):
    for a, b in zip(ring, ring[1:] + ring[:1]):
        length = ((b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2) ** 0.5
        s = 0.0
        while s < length:
            e = min(s + on, length)
            d.line([(a[0] + (b[0] - a[0]) * s / length, a[1] + (b[1] - a[1]) * s / length),
                    (a[0] + (b[0] - a[0]) * e / length, a[1] + (b[1] - a[1]) * e / length)], fill=fill, width=width)
            s = e + off


def annotate(snapshot, view_image, png, out, focus=(), truth=None, crop=False, title=None):
    reg, view = view_image["registration"], view_image["view"]["label"]
    f = mapper(reg)
    base = Image.open(png).convert("RGBA")
    W, H = base.size
    frame = shapely_box(0, 0, W, H)
    labelled = rows(snapshot["regions"], snapshot["levels"])
    known = {label for label, _ in labelled}
    missing = [label for label in focus if label not in known]
    if missing:
        sys.exit(f"--focus labels not in the snapshot: {', '.join(missing)}")

    drawn = []  # (label, region, outer px, holes px, shapely px polygon, focused)
    for label, r in labelled:
        if r["view"] != view:
            continue
        outer = [f(p) for p in r["outer"]]
        holes = [[f(p) for p in h] for h in r["holes"]]
        poly = Polygon(outer, holes).buffer(0)
        if poly.intersects(frame):
            drawn.append((label, r, outer, holes, poly, not focus or label in focus))
    lit = [item for item in drawn if item[5]]

    x0, y0, x1, y1 = 0, 0, W, H
    if crop and lit:
        bx0 = min(item[4].bounds[0] for item in lit); by0 = min(item[4].bounds[1] for item in lit)
        bx1 = max(item[4].bounds[2] for item in lit); by1 = max(item[4].bounds[3] for item in lit)
        mx, my = (bx1 - bx0) * 0.05, (by1 - by0) * 0.05
        x0, y0 = max(0, int(bx0 - mx)), max(0, int(by0 - my))
        x1, y1 = min(W, int(bx1 + mx) + 1), min(H, int(by1 + my) + 1)
    r = max(14, round(max(x1 - x0, y1 - y0) / 100))

    ov = Image.new("RGBA", base.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(ov)
    for label, reg_, outer, holes, poly, on in drawn:
        col = INK.get(reg_["role"], ROOM)
        if not on:
            for ring in [outer] + holes:
                d.line(ring + ring[:1], fill=col + (130,), width=2)
            continue
        if reg_["role"] == "zone":
            dashed(d, outer, col + (255,), OUTLINE_PX + 1)
            continue
        bx0, by0 = max(0, int(poly.bounds[0])), max(0, int(poly.bounds[1]))
        bx1, by1 = min(W, int(poly.bounds[2]) + 2), min(H, int(poly.bounds[3]) + 2)
        mask = Image.new("L", (bx1 - bx0, by1 - by0), 0)
        md = ImageDraw.Draw(mask)
        md.polygon([(x - bx0, y - by0) for x, y in outer], fill=FILL_ALPHA)
        for h in holes:
            md.polygon([(x - bx0, y - by0) for x, y in h], fill=0)
        layer = Image.new("RGBA", mask.size, col + (0,))
        layer.putalpha(mask)
        ov.alpha_composite(layer, (bx0, by0))
        for ring in [outer] + holes:
            d.line(ring + ring[:1], fill=col + (255,), width=OUTLINE_PX, joint="curve")
    for room in truth or []:
        for loop in room["loops"]:
            ring = [f(p) for p in zip(loop[::2], loop[1::2])]
            d.line(ring + ring[:1], fill=TRUTH + (255,), width=OUTLINE_PX + 1)
    img = Image.alpha_composite(base, ov)

    d = ImageDraw.Draw(img)
    fs, ft = font(r), font(round(r * 0.9))
    placed, printed, crowded = [], [], []
    for label, reg_, outer, holes, poly, on in lit:
        col = INK.get(reg_["role"], ROOM)
        seen = poly.intersection(shapely_box(x0, y0, x1, y1))
        if seen.is_empty:
            continue
        ax, ay = f(reg_["label"])
        if not seen.contains(Point(ax, ay)):
            ax, ay = seen.representative_point().coords[0]
        text = f"{reg_['sqft']:.1f} sf" + (f" {reg_['reason']}" if reg_["role"] == "held" and reg_.get("reason") else "")
        text = ("zone " if reg_["role"] == "zone" else "") + text
        pw = max(2 * r, d.textlength(label, font=fs) + r)
        tw = d.textlength(text, font=ft)
        best = None
        for ring in RINGS:
            for dx, dy in COMPASS:
                cx, cy = ax + dx * ring * r * 0.8, ay + dy * ring * r * 0.8
                bx = (cx - r - 4, cy - r - 4, cx - r + pw + 8 + tw + 12, cy + r + 4)
                if bx[0] < x0 or bx[1] < y0 or bx[2] > x1 or bx[3] > y1:
                    continue
                if any(not (bx[2] < b[0] or bx[0] > b[2] or bx[3] < b[1] or bx[1] > b[3]) for b in placed):
                    continue
                best = (cx, cy, bx)
                break
            if best:
                break
        if best is None:
            crowded.append(label)
        cx, cy, bx = best or (ax, ay, (ax, ay, ax, ay))
        placed.append(bx)
        if (cx, cy) != (ax, ay):
            d.line([(ax, ay), (cx, cy)], fill=col + (255,), width=3)
            d.ellipse([ax - 5, ay - 5, ax + 5, ay + 5], fill=col + (255,))
        left = cx - r + pw
        d.rounded_rectangle([left - 4, cy - r * 0.75, left + 8 + tw + 8, cy + r * 0.75], radius=6,
                            fill=(255, 255, 255, 235), outline=col + (255,), width=2)
        d.rounded_rectangle([cx - r, cy - r, left, cy + r], radius=r, fill=col + (255,), outline=(255, 255, 255), width=3)
        d.text(((cx - r + left) / 2, cy), label, font=fs, fill="white", anchor="mm")
        d.text((left + 8, cy), text, font=ft, fill=(20, 20, 20), anchor="lm")
        printed.append((label, reg_, text))
    img = img.crop((x0, y0, x1, y1))

    runs = sorted({reg_["runId"] for _, reg_, _ in printed})
    legend = [
        (None, title or f"{view}: {len(printed)} callouts, runs {', '.join(runs) or 'none'}"),
        (ROOM, "room: pin = its /rooms table label (name, else R{n} in table order), then its area"),
        (HELD, "held: residue partition could not place, with its reason"),
        (ZONE, "zone: dashed outline, the scope partition splits"),
    ]
    if truth:
        legend.append((TRUTH, f"truth rooms ({len(truth)})"))
    if focus:
        legend.append((None, f"focus {', '.join(focus)}; every other region outline only"))
    if crowded:
        legend.append((None, f"{len(crowded)} callouts found no free spot and sit on their region (may overlap); narrow with --focus"))
    fpp = ((reg["topRight"][0] - reg["topLeft"][0]) ** 2 + (reg["topRight"][1] - reg["topLeft"][1]) ** 2) ** 0.5 / reg["width"]
    legend.append((None, f"mapping: registration corners, image sha256 {reg['imageSha256'][:12]} matched, {fpp:.3f} ft/px"))
    lf, lh = font(round(r * 1.05), bold=False), round(r * 1.6)
    Wc, Hc = img.size
    outim = Image.new("RGB", (Wc, Hc + lh * (len(legend) + 1) + 20), (250, 250, 250))
    outim.paste(img.convert("RGB"), (0, 0))
    sd = ImageDraw.Draw(outim)
    sd.line([(0, Hc + 2), (Wc, Hc + 2)], fill=(60, 60, 60), width=4)
    for i, (sw, line) in enumerate(legend):
        y = Hc + 20 + i * lh + lh // 2
        if sw:
            sd.rectangle([20, y - r // 2, 20 + r, y + r // 2], fill=sw)
        sd.text((30 + r + 10, y), line, font=lf, fill=(20, 20, 20), anchor="lm")
    outim.save(out)
    for label, reg_, text in printed:
        print(f"{label}\t{reg_['role']}\t{reg_['elementId']}\t{text}")
    print(out, outim.size, file=sys.stderr)
    return printed


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("snapshot"), ap.add_argument("view_image"), ap.add_argument("out")
    ap.add_argument("--focus", default="", help="comma list of table labels, e.g. R1,R7")
    ap.add_argument("--truth", help="truth JSON with rooms[].loops (flat x,y lists)")
    ap.add_argument("--crop", action="store_true", help="crop to the drawn regions plus 5 percent")
    ap.add_argument("--title")
    a = ap.parse_args()
    view_image = load(a.view_image)
    truth = json.loads(Path(a.truth).read_text(encoding="utf-8-sig"))["rooms"] if a.truth else None
    annotate(load(a.snapshot), view_image, image_for(view_image, a.view_image), a.out,
             [s for s in a.focus.split(",") if s], truth, a.crop, a.title)


if __name__ == "__main__":
    main()
