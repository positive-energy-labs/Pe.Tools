# Synthetic-geometry unit checks for score-looks-good.py — no replay-bin dependency.
# Run: python -m pytest eval/rhvac/test_score_looks_good.py  (or python <this file>)
import importlib.util
import math
import os
import sys

import numpy as np
from shapely.geometry import Polygon

_here = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, _here)
_spec = importlib.util.spec_from_file_location(
    "score_looks_good", os.path.join(_here, "score-looks-good.py"))
slg = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(slg)


def test_representative_point_inside_c_shape():
    # U-shaped room whose vertex-mean falls in the notch (outside the polygon)
    u = Polygon([(0, 0), (10, 0), (10, 10), (7, 10), (7, 2), (3, 2), (3, 10), (0, 10)])
    mean = (np.mean([p[0] for p in u.exterior.coords[:-1]]),
            np.mean([p[1] for p in u.exterior.coords[:-1]]))
    assert not u.contains(slg.Point(*mean)), "test premise: vertex-mean must be outside"
    assert u.contains(slg.representative_point(u))


def test_collapse_collinear_removes_midpoints():
    pts = slg.collapse_collinear([(0, 0), (5, 0), (10, 0), (10, 10), (0, 10), (0, 0)])
    assert len(pts) == 4
    assert (5, 0) not in pts


def test_ortho_stats_axis_aligned_rectangle():
    stats = slg.ortho_stats(Polygon([(0, 0), (10, 0), (10, 6), (0, 6)]), frame_deg=0.0)
    assert stats["verts"] == 4
    assert stats["normVerts"] == 4
    assert stats["offFrameEdges"] == 0
    assert stats["onFrameLenFraction"] == 1.0
    assert stats["editCost"] == 4


def test_ortho_stats_rotated_rect_in_matching_frame():
    c, s = math.cos(math.radians(45)), math.sin(math.radians(45))
    rot = [(x * c - y * s, x * s + y * c) for x, y in [(0, 0), (10, 0), (10, 6), (0, 6)]]
    stats = slg.ortho_stats(Polygon(rot), frame_deg=45.0)
    assert stats["offFrameEdges"] == 0
    assert stats["normVerts"] == 4


def test_ortho_stats_flags_off_frame_edge():
    # rectangle with one 10-degree bevel edge
    poly = Polygon([(0, 0), (10, 0), (10, 5), (8, 5.35), (0, 5.35)])  # ~10 deg segment
    stats = slg.ortho_stats(poly, frame_deg=0.0)
    assert stats["offFrameEdges"] == 1
    assert stats["onFrameLenFraction"] < 1.0
    assert stats["editCost"] == stats["normVerts"] + 2


def test_frame_angle_from_rotated_zone():
    c, s = math.cos(math.radians(30)), math.sin(math.radians(30))
    loop = [[x * c - y * s, x * s + y * c] for x, y in [(0, 0), (40, 0), (40, 20), (0, 20)]]
    assert abs(slg.frame_angle_deg([loop]) - 30.0) < 0.01


def _grid_with_ink(cells, w=40, h=40, cell=0.25):
    mask = np.zeros((h, w), dtype=bool)
    for r, c in cells:
        mask[r, c] = True
    return slg.Grid(mask, 0.0, 0.0, cell)


def test_backed_fraction_full_and_empty():
    # ink everywhere -> fully backed; no ink -> zero
    full = slg.Grid(np.ones((40, 40), dtype=bool), 0.0, 0.0, 0.25)
    empty = slg.Grid(np.zeros((40, 40), dtype=bool), 0.0, 0.0, 0.25)
    room = Polygon([(2, 2), (8, 2), (8, 8), (2, 8)])
    frac_full, sampled, _ = slg.backed_stats(room, full, zone_boundary=None)
    frac_empty, _, _ = slg.backed_stats(room, empty, zone_boundary=None)
    assert sampled > 0
    assert frac_full == 1.0
    assert frac_empty == 0.0


def test_backed_fraction_all_exempt_returns_none():
    grid = slg.Grid(np.zeros((40, 40), dtype=bool), 0.0, 0.0, 0.25)
    room = Polygon([(2, 2), (8, 2), (8, 8), (2, 8)])
    frac, sampled, exempt = slg.backed_stats(room, grid, zone_boundary=room.boundary,
                                             exempt_ft=1.0)
    assert frac is None
    assert sampled == 0
    assert exempt > 0


def test_interior_swallow_detects_interior_ink_only():
    # 10x10 ft room on a 0.25 ft grid; ink stripe through the middle = swallowed wall;
    # ink hugging the boundary stays inside the 1.5 ft wall-claim band and is ignored.
    room = Polygon([(0, 0), (10, 0), (10, 10), (0, 10)])
    mid_row = 20  # y = 5.125 ft, deep interior
    interior_ink = _grid_with_ink([(mid_row, c) for c in range(10, 30)])
    band_ink = _grid_with_ink([(1, c) for c in range(0, 40)])  # y = 0.375 ft
    assert slg.interior_swallow(room, interior_ink) > 0
    assert slg.interior_swallow(room, band_ink) == 0.0


def test_zone_geometry_even_odd():
    outer = [[0, 0], [10, 0], [10, 10], [0, 10]]
    inner = [[3, 3], [7, 3], [7, 7], [3, 7]]
    geom = slg.zone_geometry([outer, inner])
    assert abs(geom.area - (100 - 16)) < 1e-6
    assert not geom.contains(slg.Point(5, 5))
    assert geom.contains(slg.Point(1, 1))


def test_symmetric_boundary_distance_offset_squares():
    a = Polygon([(0, 0), (10, 0), (10, 10), (0, 10)])
    b = Polygon([(1, 0), (11, 0), (11, 10), (1, 10)])  # shifted 1 ft in x
    mean, worst = slg.symmetric_boundary_distance(a, b)
    assert 0 < mean < 1.0
    assert abs(worst - 1.0) < 0.05


if __name__ == "__main__":
    failures = 0
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            try:
                fn()
                print(f"PASS {name}")
            except AssertionError as error:
                failures += 1
                print(f"FAIL {name}: {error}")
    sys.exit(1 if failures else 0)
