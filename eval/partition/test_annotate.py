"""python eval/partition/test_annotate.py (or pytest): numbering mirrors `roomRows` / `regionLabel` in /rooms."""
import importlib.util
from pathlib import Path

spec = importlib.util.spec_from_file_location("annotate", Path(__file__).with_name("annotate.py"))
annotate = importlib.util.module_from_spec(spec); spec.loader.exec_module(annotate)


def region(guid, role="room", zone=None, sqft=100.0, name="", level="Main"):
    return {"guid": guid, "role": role, "zone": zone, "sqft": sqft, "name": name, "level": level}


def test_labels_follow_the_table_order():
    # Two zones, a room in each, one unassigned room, one held; shuffled so input order cannot pass.
    regions = [
        region("h", role="held", zone="za", sqft=500),
        region("u", sqft=400),
        region("b1", zone="zb", sqft=300, name="Kitchen"),
        region("a1", zone="za", sqft=10),
        region("zb", role="zone", sqft=900),
        region("za", role="zone", sqft=1000),
    ]
    got = [(label, r["guid"]) for label, r in annotate.rows(regions, [{"name": "Main", "elevation": 0}])]
    # Zones by area, rooms zone by zone (za's before zb's), unassigned, held; a name keeps its slot.
    assert got == [("R1", "za"), ("R2", "zb"), ("R3", "a1"), ("Kitchen", "b1"), ("R5", "u"), ("R6", "h")]


def test_levels_rank_by_elevation_before_area():
    regions = [region("u1", level="Upper", sqft=50), region("m1", sqft=20, name="Den"), region("m2", sqft=80)]
    levels = [{"name": "Upper", "elevation": 10}, {"name": "Main", "elevation": 0}]
    assert [label for label, _ in annotate.rows(regions, levels)] == ["R1", "Den", "R3"]


def test_registration_maps_corners_on_a_rotated_crop():
    reg = {"width": 100, "height": 50, "topLeft": [0, 0], "topRight": [0, 10], "bottomLeft": [5, 0]}
    f = annotate.mapper(reg)
    for model, px in [((0, 0), (0, 0)), ((0, 10), (100, 0)), ((5, 0), (0, 50)), ((5, 10), (100, 50))]:
        assert all(abs(a - b) < 1e-9 for a, b in zip(f(model), px))


if __name__ == "__main__":
    test_labels_follow_the_table_order()
    test_levels_rank_by_elevation_before_area()
    test_registration_maps_corners_on_a_rotated_crop()
    print("ok")
