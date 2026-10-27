"""Run with python eval/partition/test_render.py; needs the bench's existing Pillow dependency."""
import json
import tempfile
from pathlib import Path

from PIL import Image
from render import render


def check_hole_preserves_earlier_room():
    outer = [0, 0, 10, 0, 10, 10, 0, 10]
    inner = [2, 2, 8, 2, 8, 8, 2, 8]
    with tempfile.TemporaryDirectory() as directory:
        root = Path(directory)
        (root / "answer.json").write_text(json.dumps({
            "Zones": [[outer]],
            "Rooms": [
                {"Loop": inner, "Holes": [], "Disposition": "Accepted", "AreaSqft": 36},
                {"Loop": outer, "Holes": [inner], "Disposition": "Held", "AreaSqft": 64},
            ],
        }))
        (root / "ink.json").write_text(json.dumps({"Knee": [], "Header": []}))
        with Image.open(render(root, root)) as image:
            center = image.getpixel((image.width // 2, image.height // 2))
            assert center != (255, 255, 255), "a later face's hole erased the accepted room"


if __name__ == "__main__":
    check_hole_preserves_earlier_room()
    print("PASS: a face's hole preserves rooms already drawn inside it")
