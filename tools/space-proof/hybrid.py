"""Compose the IFC hybrid picture from artifacts, no product code: the link-boxes artifact with every loose link box
(link-frame / triangle-fit envelope volume > 1.5x) replaced by that element's native mesh rows from the oriented
(IFC-as-mesh) artifact of the same request. Writes a valid PSC1 named by its SHA-256 into the scene cache so the
/space route renders it beside the other representations at one camera.

    python tools/space-proof/hybrid.py <link-boxes.bin> <triangle-boxes.bin> <oriented.bin> <cacheDir> [--ratio 1.5]

The composite is a picture of what a hybrid would draw. Its cost is NOT the product's: a product hybrid needs a way to
name the tail without materializing every DirectShape (see tail-classifier.cs.template)."""
import argparse, hashlib, json, struct, sys
from pathlib import Path


def read(path):
    blob = Path(path).read_bytes()
    if blob[:4] != b"PSC1":
        raise ValueError(f"{path}: not PSC1")
    n = struct.unpack("<i", blob[4:8])[0]
    meta = json.loads(blob[8:8 + n])
    offset = (8 + n + 3) // 4 * 4
    return meta, blob[offset:]


def key(e):
    return (e["handle"].get("linkInstanceId"), e["handle"]["elementId"])


def volume(e):
    h = (e.get("orientedBox") or {}).get("halfSize")
    return 8 * h[0] * h[1] * h[2] if h else None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("link"); ap.add_argument("triangles"); ap.add_argument("oriented"); ap.add_argument("cache")
    ap.add_argument("--ratio", type=float, default=1.5)
    a = ap.parse_args()
    L, Lv = read(a.link)
    T, _ = read(a.triangles)
    O, Ov = read(a.oriented)
    if L["format"] != O["format"]:
        raise ValueError("format mismatch")
    tri = {key(e): volume(e) for e in T["elements"] if not e["focus"] and (e.get("orientedBox") or {}).get("frame") == "triangles"}
    meshes = {}
    for e in O["elements"]:
        if not e["focus"] and e["representation"] == "mesh":
            meshes.setdefault(key(e), []).append(e)
    out, verts, tail, swapped, missing = [], bytearray(), 0, 0, 0
    def emit(e, source_vertices):
        row = dict(e)
        row["firstVertex"] = len(verts) // 12
        if e["vertexCount"]:
            start = e["firstVertex"] * 12
            verts.extend(source_vertices[start:start + e["vertexCount"] * 12])
        out.append(row)
    for e in L["elements"]:
        k = key(e)
        box = e.get("orientedBox") or {}
        loose = not e["focus"] and box.get("frame") == "link" and tri.get(k) and volume(e) / tri[k] > a.ratio
        if loose:
            tail += 1
            if k in meshes:
                swapped += 1
                for m in meshes[k]:
                    emit(m, Ov)
                continue
            missing += 1
        emit(e, Lv)
    meta = dict(L)
    meta["elements"] = out
    meta["triangles"] = len(verts) // 36
    meta["composite"] = {"rule": f"link-boxes; link boxes over {a.ratio}x their triangle-fit envelope drawn as native meshes",
                         "linkArtifact": Path(a.link).name, "triangleArtifact": Path(a.triangles).name, "orientedArtifact": Path(a.oriented).name,
                         "tail": tail, "swapped": swapped, "tailWithoutMesh": missing}
    body = json.dumps(meta, separators=(",", ":")).encode()
    head = b"PSC1" + struct.pack("<i", len(body)) + body
    head += b"\0" * ((-len(head)) % 4)
    blob = head + bytes(verts)
    digest = hashlib.sha256(blob).hexdigest()
    (Path(a.cache) / f"{digest}.bin").write_bytes(blob)
    print(json.dumps({"id": digest, "bytes": len(blob), "elements": len(out), "triangles": meta["triangles"], **meta["composite"]}))


if __name__ == "__main__":
    sys.exit(main())
