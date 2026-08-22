# Synthetic geometry and artifact checks for score-looks-good.py.
# Run: python -m pytest eval/rhvac/test_score_looks_good.py  (or python <this file>)
import importlib.util
import gzip
import math
import os
import struct
import sys
import tempfile
from pathlib import Path

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


def _write_replay(path, mask):
    h, w = mask.shape
    bits = np.packbits(mask.ravel(), bitorder="little").tobytes()
    level, options = b"Main Level", b"{}"
    blob = (struct.pack("<IiB", 0x54414B53, 1, len(level)) + level
            + struct.pack("<dB", 0.0, len(options)) + options
            + struct.pack("<ii3d", w, h, 0.0, 0.0, 1.0)
            + bytes(8 * w * h) + bits)
    with gzip.open(path, "wb") as stream:
        stream.write(blob)


def test_load_levels_only_door_head_class_backs_edges():
    with tempfile.TemporaryDirectory() as temporary:
        root = Path(temporary)
        input_dir = root / "input"
        input_dir.mkdir()
        mask = np.zeros((1, 4), dtype=bool)
        _write_replay(input_dir / "replay_Level_1_Main_Level.bin", mask)
        header = struct.pack("<Iii3d", 0x504B4E49, 4, 1, 0.0, 0.0, 1.0)
        (input_dir / "seals_Level_1_Main_Level.bin").write_bytes(header + bytes([0b1111]))
        (input_dir / "close_Level_1_Main_Level.bin").write_bytes(header + bytes([0]))
        classes = struct.pack("<Iii3d", 0x434B4E49, 4, 1, 0.0, 0.0, 1.0)
        (input_dir / "classes_Level_1_Main_Level.bin").write_bytes(classes + bytes([1, 2, 3, 4]))
        report = {"Zones": [{
            "Level": "Main Level", "Ink": "input/ink_Level_1_Main_Level.bin",
            "Seals": "input/seals_Level_1_Main_Level.bin",
            "Close": "input/close_Level_1_Main_Level.bin",
        }]}

        grids = slg.load_levels(report, str(root))["Level_1_Main_Level"]
        centers = np.array([0.5, 1.5, 2.5, 3.5])
        backed = grids["evidence"].distance_ft(centers, np.full(4, 0.5)) <= slg.HIT_FT

        assert backed.tolist() == [False, True, False, False]
        assert not grids["ink"].mask.any()


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


def test_worst_unbacked_run_uses_quarter_foot_samples_and_resets_at_exemption():
    empty = slg.Grid(np.zeros((40, 40), dtype=bool), 0.0, 0.0, 0.25)
    room = Polygon([(0, 0), (4.3, 0), (4.3, 2), (0, 2)])
    assert slg.worst_unbacked_run_ft(room, empty) == 4.5
    assert slg.worst_unbacked_run_ft(
        room, empty, zone_boundary=room.boundary, exempt_ft=1.0) == 0.0


def test_worst_unbacked_run_names_room_edge_and_run_endpoints():
    empty = slg.Grid(np.zeros((40, 40), dtype=bool), 0.0, 0.0, 0.25)
    detail = slg.worst_unbacked_run(Polygon([(0, 0), (4, 0), (4, 2), (0, 2)]), empty)
    assert detail["lengthFt"] > 0
    assert set(detail["edge"]) == {"from", "to"}
    assert set(detail["run"]) == {"from", "to"}
    assert detail["ring"] == "outer"


def test_interior_swallow_detects_interior_ink_only():
    # 10x10 ft room on a 0.25 ft grid; ink stripe through the middle = swallowed wall;
    # ink hugging the boundary stays inside the 1.5 ft wall-claim band and is ignored.
    room = Polygon([(0, 0), (10, 0), (10, 10), (0, 10)])
    mid_row = 20  # y = 5.125 ft, deep interior
    interior_ink = _grid_with_ink([(mid_row, c) for c in range(10, 30)])
    band_ink = _grid_with_ink([(1, c) for c in range(0, 40)])  # y = 0.375 ft
    assert slg.interior_swallow(room, interior_ink) > 0
    assert slg.interior_swallow(room, band_ink) == 0.0


def test_interior_swallow_exempts_zone_rim():
    # R3c artifact: a room edge that honestly retreats off a zone wall leaves that wall's
    # ink deeper than the room-rim band — it must not count as swallow when the ink hugs
    # the ZONE boundary (declared wall authority), mirroring the edge-on-ink exemption.
    room = Polygon([(0, 0), (10, 0), (10, 10), (0, 10)])
    stripe = _grid_with_ink([(20, c) for c in range(10, 30)])  # y = 5.125 ft, interior
    near_zone = Polygon([(0, 0), (10, 0), (10, 6), (0, 6)])    # boundary at y=6, 0.875 ft away
    far_zone = Polygon([(-20, -20), (30, -20), (30, 30), (-20, 30)])
    assert slg.interior_swallow(room, stripe, near_zone.boundary) == 0.0
    assert slg.interior_swallow(room, stripe, far_zone.boundary) > 0


def _mark_boundary_cells(grid, geometry):
    xs, ys = slg.edge_sample_points(geometry)
    for x, y in zip(xs, ys):
        col, row = int(x / grid.cell), int(y / grid.cell)
        if 0 <= col < grid.w and 0 <= row < grid.h:
            grid.mask[row, col] = True


def test_clean_oracle_hygiene_rules():
    square = [[0, 0], [10, 0], [10, 10], [0, 10]]
    shifted = [[1, 0], [11, 0], [11, 10], [1, 10]]     # 90% overlap with square
    oracle = {"rooms": {
        "1": dict(name="GH Kitchen", floor=0, polygonModelFt=square,
                  sourcePdf="A2 - 1 MAIN LEVEL PLAN Guest House Takeoff.pdf"),
        "2": dict(name="Room", floor=0, polygonModelFt=square, sourcePdf="main.pdf"),
        "3": dict(name="Room dup", floor=0, polygonModelFt=shifted, sourcePdf="main.pdf"),
        "4": dict(name="Disjoint", floor=0, sourcePdf="main.pdf",
                  polygonModelFt=[[20, 0], [30, 0], [30, 10], [20, 10]]),
        "5": dict(name="Other floor", floor=1, polygonModelFt=square, sourcePdf="main.pdf"),
    }}
    # seed ink registered exactly on the SHIFTED copy's boundary: the dedupe must keep #3
    grid = slg.Grid(np.zeros((48, 60), dtype=bool), 0.0, 0.0, 0.25)
    _mark_boundary_cells(grid, Polygon(shifted))
    cleaned, dropped = slg.clean_oracle(oracle, {0: grid})
    assert dropped["1"] == "guest-house source"
    assert dropped["2"].startswith("duplicate of #3")
    assert set(cleaned["rooms"]) == {"3", "4", "5"}
    # same footprint on another floor is never a duplicate; disjoint rooms never dedupe
    assert "5" in cleaned["rooms"] and "4" in cleaned["rooms"]


def test_honesty_check_flags_fallen_accepted_rooms():
    def scores(polys):
        return {"zones": [{"zone": "Z#00", "polygons": polys}]}
    a = scores([
        dict(id="R01", disposition="accepted", edgeOnInk=0.9),
        dict(id="R02", disposition="accepted", edgeOnInk=0.8),
        dict(id="R03", disposition="accepted", edgeOnInk=0.7),
        dict(id="H01", disposition="held", edgeOnInk=0.2),
    ])
    b = scores([
        dict(id="R01", disposition="accepted", edgeOnInk=0.897),  # within 0.005 noise
        dict(id="R02", disposition="accepted", edgeOnInk=0.7),    # fell 0.1 -> violation
        dict(id="H01", disposition="held", edgeOnInk=0.1),        # held rooms exempt
    ])                                                            # R03 departed
    violations, departed = slg.honesty_check(a, b)
    assert [v["id"] for v in violations] == ["R02"]
    assert violations[0]["fell"] == 0.1
    assert [d["id"] for d in departed] == ["R03"]
    # baseline vs itself must be silent: empty HONESTY = pass
    assert slg.honesty_check(a, a) == ([], [])


def test_zone_geometry_even_odd():
    outer = [[0, 0], [10, 0], [10, 10], [0, 10]]
    inner = [[3, 3], [7, 3], [7, 7], [3, 7]]
    geom = slg.zone_geometry([outer, inner])
    assert abs(geom.area - (100 - 16)) < 1e-6
    assert not geom.contains(slg.Point(5, 5))
    assert geom.contains(slg.Point(1, 1))


def _wall_band_grid():
    mask = np.zeros((84, 84), dtype=bool)
    centers = (np.arange(84) + 0.5) * 0.25
    mask[:, centers >= 19] = True
    return slg.Grid(mask, 0.0, 0.0, 0.25)


def test_double_line_pairs_prices_zone_room_edge_on_wall_band():
    segments = slg.zone_loop_segments([[[0, 0], [20, 0], [20, 20], [0, 20]]])
    room = Polygon([(2, 2), (19.4, 2), (19.4, 18), (2, 18)])
    pairs = slg.double_line_pairs(room, segments, _wall_band_grid())
    assert len(pairs) == 1
    assert abs(pairs[0]["meanOffsetFt"] - 0.6) < 0.01
    assert 14.0 <= pairs[0]["lengthFt"] <= 16.5
    assert set(pairs[0]) >= {"from", "to", "edgeIndex", "targetSegmentIndex"}


def test_double_line_pairs_ignores_unified_and_bare_floor_edges():
    segments = slg.zone_loop_segments([[[0, 0], [20, 0], [20, 20], [0, 20]]])
    unified = Polygon([(2, 2), (19.98, 2), (19.98, 18), (2, 18)])
    assert slg.double_line_pairs(unified, segments, _wall_band_grid()) == []
    bare = slg.Grid(np.zeros((84, 84), dtype=bool), 0.0, 0.0, 0.25)
    offset = Polygon([(2, 2), (19.4, 2), (19.4, 18), (2, 18)])
    assert slg.double_line_pairs(offset, segments, bare) == []


def test_sibling_double_line_pairs_prices_each_room_pair_once():
    room_a = Polygon([(2, 2), (19.4, 2), (19.4, 18), (2, 18)])
    room_b = Polygon([(20, 2), (21, 2), (21, 18), (20, 18)])
    pairs = slg.sibling_double_line_pairs(
        [("accepted", "R01", room_a), ("held", "H01", room_b)], _wall_band_grid())
    assert len(pairs) == 1
    assert (pairs[0]["room"], pairs[0]["siblingRoom"]) == ("R01", "H01")
    assert pairs[0]["lengthFt"] >= 14


def test_shape_details_separates_stairstep_run_from_single_micro_jog():
    stairstep = Polygon([
        (0, 0), (4, 0), (4, 4), (3.5, 4), (3.5, 4.5), (3, 4.5), (3, 8), (0, 8)])
    severe = slg.shape_details(stairstep)
    assert severe["stairstepRunCount"] == 1
    assert severe["stairstepEdges"] == 3
    assert severe["microJogCount"] == 0

    micro_jog = Polygon([(0, 0), (4, 0), (4, 1), (8, 1), (8, 8), (0, 8)])
    moderate = slg.shape_details(micro_jog)
    assert moderate["stairstepRunCount"] == 0
    assert moderate["microJogCount"] == 1
    assert moderate["microJogs"][0]["stepFt"] == 1.0


def test_shape_details_clean_rectangle_has_no_offense():
    details = slg.shape_details(Polygon([(0, 0), (10, 0), (10, 8), (0, 8)]))
    assert details["stairstepRunCount"] == 0
    assert details["microJogCount"] == 0


def test_score_identity_excludes_generated_time_and_artifact_paths():
    zone = {"Zone": "Z#00", "ZoneLoops": [[[0, 0], [1, 0], [1, 1], [0, 1]]]}
    a = {"SchemaVersion": 4, "GeneratedUtc": "A", "optionsHash": "abc",
         "zoneFilter": None, "Zones": [dict(zone, Tsv="one/rooms.tsv")]}
    b = {"SchemaVersion": 4, "GeneratedUtc": "B", "optionsHash": "abc",
         "zoneFilter": None, "Zones": [dict(zone, Tsv="two/rooms.tsv")]}
    assert slg._score_identity(a) == slg._score_identity(b)


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
