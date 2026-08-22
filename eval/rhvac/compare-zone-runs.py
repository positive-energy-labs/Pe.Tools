"""Diff two zone-promotion reports: per-zone deltas, aggregate lines, and the options diff.

    python eval/rhvac/compare-zone-runs.py A/report.json B/report.json --out-dir compare-out

This is a report, not a gate: it always exits 0. With --out-dir it writes compare.md and
side-by-side A/B panels for zones whose accepted count, area, or boundary geometry changed.
"""

import argparse
import hashlib
import importlib.util
import json
import math
import re
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageOps
from shapely.geometry import GeometryCollection, LineString
from shapely.ops import unary_union

sys.path.insert(0, str(Path(__file__).parent))  # render-zone-promotion.py imports overlay
_spec = importlib.util.spec_from_file_location(
    "render_zone_promotion", Path(__file__).with_name("render-zone-promotion.py"))
rzp = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(rzp)

FOCUS_PADDING_CELLS = 8
CONTACT_COLUMNS = 3
CONTACT_THUMB = (600, 467)


def load(path):
    report_path = Path(path).resolve()
    report = json.loads(report_path.read_text(encoding="utf-8"))
    zones = {zone["Zone"]: zone for zone in report.get("Zones", [])}
    return report_path, report, zones


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def replay_path(root, zone):
    ink = rzp.artifact_path(root, zone["Ink"])
    return ink.parent / f"replay_{ink.stem.removeprefix('ink_')}.bin"


def boundary_geometry(root, zone):
    if zone is None:
        return GeometryCollection()
    _, polygons, residues = rzp.overlay.load_disposition_tsv(
        rzp.artifact_path(root, zone["Tsv"]))
    loops = [loop for room_loops in polygons.values() for _, loop in room_loops]
    loops += [loop for residue in residues for loop in residue["loops"]]
    lines = [LineString([*loop, loop[0]]) for loop in loops if len(loop) >= 2]
    return unary_union(lines) if lines else GeometryCollection()


def changed_component_bounds(root_a, zone_a, root_b, zone_b):
    left = boundary_geometry(root_a, zone_a)
    right = boundary_geometry(root_b, zone_b)
    epsilon = 1e-6
    changed = unary_union((left.difference(right.buffer(epsilon)),
                           right.difference(left.buffer(epsilon))))
    if changed.is_empty:
        return []
    replay = replay_path(root_a, zone_a)
    *_, cell, _ = rzp.overlay.load_replay_seed_ink(replay)
    grouped = changed.buffer(2 * cell, cap_style="square", join_style="mitre")
    regions = list(getattr(grouped, "geoms", (grouped,)))
    bounds = []
    for region in regions:
        member = changed.intersection(region)
        if not member.is_empty:
            bounds.append(tuple(round(value, 6) for value in member.bounds))
    return sorted(set(bounds))


def load_flags(path, known_zones):
    if not path:
        return [], None
    source = Path(path).resolve()
    document = json.loads(source.read_text(encoding="utf-8"))
    flags = document.get("flags") if isinstance(document, dict) else document
    if not isinstance(flags, list):
        raise SystemExit("flag manifest must be a list or an object with a flags list")
    seen = set()
    result = []
    for flag in flags:
        flag_id = str(flag.get("id", "")).strip()
        zone = str(flag.get("zone", "")).strip()
        bounds = flag.get("bounds")
        if not flag_id or flag_id in seen:
            raise SystemExit(f"flag ids must be non-empty and unique: {flag_id!r}")
        if zone not in known_zones:
            raise SystemExit(f"flag {flag_id}: unknown zone {zone!r}")
        if not isinstance(bounds, list) or len(bounds) != 4 \
                or bounds[0] >= bounds[2] or bounds[1] >= bounds[3]:
            raise SystemExit(f"flag {flag_id}: bounds must be [minX,minY,maxX,maxY]")
        seen.add(flag_id)
        result.append({"id": flag_id, "zone": zone,
                       "bounds": [float(value) for value in bounds],
                       "detail": str(flag.get("detail", ""))})
    return result, source


def comparable(zone_a, root_a, zone_b, root_b):
    authority_a = (zone_a["MinX"], zone_a["MinY"], zone_a["MaxX"], zone_a["MaxY"],
                   zone_a["ZoneLoops"])
    authority_b = (zone_b["MinX"], zone_b["MinY"], zone_b["MaxX"], zone_b["MaxY"],
                   zone_b["ZoneLoops"])
    if authority_a != authority_b:
        return False, "zone authority differs"
    replay_a, replay_b = replay_path(root_a, zone_a), replay_path(root_b, zone_b)
    if not replay_a.is_file() or not replay_b.is_file():
        return False, "replay seed ink missing"
    if digest(replay_a) != digest(replay_b):
        return False, "replay seed ink differs"
    if rzp.overlay.load_replay_seed_ink(replay_a)[:5] \
            != rzp.overlay.load_replay_seed_ink(replay_b)[:5]:
        return False, "replay grid differs"
    return True, ""


def sqft(value):
    return f"{value:+.1f}" if round(value, 1) else "0"


def count(value):
    return f"{value:+d}" if value else "0"


def zone_row(key, left, right):
    def delta(name):
        return (right.get(name, 0) or 0) - (left.get(name, 0) or 0)

    rejections = {}
    for name in set(rzp.field(left, "Rejections") or {}) | set(rzp.field(right, "Rejections") or {}):
        change = ((rzp.field(right, "Rejections") or {}).get(name, 0)
                  - (rzp.field(left, "Rejections") or {}).get(name, 0))
        if change:
            rejections[name] = change
    left_verdict = rzp.triage_of(left)[0] if left else "-"
    right_verdict = rzp.triage_of(right)[0] if right else "-"
    triage = "" if left_verdict == right_verdict else f"{left_verdict} -> {right_verdict}"
    areas = [delta("AcceptedSqft"), delta("HeldSqft"), delta("ExcludedSqft")]
    counts = [delta("AcceptedRooms"), delta("HeldRooms"), delta("RawRooms")]
    if not any(round(value, 1) for value in areas) and not any(counts) \
            and not rejections and not triage:
        return None
    presence = "" if left and right else ("only B" if right else "only A")
    return [
        key,
        *(sqft(value) for value in areas),
        *(count(value) for value in counts),
        ", ".join(f"{name} {change:+d}" for name, change in sorted(rejections.items())) or "-",
        triage or presence or "-",
    ]


def options_diff(left, right):
    left_options = rzp.field(left, "options") or {}
    right_options = rzp.field(right, "options") or {}
    rows = []
    for key in sorted(set(left_options) | set(right_options)):
        before, after = left_options.get(key), right_options.get(key)
        if before != after:
            rows.append((key, before, after))
    return rows


def table(header, rows):
    widths = [max(len(str(row[index])) for row in [header, *rows])
              for index in range(len(header))]
    lines = ["| " + " | ".join(str(cell).ljust(widths[index])
                               for index, cell in enumerate(header)) + " |",
             "| " + " | ".join("-" * widths[index] for index in range(len(header))) + " |"]
    for row in rows:
        lines.append("| " + " | ".join(str(cell).ljust(widths[index])
                                       for index, cell in enumerate(row)) + " |")
    return lines


def pair_panel(root_a, zone_a, root_b, zone_b, bounds=None):
    metadata_a, metadata_b = {}, {}
    if bounds:
        panel_a = rzp.render_zone(root_a, zone_a, None,
                                  padding_cells=FOCUS_PADDING_CELLS,
                                  focus_bounds=bounds, metadata=metadata_a)
        panel_b = rzp.render_zone(root_b, zone_b, None,
                                  padding_cells=FOCUS_PADDING_CELLS,
                                  focus_bounds=bounds, metadata=metadata_b)
    else:
        panel_a = rzp.render_zone(root_a, zone_a, None, metadata=metadata_a)
        panel_b = rzp.render_zone(root_b, zone_b, None, metadata=metadata_b)
    if metadata_a != metadata_b:
        raise SystemExit(f"non-comparable render fit for {zone_a['Zone']}")
    for panel, label in ((panel_a, "A"), (panel_b, "B")):
        ImageDraw.Draw(panel).text((820, 676), label, fill=(120, 120, 120),
                                   font=rzp.font(18))
    pair = Image.new("RGB", (panel_a.width + panel_b.width + 8,
                             max(panel_a.height, panel_b.height)), (200, 200, 200))
    pair.paste(panel_a, (0, 0))
    pair.paste(panel_b, (panel_a.width + 8, 0))
    return pair, metadata_a


def safe_zone(value):
    return re.sub(r"[^A-Za-z0-9._-]+", "_", value).strip("_")


def output_entry(path, root):
    return {
        "path": path.relative_to(root).as_posix(),
        "absolutePath": str(path.resolve()),
        "sha256": digest(path),
    }


def build_atlas(path_a, report_a, zones_a, path_b, report_b, zones_b,
                out_dir, expected_zone_count, flag_manifest, include_context, compare_text):
    keys_a, keys_b = set(zones_a), set(zones_b)
    if keys_a != keys_b:
        raise SystemExit(f"zone census differs: only A={sorted(keys_a - keys_b)}, "
                         f"only B={sorted(keys_b - keys_a)}")
    keys = sorted(keys_a)
    if len(keys) != expected_zone_count:
        raise SystemExit(f"expected {expected_zone_count} zones, found {len(keys)}")
    for key in keys:
        ok, reason = comparable(zones_a[key], path_a.parent, zones_b[key], path_b.parent)
        if not ok:
            raise SystemExit(f"non-comparable zone {key}: {reason}")

    flags, flag_path = load_flags(flag_manifest, keys_a)
    destination = Path(out_dir).resolve()
    if destination.exists():
        raise SystemExit(f"refusing to overwrite existing atlas: {destination}")
    (destination / "focus").mkdir(parents=True)
    if include_context:
        (destination / "context").mkdir()
    compare_path = destination / "compare.md"
    compare_path.write_text(compare_text + "\n", encoding="utf-8")

    components = []
    for key in keys:
        for index, bounds in enumerate(changed_component_bounds(
                path_a.parent, zones_a[key], path_b.parent, zones_b[key])):
            components.append({
                "id": f"change:{safe_zone(key)}:{index + 1:02d}",
                "zone": key,
                "bounds": list(bounds),
                "panelIds": [],
            })

    panels = []
    for kind, items in (("change", components), ("flag", flags)):
        for item in items:
            panel_id = f"focus:{item['id']}"
            pair, render = pair_panel(path_a.parent, zones_a[item["zone"]],
                                      path_b.parent, zones_b[item["zone"]], item["bounds"])
            output = destination / "focus" / f"{safe_zone(panel_id)}.png"
            pair.save(output)
            item["panelIds"] = [panel_id]
            panels.append({
                "id": panel_id,
                "kind": "focus",
                "zone": item["zone"],
                "crop": dict(zip(("minX", "minY", "maxX", "maxY"), item["bounds"])),
                "gridCrop": render["gridCrop"],
                "worldCrop": render["worldCrop"],
                "fit": render["fit"],
                "scale": render["scale"],
                "paddingCells": render["paddingCells"],
                "layers": render["layers"],
                "coversChangedComponents": [item["id"]] if kind == "change" else [],
                "coversFlags": [item["id"]] if kind == "flag" else [],
                **output_entry(output, destination),
            })

    focus_zones = {item["zone"] for item in components} | {item["zone"] for item in flags}
    header = 82
    rows = math.ceil(len(keys) / CONTACT_COLUMNS)
    contact = Image.new("RGB", (CONTACT_COLUMNS * CONTACT_THUMB[0],
                                header + rows * CONTACT_THUMB[1]), "white")
    draw = ImageDraw.Draw(contact)
    draw.rectangle((0, 0, contact.width, header - 1), fill=(244, 244, 246))
    draw.text((16, 10), f"A/B zone census: expected {expected_zone_count}   "
              f"A {len(zones_a)}   B {len(zones_b)}   focus {len(panels)}",
              fill=(30, 30, 30), font=rzp.font(21))
    draw.text((16, 42), f"A {path_a}    B {path_b}", fill=(70, 70, 70),
              font=rzp.font(13))
    for index, key in enumerate(keys):
        pair, render = pair_panel(path_a.parent, zones_a[key], path_b.parent, zones_b[key])
        thumb = ImageOps.contain(pair, CONTACT_THUMB, Image.Resampling.LANCZOS)
        contact.paste(thumb, ((index % CONTACT_COLUMNS) * CONTACT_THUMB[0],
                              header + (index // CONTACT_COLUMNS) * CONTACT_THUMB[1]))
        if include_context and key in focus_zones:
            context_path = destination / "context" / f"{index + 1:02d}_{safe_zone(key)}_ab.png"
            pair.save(context_path)
            panels.append({
                "id": f"context:{safe_zone(key)}",
                "kind": "context",
                "zone": key,
                "crop": {"minX": zones_a[key]["MinX"], "minY": zones_a[key]["MinY"],
                         "maxX": zones_a[key]["MaxX"], "maxY": zones_a[key]["MaxY"]},
                "gridCrop": render["gridCrop"],
                "worldCrop": render["worldCrop"],
                "fit": render["fit"],
                "scale": render["scale"],
                "paddingCells": render["paddingCells"],
                "layers": render["layers"],
                "coversChangedComponents": [],
                "coversFlags": [],
                **output_entry(context_path, destination),
            })
    contact_path = destination / "contact-sheet.png"
    contact.save(contact_path)

    inputs = {str(path_a): digest(path_a), str(path_b): digest(path_b)}
    for root, zones in ((path_a.parent, zones_a), (path_b.parent, zones_b)):
        for zone in zones.values():
            for path in rzp.zone_input_paths(root, zone):
                inputs[str(path.resolve())] = digest(path)
    if flag_path:
        inputs[str(flag_path)] = digest(flag_path)

    files = {path.relative_to(destination).as_posix(): digest(path)
             for path in sorted(destination.rglob("*")) if path.is_file()}
    manifest_path = destination / "focus-manifest.json"
    manifest = {
        "schemaVersion": 1,
        "manifestAbsolutePath": str(manifest_path),
        "reports": {
            "A": {"absolutePath": str(path_a), "sha256": digest(path_a)},
            "B": {"absolutePath": str(path_b), "sha256": digest(path_b)},
        },
        "aaIdentity": path_a == path_b,
        "census": {
            "expectedZoneCount": expected_zone_count,
            "baselineZoneCount": len(zones_a),
            "candidateZoneCount": len(zones_b),
            "actualContactPanels": len(keys),
            "zoneIds": keys,
        },
        "counts": {
            "changedComponents": len(components),
            "flags": len(flags),
            "focusPanels": sum(panel["kind"] == "focus" for panel in panels),
            "contextPanels": sum(panel["kind"] == "context" for panel in panels),
        },
        "contactSheet": output_entry(contact_path, destination),
        "changedComponents": components,
        "flags": flags,
        **({"flagManifest": {"absolutePath": str(flag_path), "sha256": digest(flag_path)}}
           if flag_path else {}),
        "panels": panels,
        "inputs": dict(sorted(inputs.items())),
        "files": dict(sorted(files.items())),
    }
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    verify(manifest_path)
    print(f"\n{destination}   contact sheet + {len(components)} changed components + "
          f"{len(flags)} flags")


def verify(manifest_path):
    manifest_path = Path(manifest_path).resolve()
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    root = manifest_path.parent
    failures = []
    if manifest.get("manifestAbsolutePath") != str(manifest_path):
        failures.append("manifestAbsolutePath does not name this manifest")
    for absolute, expected in manifest.get("inputs", {}).items():
        path = Path(absolute)
        actual = digest(path) if path.is_file() else None
        if actual != expected:
            failures.append(f"input {path}: expected {expected}, got {actual or 'missing'}")
    for relative, expected in manifest.get("files", {}).items():
        path = root / relative
        actual = digest(path) if path.is_file() else None
        if actual != expected:
            failures.append(f"output {relative}: expected {expected}, got {actual or 'missing'}")
    expected_files = set(manifest.get("files", {})) | {manifest_path.name}
    actual_files = {path.relative_to(root).as_posix()
                    for path in root.rglob("*") if path.is_file()}
    for relative in sorted(actual_files - expected_files):
        failures.append(f"output {relative}: unexpected file")

    try:
        path_a, report_a, zones_a = load(manifest["reports"]["A"]["absolutePath"])
        path_b, report_b, zones_b = load(manifest["reports"]["B"]["absolutePath"])
        census = manifest["census"]
        keys = sorted(zones_a)
        if keys != sorted(zones_b) or keys != census["zoneIds"]:
            failures.append("zoneIds do not match both reports")
        if len(keys) != census["expectedZoneCount"] \
                or len(keys) != census["actualContactPanels"]:
            failures.append("zone census count mismatch")
        actual_components = []
        for key in keys:
            ok, reason = comparable(zones_a[key], path_a.parent, zones_b[key], path_b.parent)
            if not ok:
                failures.append(f"non-comparable zone {key}: {reason}")
                continue
            for index, bounds in enumerate(changed_component_bounds(
                    path_a.parent, zones_a[key], path_b.parent, zones_b[key])):
                actual_components.append((f"change:{safe_zone(key)}:{index + 1:02d}",
                                          list(bounds)))
        declared_components = [(item["id"], item["bounds"])
                               for item in manifest["changedComponents"]]
        if actual_components != declared_components:
            failures.append("changed component census is stale")
        if manifest.get("flagManifest"):
            actual_flags, _ = load_flags(manifest["flagManifest"]["absolutePath"], set(keys))
            declared_flags = [{key: item[key] for key in ("id", "zone", "bounds", "detail")}
                              for item in manifest.get("flags", [])]
            if actual_flags != declared_flags:
                failures.append("flag manifest entries are stale")
        elif manifest.get("flags"):
            failures.append("flags have no source manifest")
    except (KeyError, TypeError, ValueError) as error:
        failures.append(f"invalid manifest/report structure: {error}")

    panels = manifest.get("panels", [])
    panel_ids = {panel.get("id") for panel in panels}
    if len(panel_ids) != len(panels) or None in panel_ids:
        failures.append("panel ids must be present and unique")
    focus_ids = {panel["id"] for panel in panels if panel.get("kind") == "focus"}
    for kind in ("changedComponents", "flags"):
        for item in manifest.get(kind, []):
            mapped = item.get("panelIds", [])
            if not mapped or not set(mapped) <= focus_ids:
                failures.append(f"{item.get('id', kind)} has no valid focus panel")
    for panel in panels:
        relative = panel.get("path")
        if relative not in manifest.get("files", {}):
            failures.append(f"panel {panel.get('id')} is unhashed")
        elif panel.get("sha256") != manifest["files"][relative]:
            failures.append(f"panel {panel.get('id')} hash metadata differs")
        if panel.get("absolutePath") != str((root / relative).resolve()):
            failures.append(f"panel {panel.get('id')} absolute path differs")
        if not all(key in panel for key in ("crop", "gridCrop", "fit", "layers", "scale")):
            failures.append(f"panel {panel.get('id')} lacks comparable render metadata")
    if len(focus_ids) != manifest.get("counts", {}).get("focusPanels"):
        failures.append("focus panel count mismatch")
    if manifest.get("aaIdentity") and manifest.get("changedComponents"):
        failures.append("A/A identity has changed components")
    contact = manifest.get("contactSheet", {})
    if contact.get("path") not in manifest.get("files", {}):
        failures.append("contact sheet is unhashed")
    if failures:
        raise SystemExit("focus atlas verification failed:\n" + "\n".join(failures))
    print(f"verified focus atlas: {manifest['census']['actualContactPanels']} zones, "
          f"{manifest['counts']['changedComponents']} changes, "
          f"{manifest['counts']['focusPanels']} focus panels")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("report_a", nargs="?")
    parser.add_argument("report_b", nargs="?")
    parser.add_argument("--out-dir")
    parser.add_argument("--expected-zone-count", type=int)
    parser.add_argument("--flag-manifest")
    parser.add_argument("--no-context", action="store_true")
    parser.add_argument("--verify", metavar="MANIFEST")
    args = parser.parse_args()

    if args.verify:
        verify(args.verify)
        return
    if not args.report_a or not args.report_b:
        parser.error("report_a and report_b are required unless --verify is used")

    path_a, report_a, zones_a = load(args.report_a)
    path_b, report_b, zones_b = load(args.report_b)
    keys = sorted(set(zones_a) | set(zones_b))

    header = ["zone", "acc sf", "held sf", "excl sf", "acc rooms", "held rooms", "raw rooms",
              "rejections", "triage"]
    rows = [row for row in (zone_row(key, zones_a.get(key, {}), zones_b.get(key, {}))
                            for key in keys) if row]

    lines = [f"# zone-run compare", "",
             f"A: {path_a}", f"B: {path_b}", "",
             f"zones: {len(keys)} union   changed: {len(rows)}", ""]
    lines += table(header, rows) if rows else ["_no per-zone deltas_"]
    lines += ["", "## aggregate", ""]
    for label, report in (("A", report_a), ("B", report_b)):
        for line in rzp.header_lines(report):
            lines.append(f"{label}: {line}")
    lines += ["", "## options", "",
              f"A optionsHash: {rzp.field(report_a, 'optionsHash', default='-')}",
              f"B optionsHash: {rzp.field(report_b, 'optionsHash', default='-')}", ""]
    diff = options_diff(report_a, report_b)
    lines += ([f"{key}: {before} -> {after}" for key, before, after in diff]
              if diff else ["_no option differences_"])

    text = "\n".join(lines)
    print(text)

    if not args.out_dir:
        return
    if args.expected_zone_count is None:
        parser.error("--expected-zone-count is required with --out-dir")
    build_atlas(path_a, report_a, zones_a, path_b, report_b, zones_b,
                args.out_dir, args.expected_zone_count, args.flag_manifest,
                not args.no_context, text)


if __name__ == "__main__":
    main()
