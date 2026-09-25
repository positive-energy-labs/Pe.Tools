"""Shape metrics for a partition bench run (rails brief, W3). stdlib + PIL only.

    python eval/partition/metrics.py .artifacts/runs/bench/<stamp>

Reads <fixture>/answer.json and ink.json written by Pe.Partition.Tests/Bench.cs, writes
<fixture>/metrics.json and <run>/TABLE.md, prints one table for the run and a delta table against
the previous run under the same parent. Every number moves along an axis a person sees on the render
(diagonals, curves, wobble, slivers, holes, floating edges); none rewards room count.

Edges measured are the solver's own: segments whose midpoint lies within 1 ft of the zone boundary
are the person's zone edge and are excluded from every edge metric.
"""
import json
import math
import os
import statistics
import sys
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw

SIMPLIFY_FT = 0.05      # Douglas-Peucker tolerance before edges are read
STRAIGHT_FT = 3.0       # a segment at least this long reads as one intended rail
ORTHO_DEG = 2.0         # within this of a dominant axis reads as orthogonal
SAMPLE_FT = 0.5         # edge sample pitch for ink adherence
ZONE_EDGE_FT = 1.0      # Solve.ZoneEdgeExemptFt: this close to the zone loop is the person's edge
FLOAT_FT = 1.0          # an edge sample farther than this from any ink floats
INK_CAP_FT = 4.0        # ponytail: distance search stops here; farther is reported as 4.0
SLIVER_SQFT = 15.0
TRUTH_PX_FT = 0.1       # raster pitch for the truth symmetric difference
TRUTH_SAMPLE_FT = 0.25  # boundary sample pitch for the truth Hausdorff

# fixture -> truth file under the private fixture root (kaitpw's hand-drawn rooms, see capture-truth.cs)
TRUTH = {
    "project-a-live": "project-a/truth/Main Level.json",
    "project-a-main-09": "project-a/truth/Main Level.json",
    "project-c-live": "project-c/truth/Level 2.json",
    "project-c-level2": "project-c/truth/Level 2.json",
    "duryee-level1": "duryee/truth/Level 1.json",
}
COLUMNS = [
    ("straight", "{:.3f}"), ("vert/100ft", "{:.1f}"), ("ortho", "{:.3f}"), ("ink_p50", "{:.2f}"),
    ("ink_p90", "{:.2f}"), ("floating", "{:.3f}"), ("slivers", "{:d}"), ("sliver_sf", "{:.1f}"),
    ("holes_sf", "{:.2f}"), ("truth_symdiff", "{:.3f}"), ("truth_hausdorff", "{:.2f}"),
]


def pts(flat):
    return [(flat[i], flat[i + 1]) for i in range(0, len(flat), 2)]


def area(loop):
    return 0.5 * abs(sum(x0 * y1 - x1 * y0 for (x0, y0), (x1, y1) in zip(loop, loop[1:] + loop[:1])))


def seg_dist(p, a, b):
    (px, py), (ax, ay), (bx, by) = p, a, b
    dx, dy = bx - ax, by - ay
    n = dx * dx + dy * dy
    t = 0.0 if n == 0 else max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / n))
    return math.hypot(px - (ax + t * dx), py - (ay + t * dy))


def simplify(loop, tol):
    """Douglas-Peucker on a closed ring, split at the two farthest-apart vertices."""
    def dp(chain):
        if len(chain) < 3:
            return chain
        a, b = chain[0], chain[-1]
        i, d = max(((k, seg_dist(chain[k], a, b)) for k in range(1, len(chain) - 1)), key=lambda kd: kd[1])
        if d <= tol:
            return [a, b]
        return dp(chain[:i + 1])[:-1] + dp(chain[i:])
    if len(loop) < 4:
        return loop
    far = max(range(1, len(loop)), key=lambda k: math.dist(loop[0], loop[k]))
    a = dp(loop[:far + 1])
    b = dp(loop[far:] + [loop[0]])
    return a[:-1] + b[:-1]


def segments(loop):
    return list(zip(loop, loop[1:] + loop[:1]))


def inside(p, loop):
    x, y = p
    hit = False
    for (x0, y0), (x1, y1) in segments(loop):
        if (y0 > y) != (y1 > y) and x < x0 + (y - y0) * (x1 - x0) / (y1 - y0):
            hit = not hit
    return hit


class InkIndex:
    """Knee pieces bucketed on a 2 ft grid; nearest-piece distance by ring search, capped."""
    CELL = 2.0

    def __init__(self, pieces):
        self.pieces = [pts(p) for p in pieces if len(p) >= 4]
        self.cells = {}
        for k, poly in enumerate(self.pieces):
            xs, ys = [p[0] for p in poly], [p[1] for p in poly]
            for cx in range(int(min(xs) // self.CELL), int(max(xs) // self.CELL) + 1):
                for cy in range(int(min(ys) // self.CELL), int(max(ys) // self.CELL) + 1):
                    self.cells.setdefault((cx, cy), []).append(k)

    def distance(self, p):
        cx, cy = int(p[0] // self.CELL), int(p[1] // self.CELL)
        best = INK_CAP_FT
        for ring in range(int(INK_CAP_FT // self.CELL) + 2):
            if (ring - 1) * self.CELL >= best:
                break
            for dx in range(-ring, ring + 1):
                for dy in range(-ring, ring + 1):
                    if max(abs(dx), abs(dy)) != ring:
                        continue
                    for k in self.cells.get((cx + dx, cy + dy), ()):
                        poly = self.pieces[k]
                        if len(poly) >= 3 and inside(p, poly):
                            return 0.0
                        best = min(best, min(seg_dist(p, a, b) for a, b in segments(poly)))
        return best

    def axes(self):
        """Dominant wall directions in degrees mod 90, from a length-weighted 1 degree histogram.
        A peak at 20 percent of the tallest bin or more is an axis, so a rotated wing scores fairly."""
        hist = [0.0] * 90
        for poly in self.pieces:
            for a, b in segments(poly):
                length = math.dist(a, b)
                if length > 0.05:
                    hist[int(math.degrees(math.atan2(b[1] - a[1], b[0] - a[0])) % 90)] += length
        top = max(hist) or 1.0
        peaks = [d for d in range(90) if hist[d] >= 0.2 * top and hist[d] >= hist[(d - 1) % 90] and hist[d] >= hist[(d + 1) % 90]]
        merged = []
        for d in sorted(peaks, key=lambda d: -hist[d]):
            if all(min(abs(d - m), 90 - abs(d - m)) > 3 for m in merged):
                merged.append(d)
        return merged or [0]


def drawn(rooms):
    return [r for r in rooms if r["Disposition"] != "Excluded"]


def edge_metrics(rooms, zones, ink):
    axes = ink.axes()
    own, zone_len, vertices = 0.0, 0.0, 0
    straight, ortho = 0.0, 0.0
    dists = []
    zone_segs = [s for z in zones for loop in z for s in segments(pts(loop))]
    for r in drawn(rooms):
        for ring in [r["Loop"]] + (r.get("Holes") or []):
            loop = simplify(pts(ring), SIMPLIFY_FT)
            for a, b in segments(loop):
                length = math.dist(a, b)
                if length == 0:
                    continue
                mid = ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)
                if min(seg_dist(mid, za, zb) for za, zb in zone_segs) < ZONE_EDGE_FT:
                    zone_len += length
                    continue
                own += length
                vertices += 1
                if length >= STRAIGHT_FT:
                    straight += length
                ang = math.degrees(math.atan2(b[1] - a[1], b[0] - a[0])) % 90
                if any(min(abs(ang - ax), 90 - abs(ang - ax)) <= ORTHO_DEG for ax in axes):
                    ortho += length
                n = max(1, int(length / SAMPLE_FT))
                for k in range(n + 1):
                    t = k / n
                    dists.append(ink.distance((a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1]))))
    dists.sort()
    if not ink.pieces:
        dists, axes = [], None  # no knee ink was captured: adherence and axes would measure nothing
    return {
        "own_edge_ft": round(own, 1), "zone_edge_ft": round(zone_len, 1), "axes_deg": axes,
        "straight": round(straight / own, 4) if own else None,
        "vert/100ft": round(100 * vertices / own, 2) if own else None,
        "ortho": round(ortho / own, 4) if own and axes else None,
        "ink_p50": round(statistics.median(dists), 3) if dists else None,
        "ink_p90": round(dists[int(0.9 * (len(dists) - 1))], 3) if dists else None,
        "floating": round(sum(d > FLOAT_FT for d in dists) / len(dists), 4) if dists else None,
    }


def is_sliver(r):
    """A room piece under 15 sf, accepted or held. Excluded wall bands and void are not rooms and never slivers."""
    return r["Disposition"] in ("Accepted", "Held") and r["AreaSqft"] < SLIVER_SQFT


def piece_metrics(rooms, zones):
    slivers = [r for r in rooms if is_sliver(r)]
    zone_area = sum(area(pts(loop)) for z in zones for loop in z)  # loops are even-odd; holes rare, ponytail
    return {
        "slivers": len(slivers), "sliver_sf": round(sum(r["AreaSqft"] for r in slivers), 2),
        "holes_sf": round(zone_area - sum(r["AreaSqft"] for r in rooms), 3),
        "zone_sf": round(zone_area, 1),
        "count_for_context_only": {d: sum(r["Disposition"] == d for r in rooms) for d in ("Accepted", "Held", "Void", "Excluded")},
    }


def raster(loops, box):
    (x0, y0, x1, y1) = box
    w, h = int((x1 - x0) / TRUTH_PX_FT) + 1, int((y1 - y0) / TRUTH_PX_FT) + 1
    img = Image.new("1", (w, h), 0)
    d = ImageDraw.Draw(img)
    for i, loop in enumerate(loops):
        d.polygon([((x - x0) / TRUTH_PX_FT, (y - y0) / TRUTH_PX_FT) for x, y in loop], fill=0 if i else 255)
    return img


def count(img):
    return img.histogram()[255] * TRUTH_PX_FT * TRUTH_PX_FT


def sample_ring(loop):
    out = []
    for a, b in segments(loop):
        n = max(1, int(math.dist(a, b) / TRUTH_SAMPLE_FT))
        out += [(a[0] + k / n * (b[0] - a[0]), a[1] + k / n * (b[1] - a[1])) for k in range(n)]
    return out


def hausdorff(la, lb):
    sa, sb = sample_ring(la), sample_ring(lb)
    def directed(s, ring):
        return max(min(seg_dist(p, a, b) for a, b in segments(ring)) for p in s)
    return max(directed(sa, lb), directed(sb, la))


def truth_metrics(rooms, zones, truth):
    """Per reference room inside the fixture's zones (half its area or more): symmetric-difference ratio and
    boundary Hausdorff against the best-overlapping drawn room, weighted by reference area. No count anywhere."""
    refs = [[pts(l) for l in r["loops"]] for r in truth["rooms"]]
    cands = [[pts(r["Loop"])] + [pts(h) for h in (r.get("Holes") or [])] for r in drawn(rooms)]
    zone_loops = [pts(loop) for z in zones for loop in z]
    rows, wsum, wsym, whaus = [], 0.0, 0.0, 0.0
    for ref in refs:
        xs = [x for x, _ in ref[0]]; ys = [y for _, y in ref[0]]
        box = (min(xs) - 2, min(ys) - 2, max(xs) + 2, max(ys) + 2)
        ref_img = raster(ref, box)
        ref_area = count(ref_img)
        if count(ImageChops.logical_and(ref_img, raster(zone_loops, box))) < 0.5 * ref_area:
            continue
        best, best_img, best_overlap = None, None, 0.0
        for k, cand in enumerate(cands):
            cx = [x for x, _ in cand[0]]; cy = [y for _, y in cand[0]]
            if max(cx) < box[0] or min(cx) > box[2] or max(cy) < box[1] or min(cy) > box[3]:
                continue
            img = raster(cand, box)
            overlap = count(ImageChops.logical_and(ref_img, img))
            if overlap > best_overlap:
                best, best_img, best_overlap = k, img, overlap
        if best is None:
            sym, haus = 1.0, INK_CAP_FT * 5  # ponytail: nothing drawn here at all; 20 ft stands in for "missing"
        else:
            sym = count(ImageChops.logical_xor(ref_img, best_img)) / ref_area
            haus = hausdorff(ref[0], cands[best][0])
        rows.append({"ref_sf": round(ref_area, 1), "match": best, "symdiff": round(sym, 4), "hausdorff_ft": round(haus, 3)})
        wsum += ref_area; wsym += ref_area * sym; whaus += ref_area * haus
    if not rows:
        return {"truth_symdiff": None, "truth_hausdorff": None, "truth_rooms": [], "truth_view": truth.get("view")}
    return {"truth_symdiff": round(wsym / wsum, 4), "truth_hausdorff": round(whaus / wsum, 3), "truth_rooms": rows,
            "truth_view": truth.get("view")}


def measure(fixture_dir, truth_root):
    answer = json.loads((fixture_dir / "answer.json").read_text())
    ink = InkIndex(json.loads((fixture_dir / "ink.json").read_text())["Knee"])
    m = {**edge_metrics(answer["Rooms"], answer["Zones"], ink), **piece_metrics(answer["Rooms"], answer["Zones"])}
    truth = truth_root / TRUTH.get(fixture_dir.name, "-")
    if truth.is_file():
        m.update(truth_metrics(answer["Rooms"], answer["Zones"], json.loads(truth.read_text())))
    else:
        m["truth_symdiff"] = m["truth_hausdorff"] = None
    (fixture_dir / "metrics.json").write_text(json.dumps(m, indent=1))
    return m


def table(rows, previous=None):
    head = ["fixture"] + [c for c, _ in COLUMNS]
    lines = ["| " + " | ".join(head) + " |", "|" + "---|" * len(head)]
    for name, m in rows.items():
        cells = [name]
        for c, fmt in COLUMNS:
            v = m.get(c)
            cell = "-" if v is None else fmt.format(v)
            if previous and c in previous.get(name, {}) and v is not None and previous[name][c] is not None:
                cell = "{:+.3f}".format(v - previous[name][c]) if not (isinstance(v, int) and isinstance(previous[name][c], int)) else "{:+d}".format(v - previous[name][c])
            cells.append(cell)
        lines.append("| " + " | ".join(cells) + " |")
    return "\n".join(lines)


def main(run):
    run = Path(run)
    truth_root = Path(os.environ.get("PE_PRIVATE_FIXTURES") or Path(__file__).resolve().parents[2] / ".private" / "fixtures")
    fixtures = [d for d in sorted(run.iterdir()) if (d / "answer.json").is_file()]
    rows = {d.name: measure(d, truth_root) for d in fixtures}
    out = f"# bench {run.name}\n\n{table(rows)}\n"
    held = ["| fixture | zone | zone sf | held sf | reason |", "|---|---|---|---|---|"]
    for d in fixtures:
        answer = json.loads((d / "answer.json").read_text())
        for r in sorted((r for r in answer["Rooms"] if r["Disposition"] == "Held"), key=lambda r: (r["Zone"], -r["AreaSqft"])):
            zone_sf = sum(area(pts(loop)) for loop in answer["Zones"][r["Zone"]])
            held.append(f"| {d.name} | {r['Zone']} | {zone_sf:.0f} | {r['AreaSqft']:.1f} | {r['Reason']} |")
    out += "\n## held\n\n" + "\n".join(held) + "\n"
    prior = [d for d in sorted(run.parent.iterdir()) if d.name < run.name and any((d / f / "metrics.json").is_file() for f in rows)]
    if prior:
        previous = {f: json.loads((prior[-1] / f / "metrics.json").read_text()) for f in rows if (prior[-1] / f / "metrics.json").is_file()}
        out += f"\n## delta against {prior[-1].name}\n\n{table(rows, previous)}\n"
    (run / "TABLE.md").write_text(out)
    print(out)


if __name__ == "__main__":
    main(sys.argv[1])
