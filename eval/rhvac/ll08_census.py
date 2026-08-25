"""LL08 forensics census: every polygon (accepted + held residues), vertex/edge stats,
frame alignment, joined with rejection details from report.json."""
import json
import math
import sys

TSV = sys.argv[1] if len(sys.argv) > 1 else ".artifacts/runs/baseline/zones/rooms_01_09_Lower_Level_08.tsv"
REPORT = sys.argv[2] if len(sys.argv) > 2 else ".artifacts/runs/baseline/report.json"
ZONE = sys.argv[3] if len(sys.argv) > 3 else "Lower Level#08"


def parse_tsv(path):
    rooms = {}   # id -> dict
    kind = {}
    for line in open(path, encoding="utf-8"):
        parts = line.rstrip("\n").split("\t")
        if parts[0] == "ROOM":
            rid = parts[1]
            rooms[rid] = {"kind": "ROOM", "sqft": float(parts[2]), "polys": [],
                          "extra": parts[3:]}
        elif parts[0] == "POLY":
            rid = parts[1]
            ring = [tuple(map(float, p.split(";"))) for p in parts[3].split("|")]
            rooms.setdefault(rid, {"kind": "?", "sqft": 0.0, "polys": [], "extra": []})
            rooms[rid]["polys"].append((parts[2], ring))
        elif parts[0] == "META" and len(parts) > 2 and parts[1] == "residue":
            rid = parts[2]
            reason = parts[3]
            ring = [tuple(map(float, p.split(";"))) for p in parts[8].split("|")]
            rooms[rid] = {"kind": f"held:{reason}", "sqft": float(parts[4]),
                          "polys": [("outer", ring)], "extra": []}
    return rooms


def edge_stats(ring, frames=(0.0, 45.0)):
    """Classify each edge by angle mod 90 against candidate frames (tol 1 deg)."""
    n = len(ring)
    on_frame_len = 0.0
    off_frame_len = 0.0
    off_edges = []
    total = 0.0
    shortest = []
    for i in range(n):
        x0, y0 = ring[i]
        x1, y1 = ring[(i + 1) % n]
        L = math.hypot(x1 - x0, y1 - y0)
        if L < 1e-9:
            continue
        ang = math.degrees(math.atan2(y1 - y0, x1 - x0)) % 90.0
        d = min(min(abs(ang - f % 90), 90 - abs(ang - f % 90)) for f in frames)
        total += L
        shortest.append(L)
        if d <= 1.0:
            on_frame_len += L
        else:
            off_frame_len += L
            off_edges.append((L, ang))
    return {
        "edges": len(shortest),
        "perim": total,
        "onFrameFrac": on_frame_len / total if total else 0,
        "offEdges": len(off_edges),
        "offLen": off_frame_len,
        "medEdge": sorted(shortest)[len(shortest) // 2] if shortest else 0,
        "minEdge": min(shortest) if shortest else 0,
        "sub1ftEdges": sum(1 for L in shortest if L < 1.0),
    }


rooms = parse_tsv(TSV)
rep = json.load(open(REPORT, encoding="utf-8"))
zone = next(z for z in rep["Zones"] if z["Zone"] == ZONE)
det = zone["RejectionDetails"]

print(f"{'id':6} {'kind':8} {'sqft':>7} {'verts':>5} {'onFrame':>7} {'off#':>4} {'med':>5} {'<1ft':>4}  reason")
rows = []
for rid, r in sorted(rooms.items()):
    outer = next((ring for tag, ring in r["polys"] if tag == "outer"), None)
    if outer is None:
        continue
    s = edge_stats(outer)
    reason = det.get(rid) or det.get(f"ink/{rid}") or det.get(f"zonefit/{rid}") or det.get(f"scope/{rid}") or ""
    rows.append((rid, r["kind"], r["sqft"], len(outer), s, reason))
for rid, kind, sqft, nv, s, reason in rows:
    print(f"{rid:6} {kind:8} {sqft:7.1f} {nv:5} {s['onFrameFrac']:7.2f} {s['offEdges']:4} {s['medEdge']:5.2f} {s['sub1ftEdges']:4}  {reason[:90]}")

tot = sum(r[2] for r in rows)
print(f"\ntotal polys={len(rows)} sqft={tot:.0f}")
print("verts histogram:", sorted((r[3] for r in rows), reverse=True))
