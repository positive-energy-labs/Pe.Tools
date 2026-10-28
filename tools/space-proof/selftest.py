"""Offline check of the harness's pure parts (decode, census, accuracy). No Revit: python tools/space-proof/selftest.py"""
import json, struct, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
import run

def el(i, rep, focus=False, link=None, **kw):
    return {"handle": {"elementId": i, "linkInstanceId": link, "category": "Generic Models"}, "focus": focus, "representation": rep, **kw}

meta = {"format": "space-scene-v3", "elements": [el(1, "mesh", True), el(2, "box"), el(3, "box"), el(4, "box", link=9), el(5, "run"), el(6, "box"),
        el(7, "oriented-box", orientedBox={"axisX": [0.7071, 0.7071, 0], "axisY": [-0.7071, 0.7071, 0], "axisZ": [0, 0, 1]}),
        el(8, "oriented-box", orientedBox={"axisX": [1, 0, 0], "axisY": [0, 1, 0], "axisZ": [0, 0, 1]})]}
blob = b"PSC1" + struct.pack("<i", len(json.dumps(meta))) + json.dumps(meta).encode()
assert run.decode_psc1(blob)["elements"][1]["id" if False else "representation"] == "box"
items = run.frame_items(meta)  # 7 non-focus, in order: ids 2,3,4,5,6,7,8
rows = [[0, 1, 1, 450, 0, 0], [1, 1, 0, 0, 0, 0], [2, 2, 1, 300, 0, 0], [3, 2, 1, 10, 0, 0], [4, 0, -1, 0, 0, 0], [5, 1, 1, 450, 0, 0], [6, 1, 1, 450, 0, 0]]
a = run.accuracy(meta, {"rows": rows})
assert a["rotated"] == 5 and a["rotatedBoxes"] == 2, a        # ids 2,4 are boxes with a rotated frame; 6 has no readable frame
assert abs(a["shareRotatedDrawnAxisAligned"] - 2 / 5) < 1e-9, a
assert a["unknownFrame"] == 1 and a["orientedBoxChecked"] == 2 and a["orientedBoxMismatch"] == 1, a  # id 8 is square-drawn on a 45 degree frame
assert run.census(meta)["byRepresentation"]["box"]["context"] == 4
f, c = run.page_requests([3, 1], "boxes")
assert f["focusOnly"] and f["contextRepresentation"] == "none" and c["contextPaddingFt"] == 10 and c["maxTriangles"] == 3_000_000
print("selftest ok")
