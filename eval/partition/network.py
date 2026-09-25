"""Render RailsRun data from .artifacts/runs/rails/w2/data: faces 35% fill, 1 px edges over capture ink, rails blue,
openings door red / headed orange / cased green / wall-ink purple. Also prints the opening census. W3 metrics.py owns the scores."""
import json, math, sys, glob, os
from collections import Counter
from PIL import Image, ImageDraw
from shapely.geometry import Polygon, LineString

HERE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", ".artifacts", "runs", "rails", "w2")
PAL = [(31, 119, 180), (255, 127, 14), (44, 160, 44), (214, 39, 40), (148, 103, 189), (140, 86, 75), (227, 119, 194), (23, 190, 207), (188, 189, 34)]
OPEN = {"Door": (220, 0, 0), "Headed": (255, 140, 0), "Cased": (0, 170, 0), "Closed": (150, 0, 200)}


def ring(flat):
    return list(zip(flat[::2], flat[1::2]))


def far(p):
    pts = ring(p)
    best = max(((a, b) for i, a in enumerate(pts) for b in pts[i + 1:]), key=lambda ab: math.dist(*ab), default=None)
    return best


def axes(rails):
    h = Counter()
    for r in rails:
        a, b = r["A"], r["B"]
        ang = math.degrees(math.atan2(b[1] - a[1], b[0] - a[0])) % 90
        h[int(round(ang)) % 90] += math.dist(a, b)
    top = h.most_common()
    peaks = [top[0][0]]
    for ang, w in top[1:]:
        if w >= 0.2 * top[0][1] and all(min(abs(ang - p), 90 - abs(ang - p)) > 5 for p in peaks):
            peaks.append(ang)
            break
    return peaks


def measure(rooms, peaks):
    total = straight = ortho = verts = 0.0
    for r in rooms:
        for flat in [r["Loop"]] + (r["Holes"] or []):
            pts = list(Polygon(ring(flat)).simplify(0.05).exterior.coords)
            verts += len(pts) - 1
            for a, b in zip(pts, pts[1:]):
                L = math.dist(a, b)
                total += L
                if L > 3: straight += L
                ang = math.degrees(math.atan2(b[1] - a[1], b[0] - a[0])) % 90
                if any(min(abs(ang - p), 90 - abs(ang - p)) <= 2 for p in peaks): ortho += L
    return dict(straight=straight / total, ortho=ortho / total, vertsPer100ft=100 * verts / total, edgeFt=total)


def render(d, path):
    zone = [ring(z) for z in d["zone"]]
    xs = [x for z in zone for x, _ in z]; ys = [y for z in zone for _, y in z]
    x0, x1, y0, y1 = min(xs) - 3, max(xs) + 3, min(ys) - 3, max(ys) + 3
    s = 1600 / max(x1 - x0, y1 - y0)
    W, H = int((x1 - x0) * s), int((y1 - y0) * s)
    P = lambda x, y: ((x - x0) * s, (y1 - y) * s)
    img = Image.new("RGB", (W, H), "white")
    g = ImageDraw.Draw(img)
    for i in d["ink"]:
        ab = far(i["p"])
        if ab: g.line([P(*ab[0]), P(*ab[1])], fill=(215, 170, 120) if i["c"] == "Generic Models" else (150, 150, 150), width=1)
    img = img.convert("RGBA")
    for k, r in enumerate(d["rooms"]):
        c = PAL[k % len(PAL)] if r["Disposition"] == "Accepted" else (120, 120, 120)
        mask = Image.new("L", (W, H), 0)
        m = ImageDraw.Draw(mask)
        m.polygon([P(*p) for p in ring(r["Loop"])], fill=89)  # 35 percent
        for h in r["Holes"] or []: m.polygon([P(*p) for p in ring(h)], fill=0)
        img = Image.composite(Image.new("RGBA", (W, H), c + (255,)), img, mask)
    g = ImageDraw.Draw(img)
    for k, r in enumerate(d["rooms"]):
        c = PAL[k % len(PAL)] if r["Disposition"] == "Accepted" else (90, 90, 90)
        pts = [P(*p) for p in ring(r["Loop"])]
        g.line(pts + pts[:1], fill=c, width=1)
        lab = Polygon(ring(r["Loop"])).representative_point()
        g.text(P(lab.x, lab.y), f"{r['AreaSqft']:.0f}" + ("" if r["Disposition"] == "Accepted" else f" {r['Reason']}"), fill=(0, 0, 0))
    for r in d["rails"]:
        g.line([P(*r["A"]), P(*r["B"])], fill=(0, 90, 255), width=1)
    for z in zone:
        g.line([P(*p) for p in z + z[:1]], fill=(0, 0, 0), width=1)
    for sgm in d["segments"]:
        if sgm["Kind"] == "Closed": g.line([P(*sgm["A"]), P(*sgm["B"])], fill=OPEN["Closed"], width=2)
    for op in d["openings"]:
        g.line([P(*op["A"]), P(*op["B"])], fill=OPEN[op["Kind"]], width=3)
    img.convert("RGB").save(path)


rows = []
for f in sorted(glob.glob(os.path.join(HERE, "data", "*.json"))):
    d = json.load(open(f))
    name = d["name"]
    render(d, os.path.join(HERE, name + ".png"))
    peaks = axes(d["rails"])
    acc = [r for r in d["rooms"] if r["Disposition"] == "Accepted"]
    m = measure(d["rooms"], peaks)
    census = Counter(o["Kind"] for o in d["openings"])
    widths = sorted(o["WidthFt"] for o in d["openings"])
    rows.append(dict(name=name, rooms=len(d["rooms"]), accepted=len(acc), held=Counter(r["Reason"] for r in d["rooms"] if r["Disposition"] != "Accepted"),
                     zoneSqft=round(d["accounting"]["ZoneSqft"], 1), axes=peaks, **{k: round(v, 3) for k, v in m.items()},
                     openings=dict(census), closed=sum(1 for s in d["segments"] if s["Kind"] == "Closed"),
                     widthP50=widths[len(widths) // 2] if widths else None, ms=d["ms"],
                     openingRows=[(o["Kind"], o["WidthFt"], o["DoorPieces"], o["HeaderFraction"]) for o in d["openings"]]))
json.dump(rows, open(os.path.join(HERE, "metrics.json"), "w"), indent=1, default=str)
for r in rows:
    print(r["name"], "rooms", r["rooms"], "acc", r["accepted"], dict(r["held"]), "zone", r["zoneSqft"], "axes", r["axes"],
          "straight", r["straight"], "ortho", r["ortho"], "v/100ft", r["vertsPer100ft"], "open", r["openings"], "closed", r["closed"], "ms", r["ms"])
