"""Score whether a PSC1 scene artifact can read as a building (MINED M8). Deterministic, stdlib only.

Usage: python -I tools/scene_readability.py <scene.bin> [<scene.bin> ...]
Scenes live in %LOCALAPPDATA%/Positive Energy/Pe.Tools/cache/space-scenes/. Format: ts/apps/web/src/scene/psc1.ts.
Prints one JSON report per file. Counts describe the artifact, not the model it came from.
"""
import collections
import json
import math
import struct
import sys

MAGIC = 0x31435350  # "PSC1" little-endian
FORMAT = "space-scene-v3"
# Square-in-plan boxes are the signature of rotated objects drawn as world AABBs (the 45 degree wing).
EQUAL_XY_FT = 0.01
NOISE = (("center line", "MEP centre-line helper, not geometry"), ("centerline", "MEP centre-line helper, not geometry"),
         ("insulation", "insulation: a shell over a host"), ("lining", "lining: a shell inside a host"),
         (".dwg", "CAD import"), ("import", "CAD import"))


def load(path):
    with open(path, "rb") as f:
        data = f.read()
    if len(data) < 8 or struct.unpack_from("<I", data, 0)[0] != MAGIC:
        raise ValueError(f"{path}: not a PSC1 scene artifact")
    length = struct.unpack_from("<I", data, 4)[0]
    if 8 + length > len(data):
        raise ValueError(f"{path}: truncated metadata")
    meta = json.loads(data[8:8 + length])
    if meta.get("format") != FORMAT:
        raise ValueError(f"{path}: format {meta.get('format')!r}, scorer reads {FORMAT!r}")
    return meta


def extents(e):
    b = e["bounds"]
    return b["maxX"] - b["minX"], b["maxY"] - b["minY"], b["maxZ"] - b["minZ"]


def percentiles(values):
    if not values:
        return None
    s = sorted(values)
    return {f"p{q}": round(s[min(len(s) - 1, int(len(s) * q / 100))], 3) for q in (50, 90, 99)} | {"max": round(s[-1], 3)}


def noise_reason(category):
    name = (category or "").lower()
    return next((reason for key, reason in NOISE if key in name), None)


def score(meta):
    elements = meta["elements"]
    context = [e for e in elements if not e["focus"]]
    boxes = [e for e in context if e["representation"] == "box"]
    square = [e for e in boxes if abs(extents(e)[0] - extents(e)[1]) <= EQUAL_XY_FT]

    by_category = collections.defaultdict(collections.Counter)
    for e in context:
        by_category[e["handle"]["category"]][e["representation"]] += 1
    noise = {c: {"count": sum(r.values()), "reason": noise_reason(c)} for c, r in by_category.items() if noise_reason(c)}

    bins, lengths = collections.Counter(), collections.Counter()
    for e in elements:
        r = e.get("run")
        if not r:
            continue
        dx, dy = r["end"][0] - r["start"][0], r["end"][1] - r["start"][1]
        plan = math.hypot(dx, dy)
        if plan < 1e-3:
            continue  # vertical run: no bearing
        b = int((math.degrees(math.atan2(dy, dx)) % 90) // 5) * 5
        bins[b] += 1
        lengths[b] += plan
    bearing_total = sum(bins.values())
    off_axis = sum(n for b, n in bins.items() if b not in (0, 85)) / bearing_total if bearing_total else 0.0

    square_share = len(square) / len(boxes) if boxes else 0.0
    noise_count = sum(v["count"] for v in noise.values())
    noise_share = noise_count / len(context) if context else 0.0
    issues = []
    if square_share > 0.2:
        issues.append(f"{100 * square_share:.0f}% of context boxes are square in plan (rotated objects as world boxes, or truly square things: see equalXYByCategory)")
    if noise_share > 0.1:
        issues.append(f"{100 * noise_share:.0f}% of context is centre lines, insulation or CAD")
    if off_axis > 0.1 and boxes:
        issues.append(f"{100 * off_axis:.0f}% of runs are off the 0/90 frame while context is boxes")
    verdict = ("suspect: " + "; ".join(issues)) if issues else "no readability flag raised (not proof it reads)"

    return {
        "format": meta.get("format"), "phase": meta.get("phase"),
        "elements": len(elements), "focus": len(elements) - len(context), "context": len(context),
        "contextBoxes": len(boxes), "equalXYBoxes": len(square), "equalXYShare": round(square_share, 4),
        "equalXYByCategory": dict(collections.Counter(e["handle"]["category"] for e in square).most_common(10)),
        "boxMaxExtentFt": percentiles([max(extents(e)) for e in boxes]),
        "boxVolumeFt3": percentiles([math.prod(extents(e)) for e in boxes]),
        "contextByCategory": {c: dict(sorted(r.items())) for c, r in sorted(by_category.items())},
        "contextByRepresentation": dict(sorted(collections.Counter(e["representation"] for e in context).items())),
        "noise": dict(sorted(noise.items())), "noiseShare": round(noise_share, 4),
        "runBearingMod90": [{"fromDegrees": b, "count": bins[b], "planLengthFt": round(lengths[b], 1)} for b in sorted(bins)],
        "offAxisRunShare": round(off_axis, 4),
        "verdict": verdict,
    }


def main(argv):
    if not argv:
        print(__doc__, file=sys.stderr)
        return 2
    failed = 0
    for path in argv:
        try:
            print(json.dumps({"path": path} | score(load(path)), indent=2))
        except ValueError as e:
            print(json.dumps({"path": path, "error": str(e)}, indent=2))
            failed = 1
    return failed


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
