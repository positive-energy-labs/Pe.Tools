# Partition-formulation diagnostics against the geometric oracle (PHASE2-PARTITION.md open
# questions). Consumes diag_<level>.bin rasters written by the ProjectAReplayDumpRun
# Dump_partition_diagnostics test (per-cell domain/obstruction masks + raw neighbor height
# steps in feet).
#
#   python eval/rhvac/diag-partition.py --diag-dir <dir>
#
# Answers, with measurements:
#   1. ATTIC: is the L3 shortfall a DOMAIN problem (existence mask misses GT area) or an
#      EVIDENCE problem (domain fine, boundaries wrong)? -> per-room domain coverage.
#   2. CALIBRATION: which evidence channels (obstruction ink, ceiling steps, floor steps) are
#      actually predictive of the engineer's wall lines, and at what threshold? -> precision
#      (fraction of positive cells within tol of a GT wall line) vs the domain base rate.
import argparse, json, os, struct

import numpy as np
from shapely.geometry import LineString, Polygon
from shapely.ops import unary_union
from shapely import contains_xy, prepare

HERE = os.path.dirname(os.path.abspath(__file__))
projectA = os.path.join(HERE, "project-a")
WALL_TOL_FT = 1.5


def load_diag(path):
    with open(path, "rb") as f:
        W, H = struct.unpack("<ii", f.read(8))
        minx, miny, cell = struct.unpack("<ddd", f.read(24))
        n = W * H
        domain = np.frombuffer(f.read(n), dtype=np.uint8).reshape(H, W).astype(bool)
        obst = np.frombuffer(f.read(n), dtype=np.uint8).reshape(H, W).astype(bool)
        ceil_step = np.frombuffer(f.read(4 * n), dtype=np.float32).reshape(H, W)
        floor_step = np.frombuffer(f.read(4 * n), dtype=np.float32).reshape(H, W)
    return dict(W=W, H=H, minx=minx, miny=miny, cell=cell,
                domain=domain, obst=obst, ceil_step=ceil_step, floor_step=floor_step)


def cell_centers(d):
    xs = d["minx"] + (np.arange(d["W"]) + 0.5) * d["cell"]
    ys = d["miny"] + (np.arange(d["H"]) + 0.5) * d["cell"]
    return np.meshgrid(xs, ys)


def floor_of(fname):
    # diag_Level_0_Lower_Level.bin -> 0
    return int(fname.split("Level_")[1][0])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--diag-dir", required=True)
    ap.add_argument("--geo", default=os.path.join(projectA, "oracle-geometry.json"))
    ap.add_argument("--wall-tol", type=float, default=WALL_TOL_FT)
    a = ap.parse_args()
    geo = json.load(open(a.geo))

    diags = {}
    for f in sorted(os.listdir(a.diag_dir)):
        if f.startswith("diag_") and f.endswith(".bin"):
            diags.setdefault(floor_of(f), []).append((f, load_diag(os.path.join(a.diag_dir, f))))

    # ---- 1. attic domain coverage of GT rooms (all floors printed; L3 is the question) ----
    print("== domain coverage of GT rooms (fraction of GT polygon area that is domain) ==")
    for fl in sorted(diags):
        rooms = [(int(n), g) for n, g in geo["rooms"].items() if g["floor"] == fl]
        if not rooms:
            continue
        rows = []
        for num, g in sorted(rooms):
            poly = Polygon(g["polygonModelFt"])
            if not poly.is_valid:
                poly = poly.buffer(0)
            prepare(poly)
            best_cov = best_obst = 0.0
            for _, d in diags[fl]:
                X, Y = cell_centers(d)
                inside = contains_xy(poly, X.ravel(), Y.ravel()).reshape(d["H"], d["W"])
                total = inside.sum()
                if total == 0:
                    continue
                cov = (inside & d["domain"]).sum() / total
                if cov > best_cov:
                    best_cov = cov
                    best_obst = (inside & d["obst"]).sum() / total
            rows.append((num, g["name"], best_cov, best_obst))
        covs = [r[2] for r in rows]
        print(f"floor {fl}: {len(rows)} GT rooms, mean domain cover {np.mean(covs):.2f}, "
              f"median {np.median(covs):.2f}, <70% cover: {sum(1 for c in covs if c < 0.7)}")
        if fl == 3:
            for num, name, cov, ob in rows:
                print(f"    #{num:>3} {name[:30]:<30} domain {cov:.2f}  obst-inside {ob:.2f}")

    # ---- 2. evidence-channel calibration vs mined wall lines ----
    print("\n== evidence channel precision vs GT wall lines "
          f"(fraction of positive cells within {a.wall_tol} ft of a wall line) ==")
    walls_by_floor = {}
    for w in geo.get("walls", []):
        if isinstance(w["floor"], int):
            walls_by_floor.setdefault(w["floor"], []).append(LineString(w["pointsModelFt"]))
    for fl in sorted(diags):
        lines = walls_by_floor.get(fl, [])
        if not lines:
            continue
        near = unary_union([l.buffer(a.wall_tol) for l in lines])
        prepare(near)
        for fname, d in diags[fl]:
            X, Y = cell_centers(d)
            in_near = contains_xy(near, X.ravel(), Y.ravel()).reshape(d["H"], d["W"])
            dom = d["domain"]
            base = in_near[dom].mean() if dom.any() else 0
            channels = [("obst", d["obst"])]
            for t in (0.5, 0.75, 1.5, 2.5):
                channels.append((f"ceilStep>={t}", d["ceil_step"] >= t))
            for t in (0.25, 0.35, 0.75):
                channels.append((f"floorStep>={t}", d["floor_step"] >= t))
            print(f"floor {fl} {fname}: domain base rate {base:.3f}")
            for name, mask in channels:
                m = mask & dom
                k = int(m.sum())
                prec = in_near[m].mean() if k else float("nan")
                lift = prec / base if base else float("nan")
                print(f"    {name:<15} cells={k:>8} precision={prec:.3f} lift={lift:.2f}")


if __name__ == "__main__":
    main()
