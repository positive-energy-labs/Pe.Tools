"""Publish a completed compact Partition capture into /runs (no Revit calls).

python eval/rhvac/partition-run.py CAPTURE --label project-a --zone-name "Main Level#09"
python eval/rhvac/partition-run.py --self-test
"""
import argparse
from collections import Counter
from datetime import datetime, timezone
import hashlib
import json
import math
from pathlib import Path
import tempfile
import uuid

from PIL import Image, ImageDraw
from shapely.geometry import GeometryCollection, Polygon

REPO = Path(__file__).resolve().parents[2]


def digest(data):
    return hashlib.sha256(data).hexdigest()


def write_json(path, value):
    path.write_text(json.dumps(value, indent=2, allow_nan=False) + "\n", encoding="utf-8")


def points(loop):
    if len(loop) < 6 or len(loop) % 2 or not all(math.isfinite(v) for v in loop):
        raise ValueError("invalid host-foot ring")
    return list(zip(loop[::2], loop[1::2]))


def scope_rings(scope):
    loops = scope["loops"] if "loops" in scope else [scope["loop"]]
    if not loops:
        raise ValueError("scope has no loops")
    return [points(loop) for loop in loops]


def scope_area(rings):
    result = GeometryCollection()
    for ring in rings:
        polygon = Polygon(ring)
        if not polygon.is_valid:
            raise ValueError("invalid scope polygon")
        result = result.symmetric_difference(polygon)
    return result.area


def encode_ring(ring):
    return "|".join(f"{x!r};{y!r}" for x, y in ring)


def geometry(answer, scope):
    """Only returned geometry is emitted; whole-zone Hold is the one explicit scalar projection."""
    rows = []
    for room in answer["Rooms"]:
        kind = room["Disposition"]
        kind = ["accepted", "held", "void", "excluded"][kind] if isinstance(kind, int) else kind.lower()
        ring = points(room["Loop"])
        rid = f'R{room["Index"] + 1:02}'
        holes = [points(hole) for hole in room.get("Holes") or []]
        loops = [encode_ring(ring), *(encode_ring(hole) for hole in holes)]
        floor, ceiling = room["FloorZ"], room["CeilingZ"]
        height = ceiling - floor if floor is not None and ceiling is not None else ""
        if kind in ("accepted", "held"):
            perimeter = sum(math.hypot(x-u, y-v) for boundary in [ring, *holes]
                            for (x, y), (u, v) in zip(boundary, boundary[1:] + boundary[:1]))
            rows.append(["ROOM", rid, room["AreaSqft"], perimeter, room["LabelX"], room["LabelY"], height, kind])
            rows.append(["POLY", rid, "outer", loops[0]])
            rows.extend(["POLY", rid, "hole", hole] for hole in loops[1:])
        elif kind in ("void", "excluded"):
            rows.append(["META", "residue", rid, kind, room["AreaSqft"], room["LabelX"], room["LabelY"], height, *loops])
        else:
            raise ValueError(f"unknown disposition: {kind}")
    if answer.get("Hold") and not answer["Rooms"]:
        rows.append(["META", "residue", "whole-zone", "rejected", answer["Accounting"]["Held"],
                     "", "", "", *(encode_ring(ring) for ring in scope_rings(scope))])
    return "".join("\t".join(map(str, row)) + "\n" for row in rows)


def publish(capture, label, zone_name, pool):
    capture, pool = Path(capture).resolve(), Path(pool).resolve()
    names = ["zone.json", "knee.json", "header.json", "probes.json"]
    outcomes = [n for n in ("answer.json", "failure.json") if (capture / n).is_file()]
    if len(outcomes) != 1:
        raise ValueError("capture must contain exactly one completed answer.json or failure.json")
    names += outcomes
    if (capture / "partition-input.json").is_file():
        names.append("partition-input.json")
    raw = {name: (capture / name).read_bytes() for name in names}
    data = {name: json.loads(value.decode("utf-8-sig")) for name, value in raw.items()}
    scope, knee, header = (data[n] for n in names[:3])
    stamp = knee["Stamp"]
    identity = (stamp["HostDocumentKey"], stamp["Epoch"], stamp["BuiltUtc"], stamp["Frame"])
    if not identity[0] or identity[3] != "host-internal-ft":
        raise ValueError("capture must identify its host document in host-internal-ft")
    answer = data.get("answer.json")
    for value in [header, *(p["answer"] for p in data["probes.json"]), *([answer] if answer else [])]:
        other = value["Stamp"]
        if tuple(other[k] for k in ("HostDocumentKey", "Epoch", "BuiltUtc", "Frame")) != identity:
            raise ValueError("capture mixes document, epoch, build or coordinate frame")
    rings = scope_rings(scope)
    ring = [point for boundary in rings for point in boundary]
    zone_area = scope_area(rings)
    if zone_area <= 0:
        raise ValueError("zone has no area")
    hashes = {name: digest(value) for name, value in raw.items()}
    capture_hash = digest(json.dumps(hashes, sort_keys=True).encode())
    zone_key = digest(f'{identity[0]}\n{scope["zoneRegion"]}'.encode())[:20]
    scope_loops = [[ordinate for point in boundary for ordinate in point] for boundary in rings]
    scope_key = digest(json.dumps([zone_key, scope_loops], separators=(",", ":")).encode())
    now = datetime.now(timezone.utc)
    run_id = f'{now:%Y%m%d-%H%M%S}-{capture_hash[:12]}-{uuid.uuid4().hex[:8]}'
    pool.mkdir(parents=True, exist_ok=True)
    # Outside the pool: report.json alone would expose an incomplete staging directory.
    with tempfile.TemporaryDirectory(prefix="partition-stage-", dir=pool.parent) as tmp:
        stage = Path(tmp) / run_id
        (stage / "capture").mkdir(parents=True)
        for name, value in raw.items():
            (stage / "capture" / name).write_bytes(value)
        minx, maxx = min(x for x, _ in ring) - 2, max(x for x, _ in ring) + 2
        miny, maxy = min(y for _, y in ring) - 2, max(y for _, y in ring) + 2
        # ponytail: one bounded preview; inspect exact slice JSON for subpixel evidence.
        scale = min(24, 4096 / max(maxx-minx, maxy-miny))
        width, height = math.ceil((maxx-minx)*scale), math.ceil((maxy-miny)*scale)
        image = Image.new("RGB", (width, height), "white")
        draw = ImageDraw.Draw(image)
        for band in (knee, header):
            for element in band["Elements"]:
                for piece in element["Pieces"]:
                    draw.polygon([((x-minx)/(maxx-minx)*width, (maxy-y)/(maxy-miny)*height)
                                  for x, y in points(piece)], fill=(45, 45, 45))
        image.save(stage / "evidence.png")
        write_json(stage / "evidence.json", dict(width=width, height=height,
                   topLeft=[minx, maxy], topRight=[maxx, maxy], bottomLeft=[minx, miny]))
        verdict = "error" if answer is None else "hold" if answer.get("Hold") else "solve"
        error = data.get("failure.json", {}).get("error")
        if answer is None and not isinstance(error, str):
            raise ValueError("failure.json must contain an error string")
        if error:
            error = error.splitlines()[0]  # Full exception remains in the linked capture.
        counts = Counter()
        reasons = Counter()
        details = {}
        if answer:
            for room in answer["Rooms"]:
                kind = room["Disposition"]
                kind = ["accepted", "held", "void", "excluded"][kind] if isinstance(kind, int) else kind.lower()
                counts[kind] += 1
                if room.get("Reason"):
                    reasons[room["Reason"]] += 1
                    details[f'R{room["Index"]+1:02}'] = room["Reason"]
            acc = answer["Accounting"]
            if abs(acc["ZoneSqft"] - zone_area) > 1e-6 or abs(sum(acc[k] for k in ("Accepted", "Held", "Void", "Excluded")) - zone_area) > 1e-6:
                raise ValueError("answer accounting disagrees with scope")
        (stage / "rooms.tsv").write_text(geometry(answer, scope) if answer else "", encoding="utf-8")
        options = answer["Knobs"] if answer else {}
        options_hash = digest(json.dumps(options, sort_keys=True).encode())[:12] if answer else "unavailable"
        zone = dict(Level=scope.get("level", f'Level {scope["levelZ"]:g} ft'), Zone=zone_name,
                    zoneKey=zone_key, MinX=minx+2, MinY=miny+2, MaxX=maxx-2, MaxY=maxy-2,
                    ZoneLoops=rings, Tsv="rooms.tsv", Ink="", Seals="", Close="",
                    OracleRooms=None, RawRooms=None, AcceptedRooms=counts["accepted"] if answer else None,
                    HeldRooms=counts["held"] if answer else None,
                    PartitionSqft=sum(r["AreaSqft"] for r in answer["Rooms"]) if answer else None,
                    ZoneSqft=zone_area, InkBackedEdgeFraction=None, StrictlyEditable=None, Contained=None,
                    Rejections=dict(reasons), RejectionDetails=details, adaptedKnobs={}, census=None, closure=None,
                    triage=dict(verdict=verdict, reason=error or (answer.get("Hold") if answer else None) or "Partition returned"),
                    plan=dict(image="evidence.png", registration="evidence.json"),
                    capture=dict(documentKey=identity[0], capturedUtc=scope["capturedUtc"], stamp=stamp,
                                 result=f'capture/{outcomes[0]}', manifest="manifest.json", hash=capture_hash,
                                 proof=scope.get("proof"),
                                 input="capture/partition-input.json" if "partition-input.json" in raw else None,
                                 note="Raw knee/header slice projection; no inferred closures. Only returned room and residue geometry is drawn."))
        for target, key in (("AcceptedSqft", "Accepted"), ("HeldSqft", "Held"), ("VoidSqft", "Void"), ("ExcludedSqft", "Excluded")):
            zone[target] = answer["Accounting"][key] if answer else None
        report = dict(SchemaVersion=5, GeneratedUtc=now.isoformat(), optionsHash=options_hash, options=options,
                      zoneFilter=zone_name, documentKey=identity[0], scopeKey=scope_key,
                      Zones=[zone], RejectionHistogram=dict(reasons))
        write_json(stage / "report.json", report)
        write_json(stage / "meta.json", dict(runId=run_id, generatedUtc=report["GeneratedUtc"],
                   optionsHash=options_hash, label=label, zoneFilter=zone_name,
                   documentKey=identity[0], scopeKey=scope_key))
        write_json(stage / "manifest.json", dict(schemaVersion=1, captureDirectory=str(capture),
                   documentKey=identity[0], outcome=verdict, proof=scope.get("proof"),
                   proofUnavailable=None if scope.get("proof") else "Capture did not declare a proof lane",
                   captureHashes=hashes, files={p.relative_to(stage).as_posix(): digest(p.read_bytes())
                   for p in stage.rglob("*") if p.is_file()}))
        destination = pool / run_id
        stage.rename(destination)
    return destination


def self_test():
    with tempfile.TemporaryDirectory(prefix="partition-run-check-") as tmp:
        root = Path(tmp)
        capture = root / "capture"
        capture.mkdir()
        stamp = dict(HostDocumentKey="check-document", Epoch=1, BuiltUtc="2026-09-06T00:00:00Z", Frame="host-internal-ft", Fresh=True)
        scope = dict(doc="check", zoneRegion=1, loop=[0,0,4,0,4,4,0,4], levelZ=0, capturedUtc="2026-09-06T00:00:00Z")
        write_json(capture / "zone.json", scope)
        for name in ("knee.json", "header.json"):
            write_json(capture / name, dict(Stamp=stamp, Elements=[dict(Pieces=[[0,0,1,0,1,4,0,4]])]))
        write_json(capture / "probes.json", [])
        write_json(capture / "failure.json", dict(error="real failure"))
        failed = publish(capture, "check", "Zone", root / "pool")
        report = json.loads((failed / "report.json").read_text())
        assert report["Zones"][0]["AcceptedRooms"] is None and report["Zones"][0]["triage"]["verdict"] == "error"
        assert (failed / "capture/failure.json").read_bytes() == (capture / "failure.json").read_bytes()
        assert Image.open(failed / "evidence.png").getextrema()[0][0] < 255
        (capture / "failure.json").unlink()
        rooms = [dict(Index=i, Disposition=i, Reason="check" if i else None, Loop=[i,0,i+1,0,i+1,4,i,4],
                      AreaSqft=4, LabelX=i+0.5, LabelY=2, FloorZ=None, CeilingZ=None) for i in range(4)]
        write_json(capture / "answer.json", dict(Stamp=stamp, Rooms=rooms, Knobs={}, Hold=None,
                   Accounting=dict(ZoneSqft=16, Accepted=4, Held=4, Void=4, Excluded=4)))
        good = publish(capture, "check", "Zone", root / "pool")
        tsv = (good / "rooms.tsv").read_text()
        assert "\t\theld\n" in tsv and "\tvoid\t" in tsv and "\texcluded\t" in tsv
        assert good != failed and json.loads((good / "report.json").read_text())["Zones"][0]["AcceptedRooms"] == 1
        write_json(capture / "answer.json", dict(Stamp=stamp, Rooms=[], Knobs={}, Hold="no-enclosure",
                   Accounting=dict(ZoneSqft=16, Accepted=0, Held=16, Void=0, Excluded=0)))
        held = publish(capture, "check", "Zone", root / "pool")
        held_zone = json.loads((held / "report.json").read_text())["Zones"][0]
        assert held_zone["AcceptedRooms"] == 0 and held_zone["HeldRooms"] == 0 and held_zone["HeldSqft"] == 16
        assert held_zone["triage"]["verdict"] == "hold" and "\trejected\t16\t" in (held / "rooms.tsv").read_text()
        hole = [1,1,3,1,3,3,1,3]
        island = [5,0,6,0,6,1,5,1]
        scope["loops"] = [scope["loop"], hole, island]
        scope["proof"] = dict(lane="session", custody="controlled", payloadLane="installed",
                              sessionId="check-only", buildStamp="check-only")
        write_json(capture / "zone.json", scope)
        write_json(capture / "partition-input.json", dict(ZoneLoops=scope["loops"]))
        room = dict(Index=0, Disposition="Held", Reason="no-enclosure", Loop=scope["loop"], Holes=[hole],
                    AreaSqft=12, LabelX=0.5, LabelY=0.5, FloorZ=None, CeilingZ=None,
                    Proposal=dict(SourceKey="check", Name="Check", Number="1", Loops=[scope["loop"], hole]))
        excluded = dict(room, Index=1, Disposition="Excluded", Loop=island, Holes=[], AreaSqft=1)
        write_json(capture / "answer.json", dict(Stamp=stamp, Rooms=[room, excluded], Knobs={}, Hold="no-enclosure",
                   Accounting=dict(ZoneSqft=13, Accepted=0, Held=12, Void=0, Excluded=1)))
        explicit = publish(capture, "check", "Zone", root / "pool")
        tsv = (explicit / "rooms.tsv").read_text()
        zone = json.loads((explicit / "report.json").read_text())["Zones"][0]
        manifest = json.loads((explicit / "manifest.json").read_text())
        assert zone["ZoneSqft"] == 13 and len(zone["ZoneLoops"]) == 3 and zone["HeldRooms"] == 1
        assert "POLY\tR01\thole\t" in tsv and "whole-zone" not in tsv and "\texcluded\t1\t" in tsv
        assert manifest["proof"] == scope["proof"] and manifest["outcome"] == "hold"
        assert (explicit / "capture/partition-input.json").read_bytes() == (capture / "partition-input.json").read_bytes()
        assert manifest["captureHashes"]["partition-input.json"] == digest((capture / "partition-input.json").read_bytes())
        residue = geometry(dict(Rooms=[dict(room, Disposition="Void")], Hold=None), scope).strip().split("\t")
        assert len(residue) == 10  # META's eight fields plus outer and hole.
        assert json.loads((explicit / "capture/answer.json").read_text())["Rooms"][0]["Proposal"] == room["Proposal"]
        assert json.loads((failed / "manifest.json").read_text())["proof"] is None
        print("partition-run self-test: failure unknowns, exact bytes/hashes, evidence pixels, dispositions, legacy/explicit holds, holes/residues, even-odd disconnected scope, proof/input preservation, immutable IDs passed")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("capture_dir", nargs="?")
    parser.add_argument("--label")
    parser.add_argument("--zone-name")
    parser.add_argument("--pool", type=Path, default=REPO / ".artifacts/takeoff-runs")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    if args.self_test:
        self_test()
    elif not args.capture_dir or not args.label or not args.zone_name:
        parser.error("capture_dir, --label and --zone-name are required")
    else:
        print(publish(args.capture_dir, args.label, args.zone_name, args.pool))
