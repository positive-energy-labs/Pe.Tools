"""python eval/partition/test_metrics.py (or pytest): a reference room in the second zone must score."""
import importlib.util
from pathlib import Path

spec = importlib.util.spec_from_file_location("metrics", Path(__file__).with_name("metrics.py"))
metrics = importlib.util.module_from_spec(spec); spec.loader.exec_module(metrics)


def square(x, y, s=10.0):
    return [x, y, x + s, y, x + s, y + s, x, y + s]


def test_reference_room_in_second_zone_scores():
    zones = [[square(0, 0)], [square(20, 0)]]
    rooms = [{"Disposition": "Accepted", "Loop": square(20, 0)}]
    m = metrics.truth_metrics(rooms, zones, {"rooms": [{"loops": [square(20, 0)]}]})
    assert len(m["truth_rooms"]) == 1 and m["truth_symdiff"] < 0.05


if __name__ == "__main__":
    test_reference_room_in_second_zone_scores()
    print("ok")
