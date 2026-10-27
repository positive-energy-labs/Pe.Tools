import importlib.util
import json
from pathlib import Path
import struct
import sys
import tempfile
import unittest

sys.dont_write_bytecode = True
TOOL = Path(__file__).resolve().parents[1] / "scene_readability.py"
spec = importlib.util.spec_from_file_location("scene_readability", TOOL)
sr = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sr)


def box(category, x, y, focus=False, dx=1.0, dy=1.0):
    return {"handle": {"category": category, "elementId": 1, "uniqueId": category + str(x), "documentKey": "d", "linkInstanceId": None},
            "focus": focus, "representation": "box", "run": None, "firstVertex": 0, "vertexCount": 0,
            "bounds": {"minX": x, "minY": y, "minZ": 0, "maxX": x + dx, "maxY": y + dy, "maxZ": 1}}


def run(start, end):
    e = box("Ducts", 0, 0, focus=True)
    e["representation"] = "run"
    e["run"] = {"start": start, "end": end, "crossSectionXAxis": [0, 0, 1], "shape": "round", "diameterFt": 1}
    return e


def psc1(elements):
    meta = json.dumps({"format": "space-scene-v3", "phase": "test", "triangles": 0, "elements": elements}).encode()
    pad = (-(8 + len(meta))) % 4
    return struct.pack("<II", sr.MAGIC, len(meta)) + meta + b" " * pad


class SceneReadabilityTests(unittest.TestCase):
    def score(self, elements):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "scene.bin"
            path.write_bytes(psc1(elements))
            return sr.score(sr.load(path))

    def test_rotated_wing_as_square_boxes_and_centre_lines_are_flagged(self):
        elements = [box("Walls", i, 0) for i in range(3)] + [box("Walls", 9, 0, dx=4, dy=1)] + \
                   [box("Duct Center Line", 0, i) for i in range(2)] + [run([0, 0, 0], [10, 10, 0]), run([0, 0, 0], [10, 0, 0])]
        report = self.score(elements)
        self.assertEqual((report["context"], report["contextBoxes"], report["equalXYBoxes"]), (6, 6, 5))
        self.assertEqual(report["contextByCategory"], {"Duct Center Line": {"box": 2}, "Walls": {"box": 4}})
        self.assertEqual(report["noise"]["Duct Center Line"]["count"], 2)
        self.assertEqual([(b["fromDegrees"], b["count"]) for b in report["runBearingMod90"]], [(0, 1), (45, 1)])
        self.assertEqual(report["offAxisRunShare"], 0.5)
        self.assertTrue(report["verdict"].startswith("suspect: 83% of context boxes are square"))
        self.assertEqual(report["boxMaxExtentFt"]["max"], 4)
        self.assertEqual(report["equalXYByCategory"], {"Walls": 3, "Duct Center Line": 2})

    def test_clean_scene_raises_no_flag(self):
        report = self.score([box("Walls", i, 0, dx=4, dy=1) for i in range(5)] + [run([0, 0, 0], [0, 10, 0])])
        self.assertEqual(report["equalXYShare"], 0)
        self.assertTrue(report["verdict"].startswith("no readability flag"))

    def test_rejects_non_psc1(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "x.bin"
            path.write_bytes(b"NOPE0000")
            with self.assertRaises(ValueError):
                sr.load(path)
            path.write_bytes(psc1([]).replace(b"space-scene-v3", b"space-scene-v1"))
            with self.assertRaisesRegex(ValueError, "space-scene-v1"):
                sr.load(path)


if __name__ == "__main__":
    unittest.main()
