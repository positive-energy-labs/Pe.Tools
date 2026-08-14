import hashlib
import json
import struct
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from PIL import Image


HERE = Path(__file__).resolve().parent
SCRIPT = HERE / "review-takeoff.py"
ZONE_SCRIPT = HERE / "render-zone-promotion.py"


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


class ReviewTakeoffTests(unittest.TestCase):
    def test_zone_promotion_renderer_crops_registered_disposition(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "input").mkdir()
            (root / "zones").mkdir()
            bits = bytes([0b10011001, 0b10011001])
            (root / "input" / "ink_Test.bin").write_bytes(
                struct.pack("<Iii", 0x504B4E49, 4, 4)
                + struct.pack("<ddd", 0, 0, 1) + bits)
            (root / "zones" / "rooms_Test.tsv").write_text(
                "META\tlevel\tTest\nMETA\telev\t0\n"
                "ROOM\tR01\t4\t8\t1\t1\t9\n"
                "POLY\tR01\touter\t0;0|2;0|2;2|0;2\n"
                "META\tresidue\tR02\trejected\t2\t2.5\t1\t9\t2;0|3;0|3;2|2;2\n",
                encoding="utf-8")
            zone = {
                "Level": "Test", "Zone": "Test#00", "MinX": 0, "MinY": 0,
                "MaxX": 3, "MaxY": 2, "Tsv": "zones/rooms_Test.tsv",
                "Ink": "input/ink_Test.bin", "RawRooms": 2, "AcceptedRooms": 1,
                "HeldRooms": 1, "InkBackedEdgeFraction": 0.5, "ClosureErrorSqft": 0,
            }
            outside = {**zone, "Zone": "Test#01", "MinX": 20, "MaxX": 22}
            (root / "report.json").write_text(
                json.dumps({"Zones": [zone, outside]}), encoding="utf-8")

            subprocess.run([sys.executable, str(ZONE_SCRIPT), str(root / "report.json")],
                           check=True, cwd=HERE)

            manifest = json.loads((root / "review-manifest.json").read_text(encoding="utf-8"))
            self.assertTrue((root / manifest["contactSheet"]).is_file())
            self.assertEqual(len(manifest["files"]), 3)

    def test_bundle_is_blind_hashed_and_verifiable(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            ink = root / "ink"
            ink.mkdir()
            bits = bytes([0b10011001, 0b10011001])
            (ink / "ink_Test_Level.bin").write_bytes(
                struct.pack("<Iii", 0x504B4E49, 4, 4)
                + struct.pack("<ddd", 0, 0, 1)
                + bits
            )
            sources = []
            for index, points in enumerate(("0;0|3;0|3;3|0;3", "0;0|2;0|2;3|0;3")):
                source = root / f"variant-{index}"
                source.mkdir()
                tsv = source / "rooms_Test_Level.tsv"
                tsv.write_text(
                    "META\tlevel\tTest Level\nMETA\telev\t0\n"
                    "ROOM\tR01\t9\t12\t1\t1\t9\n"
                    f"POLY\tR01\touter\t{points}\n"
                    "META\tresidue\tR02\trejected\t4\t2\t2\t9\t1;1|3;1|3;3|1;3\n"
                    "META\tresidue\tX01\tcrumb\t1\t0.5\t0.5\t9\t0;0|1;0|1;1|0;1\n",
                    encoding="utf-8",
                )
                sources.append((source, digest(tsv)))
            provenance = []
            for index, (source, geometry_hash) in enumerate(sources):
                path = root / f"provenance-{index}.json"
                path.write_text(json.dumps({"Levels": [{
                    "Tsv": "rooms_Test_Level.tsv", "TsvSha256": geometry_hash,
                }]}), encoding="utf-8")
                provenance.append(path)
            ink_manifest = root / "ink-manifest.json"
            ink_manifest.write_text(json.dumps({"inkRasters": [{
                "path": "ink_Test_Level.bin",
                "sha256": digest(ink / "ink_Test_Level.bin"),
            }]}), encoding="utf-8")

            output = root / "bundle"
            subprocess.run([
                sys.executable, str(SCRIPT),
                "--variant", f"first={sources[0][0]}",
                "--variant", f"second={sources[1][0]}",
                "--provenance", f"first={provenance[0]}",
                "--provenance", f"second={provenance[1]}",
                "--ink-dir", str(ink),
                "--ink-manifest", str(ink_manifest),
                "--out-dir", str(output),
                "--seed", "7",
                "--scale", "1",
                "--expected-level-count", "1",
            ], check=True, cwd=HERE)

            manifest = json.loads((output / "manifest.json").read_text(encoding="utf-8"))
            self.assertEqual({item["alias"] for item in manifest["variants"]}, {"A", "B"})
            self.assertTrue((output / manifest["contactSheet"]).is_file())
            overlap_areas = set()
            for variant in manifest["levels"][0]["variants"]:
                disposition = output / variant["disposition"]
                self.assertTrue(disposition.is_file())
                with Image.open(output / variant["blind"]) as blind, Image.open(disposition) as panel:
                    self.assertEqual(panel.size, blind.size)
                overlap_areas.add(variant["dispositionAccounting"]["overlapSqft"])
                self.assertEqual({key: value for key, value in
                                  variant["dispositionAccounting"].items()
                                  if key != "overlapSqft"}, {
                    "acceptedCount": 1,
                    "acceptedSqft": 9.0,
                    "rejectedCount": 1,
                    "rejectedSqft": 4.0,
                    "crumbCount": 1,
                    "crumbSqft": 1.0,
                })
            # The variants place the same raw regions differently; overlap is the
            # computed union of pairwise intersections, not raw-area arithmetic.
            self.assertEqual(overlap_areas, {3.0, 5.0})
            self.assertTrue(all(digest(source / "rooms_Test_Level.tsv") == before
                                for source, before in sources))
            subprocess.run([
                sys.executable, str(SCRIPT), "--verify", str(output / "manifest.json")
            ], check=True, cwd=HERE)

    def test_refuses_audit_from_different_geometry(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            ink = root / "ink"
            variant = root / "variant"
            audit = root / "audit"
            for directory in (ink, variant, audit):
                directory.mkdir()
            (ink / "ink_Test_Level.bin").write_bytes(
                struct.pack("<Iii", 0x504B4E49, 2, 2)
                + struct.pack("<ddd", 0, 0, 1)
                + bytes([0b1111])
            )
            header = "META\tlevel\tTest Level\nMETA\telev\t0\nROOM\tR01\t4\t8\t1\t1\t4\n"
            (variant / "rooms_Test_Level.tsv").write_text(
                header + "POLY\tR01\touter\t0;0|2;0|2;2|0;2\n", encoding="utf-8")
            (audit / "rooms_Test_Level.tsv").write_text(
                header + "POLY\tR01\touter\t0;0|1;0|1;2|0;2\n", encoding="utf-8")
            (audit / "audit_Test_Level.json").write_text("{}\n", encoding="utf-8")
            provenance = root / "provenance.json"
            provenance.write_text(json.dumps({"Levels": [{
                "Tsv": "rooms_Test_Level.tsv",
                "TsvSha256": digest(variant / "rooms_Test_Level.tsv"),
            }]}), encoding="utf-8")
            ink_manifest = root / "ink-manifest.json"
            ink_manifest.write_text(json.dumps({"inkRasters": [{
                "path": "ink_Test_Level.bin",
                "sha256": digest(ink / "ink_Test_Level.bin"),
            }]}), encoding="utf-8")

            result = subprocess.run([
                sys.executable, str(SCRIPT),
                "--variant", f"candidate={variant}",
                "--audit", f"candidate={audit}",
                "--provenance", f"candidate={provenance}",
                "--ink-dir", str(ink),
                "--ink-manifest", str(ink_manifest),
                "--out-dir", str(root / "bundle"),
                "--expected-level-count", "1",
            ], cwd=HERE, capture_output=True, text=True)

            self.assertNotEqual(result.returncode, 0)
            self.assertIn("stale audit", result.stderr)


if __name__ == "__main__":
    unittest.main()
