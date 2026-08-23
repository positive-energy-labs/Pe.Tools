"""Render cropped per-zone promotion disposition panels from the offline report."""

import argparse
import colorsys
import hashlib
import json
import math
import re
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageOps

import overlay


# The panel answers four questions, and every color belongs to exactly one of them:
#   RECEIVED  what the solver partitioned on as captured evidence — replay seed ink, solid
#             near-black, never denoised, never painted over. If the input is noisy (attic
#             framing lattice), showing that noise is the point.
#   ADDED     obstruction the sealers invented — screened (checkerboard), never solid, so
#             synthetic cells cannot be mistaken for drawn walls. When the INKC sidecar
#             (classes_<token>.bin, derived from the zone's Seals path) is present the seal
#             layer splits honestly: SEAL_DOOR is door-head (+ oversize fringe) closure,
#             SEAL_RUN is the heuristic wall-run gap sealer. Older artifacts fall back to
#             the merged seals_*.bin drawn as one SEAL_DOOR-colored layer. CLOSE is the
#             stud-gap morphological close, muted because it rims every wall by construction.
#   DECIDED   accepted / held / void / excluded areas — crisp outlines over pale solid fills
#             UNDER the evidence, so a decision can never obscure the ink it was made on.
#   REFERENCE the zone boundary.
ACCEPTED = (24, 91, 122)
ACCEPTED_FILL = (229, 237, 241)
HELD = (219, 150, 55)
HELD_FILL = (250, 238, 217)
REVIEW_HELD = (190, 55, 145)
REVIEW_HELD_FILL = (249, 224, 241)
VOID = (145, 145, 145)
VOID_FILL = (236, 236, 236)
EXCLUDED = (92, 92, 92)
EXCLUDED_FILL = overlay.DISPOSITION_EXCLUDED
INK = (25, 25, 25)
SEAL_DOOR = (222, 58, 20)      # door-head (+ oversize fringe) closure; also merged-bin fallback
SEAL_RUN = (235, 130, 20)      # heuristic wall-run gap sealer (never backs a boundary)
CLOSE = (200, 165, 130)
ZONE = (112, 44, 138)
TRIAGE = (183, 46, 46)
PROVENANCE = {
    "zone-backed": (0, 125, 70),
    "received": (0, 92, 184),
    "bare-zone": (126, 47, 142),
    "door-head": (230, 85, 13),
    "wall-run": (238, 153, 36),
    "gap-close": (166, 121, 78),
    "free": (202, 32, 32),
}
SYNTHETIC_PROVENANCE = {"door-head", "wall-run", "gap-close"}
# Closure components smaller than this carry no reviewable signal (single-cell ceiling-height
# speckle); they are hidden from the CLOSURE layers only. Evidence ink is never denoised.
SPECK_SQFT = 0.25

HEADER_HEIGHT = 62
PANEL_HEIGHT = 770
LEGEND_Y = 658
ATLAS_HEADER_HEIGHT = 190
ATLAS_ZONE = (177, 0, 128)
ATLAS_OUTSIDE_OPACITY = 0.30
DISPOSITION_FILL_OPACITY = 0.55
ATLAS_FILL_OPACITY = 0.42


def font(size):
    try:
        return ImageFont.truetype("arial.ttf", size)
    except OSError:
        return ImageFont.load_default()


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def panel_name(index, zone):
    return f"{index:02d}_{zone.replace(' ', '_').replace('#', '_')}.png"


def artifact_path(root, relative):
    root = root.resolve()
    path = (root / relative).resolve()
    try:
        path.relative_to(root)
    except ValueError:
        raise SystemExit(f"visual input escapes artifact root: {relative}")
    return path


def polygon_mask(size, loops, point):
    """Rasterize the report's even-odd loop contract."""
    inside = np.zeros((size[1], size[0]), dtype=bool)
    for loop in loops:
        if len(loop) < 3:
            continue
        current = Image.new("1", size)
        ImageDraw.Draw(current).polygon([point(value) for value in loop], fill=1)
        inside ^= np.asarray(current, dtype=bool)
    return inside


def plan_reference_paths(root, zone):
    ink_path = artifact_path(root, zone["Ink"])
    token = ink_path.stem.removeprefix("ink_")
    return (ink_path.parent / f"plan_{token}.png",
            ink_path.parent / f"plan_{token}.json")


def load_plan_reference(root, zone):
    image_path, manifest_path = plan_reference_paths(root, zone)
    if not image_path.exists() and not manifest_path.exists():
        return None
    if not image_path.is_file() or not manifest_path.is_file():
        raise SystemExit(f"incomplete plan reference: {image_path}, {manifest_path}")
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    token = artifact_path(root, zone["Ink"]).stem.removeprefix("ink_")
    if manifest.get("schemaVersion") != 1 or manifest.get("token") != token:
        raise SystemExit(f"invalid plan reference manifest: {manifest_path}")
    if manifest.get("image") != image_path.name or manifest.get("imageSha256") != digest(image_path):
        raise SystemExit(f"stale plan reference manifest: {manifest_path}")
    image = Image.open(image_path).convert("RGB")
    if [image.width, image.height] != [manifest.get("width"), manifest.get("height")]:
        raise SystemExit(f"plan reference dimensions do not match manifest: {manifest_path}")
    for key in ("topLeft", "topRight", "bottomLeft"):
        if not isinstance(manifest.get(key), list) or len(manifest[key]) != 2:
            raise SystemExit(f"plan reference is missing {key}: {manifest_path}")
    return {"image": image, "manifest": manifest,
            "imagePath": image_path, "manifestPath": manifest_path}


def crop_plan_reference(reference, world_crop, size):
    """Resample the registered Revit plan into a north-up world-coordinate crop."""
    manifest = reference["manifest"]
    top_left = np.asarray(manifest["topLeft"], dtype=float)
    basis = np.column_stack((np.asarray(manifest["topRight"], dtype=float) - top_left,
                             np.asarray(manifest["bottomLeft"], dtype=float) - top_left))
    if abs(np.linalg.det(basis)) < 1e-9:
        raise SystemExit(f"degenerate plan reference registration: {reference['manifestPath']}")
    inverse = np.linalg.inv(basis)

    def source(world):
        uv = inverse @ (np.asarray(world, dtype=float) - top_left)
        return np.asarray([uv[0] * reference["image"].width,
                           uv[1] * reference["image"].height])

    min_x, min_y, max_x, max_y = world_crop
    source_tl = source((min_x, max_y))
    source_tr = source((max_x, max_y))
    source_bl = source((min_x, min_y))
    out_width, out_height = size
    coefficients = (
        (source_tr[0] - source_tl[0]) / out_width,
        (source_bl[0] - source_tl[0]) / out_height,
        source_tl[0],
        (source_tr[1] - source_tl[1]) / out_width,
        (source_bl[1] - source_tl[1]) / out_height,
        source_tl[1],
    )
    return reference["image"].transform(
        size, Image.Transform.AFFINE, coefficients,
        resample=Image.Resampling.BILINEAR, fillcolor="white")


def crop_grid_mask(mask, x0, y0, x1, y1):
    """Crop a bottom-up grid without clipping the requested world crop to that grid."""
    result = np.zeros((y1 - y0, x1 - x0), dtype=bool)
    source_x0, source_y0 = max(0, x0), max(0, y0)
    source_x1, source_y1 = min(mask.shape[1], x1), min(mask.shape[0], y1)
    if source_x1 <= source_x0 or source_y1 <= source_y0:
        return result
    result[source_y0 - y0:source_y1 - y0,
           source_x0 - x0:source_x1 - x0] = mask[source_y0:source_y1,
                                                  source_x0:source_x1]
    return result


def zone_input_paths(root, zone):
    ink_path = artifact_path(root, zone["Ink"])
    tsv_path = artifact_path(root, zone["Tsv"])
    replay_path = ink_path.parent / f"replay_{ink_path.stem.removeprefix('ink_')}.bin"
    if not replay_path.is_file():
        raise SystemExit(
            f"missing replay seed ink: {replay_path}\n"
            f"replay_<level>.bin is the only evidence source (stale ink_*.bin lane "
            f"deleted). Recapture: docs/features/takeoffs/manual-e2e-runbook.md "
            f"(Capture step writes replay_<level>.bin)")
    paths = [
        tsv_path,
        replay_path,
    ]
    plan = load_plan_reference(root, zone)
    if plan is not None:
        paths.extend((plan["imagePath"], plan["manifestPath"]))
    # New captures persist the detector result before promotion under this convention. Keep it
    # optional so historical run packages remain renderable; when present it is manifest-bound.
    raw_tsv_path = artifact_path(root, Path("raw-zones") / tsv_path.name)
    if raw_tsv_path.exists():
        paths.append(raw_tsv_path)
    # New diagnostic captures persist the promotion geometry on both sides of the projector.
    # Historical and early-triage zones have neither file. Once either exists for a zone, both
    # snapshots are required and manifest-bound so the trace cannot be silently partial or stale.
    stage_paths = [artifact_path(root, Path("promotion-stages") / stage / tsv_path.name)
                   for stage in ("shared-network", "frame-projector")]
    if any(path.exists() for path in stage_paths):
        paths.extend(stage_paths)
    for key in ("Seals", "Close"):
        if zone.get(key):
            paths.append(artifact_path(root, zone[key]))
    if zone.get("Seals"):
        seal_path = artifact_path(root, zone["Seals"])
        classes_path = seal_path.parent / seal_path.name.replace("seals_", "classes_")
        if classes_path.exists():
            paths.append(classes_path)
    for path in paths:
        if not path.is_file():
            raise SystemExit(f"missing visual input: {path}")
    return paths


def field(source, *names, default=None):
    """SchemaVersion 2 adds camelCase blocks next to the v1 PascalCase fields; tolerate both."""
    if not isinstance(source, dict):
        return default
    for name in names:
        if name in source:
            return source[name]
        for key in source:
            if key.lower() == name.lower():
                return source[key]
    return default


def triage_of(zone):
    """(verdict, reason) with SchemaVersion 1 defaulting to a solved zone."""
    block = field(zone, "triage") or {}
    return (field(block, "verdict", default="solve") or "solve",
            field(block, "reason", default="") or "")


def ink_ratio_of(zone):
    census = field(zone, "census") or {}
    return field(census, "inkRatio")


def zone_title(zone, review_held, bare_zone=False):
    held = 0 if bare_zone else zone["HeldRooms"]
    review = [] if bare_zone else review_held
    return (f"{zone['Zone']}   zone {zone['ZoneSqft']:.0f} sf   raw {zone['RawRooms']}   "
            f"network-strict {zone.get('SharedNetworkStrictRooms', 0)}   "
            f"accepted {zone['AcceptedRooms']}   held {held}   "
            + (f"review-held +{len(review)}   " if review else "")
            + ("zone-status held   " if bare_zone else "")
            + f"excluded {zone['ExcludedSqft']:.0f} sf")


def rejection_histogram(report):
    histogram = field(report, "RejectionHistogram") or {}
    if histogram:
        return dict(histogram)
    totals = {}
    for zone in report.get("Zones", []):
        for key, count in (field(zone, "Rejections") or {}).items():
            totals[key] = totals.get(key, 0) + count
    return totals


def aggregate(report):
    """The header-strip numbers, shared with compare-zone-runs.py so both read one truth."""
    zones = report.get("Zones", [])
    verdicts = [triage_of(zone)[0] for zone in zones]
    raw = sum(zone.get("RawRooms", 0) for zone in zones)
    accepted = sum(zone.get("AcceptedRooms", 0) for zone in zones)
    histogram = rejection_histogram(report)
    return {
        "zones": len(zones),
        "solved": sum(verdict != "hold" for verdict in verdicts),
        "held": sum(verdict == "hold" for verdict in verdicts),
        "acceptedSqft": sum(zone.get("AcceptedSqft", 0.0) for zone in zones),
        "heldSqft": sum(zone.get("HeldSqft", 0.0) for zone in zones),
        "excludedSqft": sum(zone.get("ExcludedSqft", 0.0) for zone in zones),
        "rawRooms": raw,
        "acceptedRooms": accepted,
        "conversion": (accepted / raw) if raw else None,
        "optionsHash": field(report, "optionsHash", default="-"),
        "topRejections": sorted(histogram.items(), key=lambda item: (-item[1], item[0]))[:3],
    }


def header_lines(report):
    stats = aggregate(report)
    conversion = ("n/a" if stats["conversion"] is None
                  else f"{stats['conversion']:.0%}")
    top = "   ".join(f"{key} {count}" for key, count in stats["topRejections"]) or "none"
    return [
        (f"{stats['zones']} zones   solved {stats['solved']}   triage-held {stats['held']}   "
         f"accepted {stats['acceptedSqft']:.0f} sf   held {stats['heldSqft']:.0f} sf   "
         f"excluded {stats['excludedSqft']:.0f} sf"),
        (f"raw {stats['rawRooms']} -> accepted {stats['acceptedRooms']} ({conversion})   "
         f"options {stats['optionsHash']}   top rejections: {top}"),
    ]


def unpack_mask(bits, width, height):
    flat = np.unpackbits(np.frombuffer(bits, dtype=np.uint8),
                         bitorder="little")[: width * height]
    return flat.reshape(height, width).astype(bool)


def despeckle(mask, cell):
    """Drop closure components below SPECK_SQFT. Closure layers only — never evidence."""
    try:
        from scipy.ndimage import label
    except ImportError:
        return mask
    labels, count = label(mask)
    if not count:
        return mask
    sizes = np.bincount(labels.ravel())
    keep = sizes * cell * cell >= SPECK_SQFT
    keep[0] = False
    return keep[labels]


def _point_segment_distance(point, start, end):
    dx, dy = end[0] - start[0], end[1] - start[1]
    if dx == dy == 0:
        return math.hypot(point[0] - start[0], point[1] - start[1])
    t = max(0.0, min(1.0, ((point[0] - start[0]) * dx
                           + (point[1] - start[1]) * dy) / (dx * dx + dy * dy)))
    return math.hypot(point[0] - (start[0] + t * dx),
                      point[1] - (start[1] + t * dy))


def boundary_provenance(loop, zone_loops, distances, grid, radius=0.75, min_ink_run=1.5):
    """Return raw colored runs. Short ink crossings fall through to their next support class."""
    width, height, min_x, min_y, cell = grid

    def near(name, point):
        distance = distances[name]
        if distance is None:
            return False
        x = max(0, min(width - 1, round((point[0] - min_x) / cell)))
        y = max(0, min(height - 1, round((point[1] - min_y) / cell)))
        return distance[y, x] <= radius

    def on_zone(point):
        return any(_point_segment_distance(point, start, end) <= radius
                   for zone_loop in zone_loops
                   for start, end in zip(zone_loop, zone_loop[1:] + zone_loop[:1]))

    pieces = []
    for edge_index, (start, end) in enumerate(zip(loop, loop[1:] + loop[:1])):
        length = math.dist(start, end)
        count = max(1, math.ceil(length / cell))
        for index in range(count):
            a = index / count
            b = (index + 1) / count
            p0 = (start[0] + a * (end[0] - start[0]), start[1] + a * (end[1] - start[1]))
            p1 = (start[0] + b * (end[0] - start[0]), start[1] + b * (end[1] - start[1]))
            midpoint = ((p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2)
            zone = on_zone(midpoint)
            fallback = ("bare-zone" if zone else "door-head" if near("door-head", midpoint)
                        else "wall-run" if near("wall-run", midpoint)
                        else "gap-close" if near("gap-close", midpoint) else "free")
            ink = near("received", midpoint)
            pieces.append({"class": "zone-backed" if ink and zone else "received" if ink
                           else fallback, "fallback": fallback, "start": p0, "end": p1,
                           "feet": math.dist(p0, p1), "edgeIndex": edge_index})

    index = 0
    while index < len(pieces):
        end = index + 1
        while end < len(pieces) and pieces[end]["class"] == pieces[index]["class"]:
            end += 1
        if (pieces[index]["class"] in ("received", "zone-backed")
                and sum(piece["feet"] for piece in pieces[index:end]) < min_ink_run):
            for piece in pieces[index:end]:
                piece["class"] = piece["fallback"]
        index = end

    runs = []
    for piece in pieces:
        if not runs or runs[-1]["class"] != piece["class"]:
            runs.append({"class": piece["class"], "feet": 0.0,
                         "segments": [], "edgeIndexes": []})
        runs[-1]["feet"] += piece["feet"]
        runs[-1]["segments"].append((piece["start"], piece["end"]))
        if not runs[-1]["edgeIndexes"] or runs[-1]["edgeIndexes"][-1] != piece["edgeIndex"]:
            runs[-1]["edgeIndexes"].append(piece["edgeIndex"])
    return runs


def render_zone(root, zone, output, padding_cells=12, scale=2, focus_bounds=None,
                metadata=None, provenance=False):
    ink_path = artifact_path(root, zone["Ink"])
    tsv_path = artifact_path(root, zone["Tsv"])
    # Evidence authority: the replay snapshot's seed ink — the raster the solver actually
    # partitioned on — and NOTHING else. The stale ink_*.bin fallback was deleted
    # 2026-08-17 (Attic bin was missing 51% of seed cells); zone["Ink"] is report schema
    # (C#-owned) and is only used to locate the replay sitting alongside.
    replay_path = ink_path.parent / f"replay_{ink_path.stem.removeprefix('ink_')}.bin"
    if not replay_path.exists():
        raise SystemExit(
            f"missing replay seed ink: {replay_path}\n"
            f"replay_<level>.bin is the only evidence source (stale ink_*.bin lane "
            f"deleted). Recapture: docs/features/takeoffs/manual-e2e-runbook.md "
            f"(Capture step writes replay_<level>.bin)")
    width, height, min_x, min_y, cell, bits = overlay.load_replay_seed_ink(replay_path)
    ink_mask = unpack_mask(bits, width, height)
    plan_reference = load_plan_reference(root, zone)
    ink_source = ("plan reference + replay-seed ink" if plan_reference is not None
                  else "replay-seed ink")

    # Optional (schemaVersion 3+) closure rasters. They ride the detection grid, so a mismatch
    # means the artifact is inconsistent — drop them rather than draw cells at the wrong place.
    def closure_mask(key):
        relative = zone.get(key)
        if not relative:
            return None
        path = artifact_path(root, relative)
        seal_width, seal_height, *_, seal_bits = overlay.load_ink(path)
        if (seal_width, seal_height) != (width, height):
            raise SystemExit(f"closure grid does not match replay: {path}")
        return despeckle(unpack_mask(seal_bits, width, height), cell)

    # Per-cell seal attribution (INKC sidecar, derived from the Seals path — no report field).
    # When present, door-head and wall-run closure draw as separate layers; when absent (older
    # artifacts), the merged seals bin draws as one layer in the door color.
    def class_masks():
        relative = zone.get("Seals")
        if not relative:
            return None
        seal_path = root / relative
        classes_path = seal_path.parent / seal_path.name.replace("seals_", "classes_")
        if not classes_path.exists():
            return None
        class_width, class_height, *_, data = overlay.load_classes(classes_path)
        if (class_width, class_height) != (width, height):
            raise SystemExit(f"closure class grid does not match replay: {classes_path}")
        grid = np.frombuffer(data, dtype=np.uint8).reshape(height, width)
        return (despeckle(np.isin(grid, (2, 4)), cell),   # door-head + oversize fringe
                despeckle(grid == 3, cell))               # wall-run gap

    split = class_masks()
    door_mask, run_mask = split if split is not None else (closure_mask("Seals"), None)
    close_mask = closure_mask("Close")
    bounds = focus_bounds or (zone["MinX"], zone["MinY"], zone["MaxX"], zone["MaxY"])
    x0 = math.floor((bounds[0] - min_x) / cell) - padding_cells
    x1 = math.ceil((bounds[2] - min_x) / cell) + padding_cells
    y0 = math.floor((bounds[1] - min_y) / cell) - padding_cells
    y1 = math.ceil((bounds[3] - min_y) / cell) + padding_cells
    if plan_reference is None:
        x0, x1 = max(0, x0), min(width, x1)
        y0, y1 = max(0, y0), min(height, y1)
    world_crop = (min_x + x0 * cell, min_y + y0 * cell,
                  min_x + x1 * cell, min_y + y1 * cell)
    if metadata is not None:
        metadata.update({
            "requestedBounds": [float(value) for value in bounds],
            "gridCrop": {"x0": x0, "y0": y0, "x1": x1, "y1": y1},
            "worldCrop": list(world_crop),
            "sourceGrid": {"width": width, "height": height, "minX": min_x,
                           "minY": min_y, "cell": cell},
            "paddingCells": padding_cells,
            "scale": scale,
            "layers": (["plan-reference"] if plan_reference is not None else []) +
                      ["replay-seed-ink", "door-head-seal", "wall-run-seal",
                       "gap-close", "accepted", "held", "review-held-ui-only",
                       "void", "excluded", "zone-authority"],
        })
    if x1 <= x0 or y1 <= y0:
        panel = Image.new("RGB", (900, 700), "white")
        draw = ImageDraw.Draw(panel)
        draw.text((14, 14), zone["Zone"], fill=(30, 30, 30), font=font(18))
        draw.text((250, 330), "outside captured raster", fill=(120, 120, 120), font=font(24))
        if output is not None:
            panel.save(output)
        return panel

    rooms, polygons, residues = overlay.load_disposition_tsv(tsv_path)
    domain_reflood = field(zone, "domainReflood", default={}) or {}
    review_held = field(domain_reflood, "heldCandidates", default=[]) or []
    verdict, reason = triage_of(zone)
    bare_zone = verdict == "hold" and reason in ("no-raster", "no-evidence",
                                                   "no-replay-evidence")

    def point(value):
        return ((value[0] - min_x) / cell - x0,
                y1 - (value[1] - min_y) / cell)

    # Decision fills go down FIRST so nothing they claim can hide a single evidence cell.
    image = (crop_plan_reference(plan_reference, world_crop, (x1 - x0, y1 - y0))
             if plan_reference is not None
             else Image.new("RGB", (x1 - x0, y1 - y0), "white"))

    def fill_loops(loops, color):
        # The loop contract is even-odd, not assumed outer-first.
        if loops:
            even_odd = polygon_mask(image.size, loops, point)
            tint = Image.blend(image, Image.new("RGB", image.size, color),
                               DISPOSITION_FILL_OPACITY)
            image.paste(tint, mask=Image.fromarray(even_odd.astype(np.uint8) * 255))

    for residue in ([] if bare_zone else residues):
        loops = residue["loops"]
        if not loops:
            continue
        fill = (HELD_FILL if residue["reason"] == "rejected" else
                EXCLUDED_FILL if residue["reason"] == "excluded" else VOID_FILL)
        fill_loops(loops, fill)
    for room_id in ([] if bare_zone else sorted(rooms)):
        fill_loops([loop for _kind, loop in polygons.get(room_id, [])], ACCEPTED_FILL)
    for candidate in ([] if bare_zone else review_held):
        loops = field(candidate, "polygons", default=[]) or []
        if loops:
            fill_loops(loops, REVIEW_HELD_FILL)

    # Raster layers over the fills: synthetic closures screened (checkerboard — never solid,
    # so they cannot read as drawn walls), then evidence ink solid black on top of everything.
    pixels = np.asarray(image).copy()          # rows top-down; grid rows bottom-up

    def paint(mask, color, screened):
        crop = crop_grid_mask(mask, x0, y0, x1, y1)
        if screened:
            yy, xx = np.mgrid[y0:y1, x0:x1]
            crop = crop & ((yy + xx) % 2 == 0)
        pixels[crop[::-1]] = color

    if close_mask is not None:
        paint(close_mask, CLOSE, screened=True)
    if run_mask is not None:
        paint(run_mask, SEAL_RUN, screened=True)
    if door_mask is not None:
        paint(door_mask, SEAL_DOOR, screened=True)
    paint(ink_mask, INK, screened=False)
    inside_zone = polygon_mask(image.size, zone["ZoneLoops"], point)
    pixels[~inside_zone] = np.rint(
        pixels[~inside_zone] * ATLAS_OUTSIDE_OPACITY
        + 255 * (1 - ATLAS_OUTSIDE_OPACITY)).astype(np.uint8)
    image = Image.fromarray(pixels)

    draw = ImageDraw.Draw(image)
    for residue in ([] if bare_zone else residues):
        loops = residue["loops"]
        if not loops:
            continue
        color = (HELD if residue["reason"] == "rejected" else
                  EXCLUDED if residue["reason"] == "excluded" else VOID)
        if not provenance or residue["reason"] != "rejected":
            draw.line([point(value) for value in loops[0]] + [point(loops[0][0])],
                      fill=color, width=2)
        for hole in loops[1:]:
            draw.line([point(value) for value in hole] + [point(hole[0])],
                      fill=color, width=1)
    for room_id in ([] if bare_zone else sorted(rooms)):
        for kind, loop in polygons.get(room_id, []):
            if len(loop) >= 2 and not provenance:
                draw.line([point(value) for value in loop] + [point(loop[0])],
                          fill=ACCEPTED, width=3 if kind == "outer" else 2)
    for candidate in ([] if bare_zone else review_held):
        for loop in field(candidate, "polygons", default=[]) or []:
            if len(loop) >= 2 and not provenance:
                _draw_dashed(draw, [point(value) for value in loop],
                             REVIEW_HELD, 3, (7, 4))
    # Scope is a first-class review datum, not an inferred crop. Draw every outer/hole loop last
    # so a reviewer can see exactly what the accepted, held, and excluded areas must partition.
    for loop in zone["ZoneLoops"]:
        if len(loop) >= 2:
            draw.line([point(value) for value in loop] + [point(loop[0])],
                      fill=ZONE, width=3)

    if provenance:
        masks = {"received": ink_mask, "door-head": door_mask, "wall-run": run_mask,
                 "gap-close": close_mask}
        from scipy.ndimage import distance_transform_edt
        distances = {
            name: distance_transform_edt(~mask) * cell if mask is not None else None
            for name, mask in masks.items()
        }
        boundaries = []
        candidates = [
            ("accepted", room_id, kind, loop)
            for room_id in ([] if bare_zone else sorted(rooms))
            for kind, loop in polygons.get(room_id, [])
        ] + [
            ("held", residue["id"], "outer" if index == 0 else "hole", loop)
            for residue in ([] if bare_zone else residues) if residue["reason"] == "rejected"
            for index, loop in enumerate(residue["loops"])
        ] + [
            ("review-held", field(candidate, "id"),
             "outer" if index == 0 else "hole", loop)
            for candidate in ([] if bare_zone else review_held)
            for index, loop in enumerate(field(candidate, "polygons", default=[]) or [])
        ]
        totals = {name: 0.0 for name in PROVENANCE}
        regions = {}
        for status, boundary_id, kind, loop in candidates:
            runs = boundary_provenance(
                loop, zone["ZoneLoops"], distances,
                (width, height, min_x, min_y, cell))
            for run in runs:
                totals[run["class"]] += run["feet"]
                if run["class"] != "bare-zone":
                    for start, end in run["segments"]:
                        draw.line([point(start), point(end)],
                                  fill=PROVENANCE[run["class"]], width=4)
            boundaries.append({
                "status": status, "id": boundary_id, "kind": kind,
                "runs": [{
                    "class": run["class"], "feet": round(run["feet"], 3),
                    "edgeIndex": run["edgeIndexes"][0],
                    "edgeIndexes": run["edgeIndexes"],
                    "from": [round(value, 6) for value in run["segments"][0][0]],
                    "to": [round(value, 6) for value in run["segments"][-1][1]],
                }
                         for run in runs],
            })
            key = (status, boundary_id)
            xs, ys = zip(*loop)
            region = regions.setdefault(key, {
                "status": status, "id": boundary_id, "holes": 0,
                "syntheticSplices": 0, "syntheticFeet": 0.0,
                "bounds": [min(xs), min(ys), max(xs), max(ys)],
            })
            region["holes"] += kind == "hole"
            region["syntheticSplices"] += sum(
                run["class"] in SYNTHETIC_PROVENANCE for run in runs)
            region["syntheticFeet"] += sum(
                run["feet"] for run in runs if run["class"] in SYNTHETIC_PROVENANCE)
            region["bounds"] = [
                min(region["bounds"][0], min(xs)), min(region["bounds"][1], min(ys)),
                max(region["bounds"][2], max(xs)), max(region["bounds"][3], max(ys)),
            ]
        metadata["boundaries"] = boundaries
        metadata["regions"] = [
            {**region, "syntheticFeet": round(region["syntheticFeet"], 3)}
            for region in regions.values()
        ]
        metadata["totalsFeet"] = {name: round(value, 3) for name, value in totals.items()}
        metadata["sampler"] = {"stepFeet": cell, "radiusFeet": 0.75,
                               "minimumCoherentInkRunFeet": 1.5}

    if scale != 1:
        image = image.resize((image.width * scale, image.height * scale), Image.Resampling.NEAREST)
    if focus_bounds and image.width < 900 and image.height < 588:
        fit = min(900 / image.width, 588 / image.height)
        image = image.resize((round(image.width * fit), round(image.height * fit)),
                             Image.Resampling.NEAREST)
    else:
        image.thumbnail((900, 588), Image.Resampling.LANCZOS)
    if metadata is not None:
        metadata["fit"] = {
            "panel": [900, PANEL_HEIGHT],
            "contentMax": [900, 588],
            "renderedContent": [image.width, image.height],
        }
    # A held zone still shows its raster and zone loops: triage is a routing verdict a reviewer
    # must be able to argue with, not a reason to hide the evidence.
    display_reason = "no-replay-evidence" if reason == "no-raster" and plan_reference else reason
    banner = f"TRIAGE-HELD {display_reason}".strip() + "   " if verdict == "hold" else ""
    title = zone_title(zone, review_held, bare_zone)
    ratio = ink_ratio_of(zone)
    # "closure" used to name the accounting residual here, which collides with the closure the
    # sealers draw. The residual is a leak; closure is sealed area, split by which sealer claimed
    # it. Absent (schemaVersion < 3) it simply does not appear.
    breakdown = field(zone, "closure") or {}
    sealed = field(zone, "closureSqft")
    closure_text = ""
    if sealed is not None:
        door = field(breakdown, "doorHeadSqft", default=0.0)
        run = field(breakdown, "wallRunGapSqft", default=0.0)
        closure_text = f"closure {sealed:.0f} sf (head {door:.0f} / run {run:.0f})   "
    subtitle = (f"ink {zone['InkBackedEdgeFraction']:.0%}   "
                + (f"ink-ratio {ratio:.0%}   " if ratio is not None else "")
                + closure_text
                 + f"shared {field(zone, 'SharedEdgePairs', default=0)}/"
                 f"{field(zone, 'LostSharedEdgePairs', default=0)} lost   "
                 f"leak {field(zone, 'ClosureErrorSqft', default=0.0):.3f} sf   {ink_source}")
    panel = Image.new("RGB", (900, PANEL_HEIGHT), "white")
    panel.paste(image, ((900 - image.width) // 2, 66 + (588 - image.height) // 2))
    panel_draw = ImageDraw.Draw(panel)
    # The banner is prominent but must not push the counts off the panel: shrink to fit instead.
    size = 18
    while size > 12 and panel_draw.textlength(banner + title, font=font(size)) > 872:
        size -= 1
    x = 14
    if banner:
        panel_draw.text((x, 9), banner, fill=TRIAGE, font=font(size + 1))
        x += panel_draw.textlength(banner, font=font(size + 1))
    panel_draw.text((x, 10), title, fill=(30, 30, 30), font=font(size))
    panel_draw.text((14, 32), subtitle, fill=(70, 70, 70), font=font(16))
    draw_provenance_legend(panel_draw) if provenance else draw_legend(panel_draw)
    if output is not None:
        panel.save(output)
    return panel


def _legend_swatch(draw, x, y, color, style, fill=None):
    if style == "screen":
        for sy in range(14):
            for sx in range(14):
                if (sx + sy) % 2 == 0:
                    draw.point((x + sx, y + 2 + sy), fill=color)
    elif style == "line":
        draw.line((x, y + 9, x + 16, y + 9), fill=color, width=4)
    elif style == "decision":
        draw.rectangle((x, y + 2, x + 14, y + 16), fill=fill, outline=color, width=2)
    else:
        draw.rectangle((x, y + 2, x + 14, y + 16), fill=color)
    return x + 20


def _legend_items(draw, y, heading, items):
    legend_font = font(12)
    x = 14
    draw.text((x, y), heading, fill=(45, 45, 45), font=legend_font)
    x += draw.textlength(heading, font=legend_font) + 10
    for color, style, label, item_fill in items:
        x = _legend_swatch(draw, x, y, color, style, item_fill)
        draw.text((x, y), label, fill=(60, 60, 60), font=legend_font)
        x += draw.textlength(label, font=legend_font) + 13
    return x


PIXEL_LEGEND = (
    (INK, "solid", "received (solid/pixelated)", None),
    (SEAL_DOOR, "screen", "door-head (dithered)", None),
    (SEAL_RUN, "screen", "wall-run (dithered)", None),
    (CLOSE, "screen", "gap-close (dithered)", None),
)
DECISION_LEGEND = (
    (ACCEPTED, "decision", "accepted", ACCEPTED_FILL),
    (HELD, "decision", "held", HELD_FILL),
    (REVIEW_HELD, "decision", "review-held (UI-only)", REVIEW_HELD_FILL),
    (EXCLUDED, "decision", "excluded", EXCLUDED_FILL),
    (VOID, "decision", "void", VOID_FILL),
)


def draw_legend(panel_draw):
    """The in-image key every panel carries: received / added / decided / reference."""
    _legend_items(panel_draw, LEGEND_Y, "PIXELS", PIXEL_LEGEND)
    _legend_items(panel_draw, LEGEND_Y + 20, "FILL + OUTLINE", DECISION_LEGEND)
    _legend_items(panel_draw, LEGEND_Y + 40, "ZONE", (
        (ZONE, "line", "authority outline only; outside plan 30%", None),
    ))


def draw_provenance_legend(panel_draw):
    _legend_items(panel_draw, LEGEND_Y, "PIXELS", PIXEL_LEGEND)
    _legend_items(panel_draw, LEGEND_Y + 20, "DECISION FILL", DECISION_LEGEND)
    _legend_items(panel_draw, LEGEND_Y + 40, "BOUNDARY SUPPORT", tuple(
        (PROVENANCE[name], "line", name, None)
        for name in ("zone-backed", "received", "door-head", "wall-run")))
    x = _legend_items(panel_draw, LEGEND_Y + 60, "BOUNDARY SUPPORT", tuple(
        (PROVENANCE[name], "line", name, None)
        for name in ("gap-close", "free")))
    panel_draw.text((x, LEGEND_Y + 60), "bare-zone = no overlay",
                    fill=(60, 60, 60), font=font(12))
    _legend_items(panel_draw, LEGEND_Y + 80, "ZONE", (
        (ZONE, "line", "authority outline only; outside plan 30%", None),
    ))


def render_contact_sheet(report, panels, contact_path):
    columns = 3
    thumb_size = (600, 467)
    rows = math.ceil(len(panels) / columns)
    contact = Image.new("RGB", (columns * thumb_size[0],
                                HEADER_HEIGHT + rows * thumb_size[1]), "white")
    draw = ImageDraw.Draw(contact)
    draw.rectangle((0, 0, contact.width, HEADER_HEIGHT - 1), fill=(244, 244, 246))
    draw.line((0, HEADER_HEIGHT - 1, contact.width, HEADER_HEIGHT - 1), fill=(180, 180, 184))
    for line_index, line in enumerate(header_lines(report)):
        draw.text((16, 10 + line_index * 24), line, fill=(30, 30, 30), font=font(19))
    for index, path in enumerate(panels):
        with Image.open(path) as image:
            thumb = ImageOps.contain(image.convert("RGB"), thumb_size, Image.Resampling.LANCZOS)
        contact.paste(thumb, ((index % columns) * thumb_size[0],
                              HEADER_HEIGHT + (index // columns) * thumb_size[1]))
    contact.save(contact_path)


def _atlas_color(key, salt=0):
    """Stable pastel fill keyed independently of disposition and report order."""
    value = hashlib.sha256(f"{key}\0{salt}".encode("utf-8")).digest()
    hue = int.from_bytes(value[:8], "big") / (1 << 64)
    saturation = 0.50 + value[8] / 255 * 0.14
    brightness = 0.88 + value[9] / 255 * 0.08
    rgb = colorsys.hsv_to_rgb(hue, saturation, brightness)
    return tuple(round((component * 255) * 0.68 + 255 * 0.32) for component in rgb)


def _atlas_candidate_key(zone, candidate_id):
    return f"{field(zone, 'zoneKey') or zone['Zone']}\0{candidate_id}"


def _atlas_colors(keys):
    colors, used = {}, set()
    for key in sorted(keys):
        salt = 0
        color = _atlas_color(key, salt)
        while color in used:
            salt += 1
            color = _atlas_color(key, salt)
        colors[key] = color
        used.add(color)
    return colors


def _draw_dashed(draw, points, fill, width, dash):
    points = [*points, points[0]]
    if dash is None:
        draw.line(points, fill=fill, width=width, joint="curve")
        return
    on, off = dash
    for start, end in zip(points, points[1:]):
        length = math.dist(start, end)
        if not length:
            continue
        dx, dy = (end[0] - start[0]) / length, (end[1] - start[1]) / length
        distance = 0.0
        while distance < length:
            stop = min(distance + on, length)
            draw.line((start[0] + dx * distance, start[1] + dy * distance,
                       start[0] + dx * stop, start[1] + dy * stop),
                      fill=fill, width=width)
            distance += on + off


def _atlas_label(draw, point, text, text_font):
    box = draw.textbbox(point, text, font=text_font, anchor="mm")
    draw.rectangle((box[0] - 2, box[1] - 1, box[2] + 2, box[3] + 1), fill="white")
    draw.text(point, text, fill=(35, 35, 35), font=text_font, anchor="mm")


def _short_atlas_label(status, candidate_id):
    match = re.search(r"R(\d+)", candidate_id)
    suffix = f"{int(match.group(1)):02d}" if match else ""
    return {"accepted": "A", "held": "H", "review-held": "C"}[status] + suffix


def _draw_atlas_key(draw, y, text_size=13):
    key_font = font(text_size)
    muted = (55, 55, 55)
    x = 12
    draw.text((x, y), "FILL", fill=muted, font=key_font)
    x += draw.textlength("FILL", font=key_font) + 8
    draw.rectangle((x, y + 2, x + 18, y + 15), fill=(144, 207, 238))
    x += 24
    label = "solid color = room identity (stable; not status)"
    draw.text((x, y), label, fill=muted, font=key_font)

    x, y = 12, y + 21
    draw.text((x, y), "OUTLINE", fill=muted, font=key_font)
    x += draw.textlength("OUTLINE", font=key_font) + 8
    styles = {
        "A accepted": (ACCEPTED, 4, None),
        "H held": (HELD, 4, (6, 4)),
        "C review-held (UI-only)": (REVIEW_HELD, 3, (7, 4)),
        "X excluded": (EXCLUDED, 2, (2, 5)),
        "V void": (VOID, 2, (10, 4)),
    }
    for label, (color, width, dash) in styles.items():
        _draw_dashed(draw, [(x, y + 9), (x + 24, y + 9)], color, width, dash)
        x += 30
        draw.text((x, y), label, fill=muted, font=key_font)
        x += draw.textlength(label, font=key_font) + 14

    x, y = 12, y + 21
    draw.text((x, y), "SOLID PIXELS", fill=muted, font=key_font)
    x += draw.textlength("SOLID PIXELS", font=key_font) + 8
    draw.rectangle((x, y + 2, x + 13, y + 15), fill=INK)
    x += 19
    label = "received plan raster (pixelated at source)"
    draw.text((x, y), label, fill=muted, font=key_font)

    x, y = 12, y + 21
    draw.text((x, y), "DITHERED PIXELS", fill=muted, font=key_font)
    x += draw.textlength("DITHERED PIXELS", font=key_font) + 8
    for color, label in ((SEAL_DOOR, "door-head seal"),
                         (SEAL_RUN, "wall-run seal"), (CLOSE, "gap-close")):
        _legend_swatch(draw, x, y, color, "screen")
        x += 20
        draw.text((x, y), label, fill=muted, font=key_font)
        x += draw.textlength(label, font=key_font) + 14
    draw.text((x, y), "(closeups only)", fill=(120, 120, 120), font=key_font)

    x, y = 12, y + 21
    _draw_dashed(draw, [(x, y + 9), (x + 24, y + 9)], ATLAS_ZONE, 3, (14, 8))
    x += 30
    draw.text((x, y), "Z zone authority: outline only; bare-zone has no overlay; outside plan 30%",
              fill=muted, font=key_font)


def render_level_atlas(root, level, zones, output):
    ink_paths = {artifact_path(root, zone["Ink"]) for zone in zones}
    replay_paths = {
        path.parent / f"replay_{path.stem.removeprefix('ink_')}.bin"
        for path in ink_paths
    }
    if len(replay_paths) != 1:
        raise SystemExit(f"level {level} has {len(replay_paths)} replay rasters")
    replay_path = replay_paths.pop()
    if not replay_path.is_file():
        raise SystemExit(f"missing replay seed ink: {replay_path}")
    width, height, min_x, min_y, cell, bits = overlay.load_replay_seed_ink(replay_path)
    references = [load_plan_reference(root, zone) for zone in zones]
    if any(reference is not None for reference in references):
        if not all(reference is not None for reference in references):
            raise SystemExit(f"level {level} has partial plan-reference coverage")
        reference_paths = {reference["imagePath"] for reference in references}
        if len(reference_paths) != 1:
            raise SystemExit(f"level {level} has multiple plan references")
        plan_reference = references[0]
    else:
        plan_reference = None
    bounds = (min(zone["MinX"] for zone in zones), min(zone["MinY"] for zone in zones),
              max(zone["MaxX"] for zone in zones), max(zone["MaxY"] for zone in zones))
    zone_width = (bounds[2] - bounds[0]) / cell
    zone_height = (bounds[3] - bounds[1]) / cell
    margin = max(12, round(max(zone_width, zone_height) * 0.04))
    x0 = math.floor((bounds[0] - min_x) / cell) - margin
    x1 = math.ceil((bounds[2] - min_x) / cell) + margin
    y0 = math.floor((bounds[1] - min_y) / cell) - margin
    y1 = math.ceil((bounds[3] - min_y) / cell) + margin
    if plan_reference is None:
        x0, x1 = max(0, x0), min(width, x1)
        y0, y1 = max(0, y0), min(height, y1)
    world_crop = (min_x + x0 * cell, min_y + y0 * cell,
                  min_x + x1 * cell, min_y + y1 * cell)

    def point(value):
        return ((value[0] - min_x) / cell - x0,
                y1 - (value[1] - min_y) / cell)

    candidates = []
    for zone in zones:
        rooms, polygons, residues = overlay.load_disposition_tsv(
            artifact_path(root, zone["Tsv"]))
        verdict, reason = triage_of(zone)
        if verdict == "hold" and reason in ("no-raster", "no-evidence",
                                              "no-replay-evidence"):
            continue
        for room_id in sorted(rooms):
            loops = polygons.get(room_id, [])
            candidates.append(("accepted", zone, room_id,
                               [loop for kind, loop in loops if kind == "outer"],
                               [loop for kind, loop in loops if kind == "hole"],
                               (rooms[room_id]["lx"], rooms[room_id]["ly"])))
        for residue in residues:
            status = {"rejected": "held", "excluded": "excluded"}.get(
                residue["reason"], "void")
            loops = residue["loops"]
            if loops:
                xs, ys = zip(*loops[0])
                label = ((min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2)
                candidates.append((status, zone, residue["id"], loops[:1], loops[1:], label))
        domain_reflood = field(zone, "domainReflood", default={}) or {}
        for candidate in field(domain_reflood, "heldCandidates", default=[]) or []:
            loops = field(candidate, "polygons", default=[]) or []
            if loops:
                xs, ys = zip(*loops[0])
                label = ((min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2)
                candidates.append(("review-held", zone, field(candidate, "id"),
                                   loops[:1], loops[1:], label))

    keys = [_atlas_candidate_key(zone, candidate_id)
            for _status, zone, candidate_id, *_rest in candidates]
    if len(keys) != len(set(keys)):
        raise SystemExit(f"level {level} has duplicate candidate identity")
    colors = _atlas_colors(keys)
    plan = (crop_plan_reference(plan_reference, world_crop, (x1 - x0, y1 - y0))
            if plan_reference is not None
            else Image.new("RGB", (x1 - x0, y1 - y0), "white"))
    for key, (_, _zone, _candidate_id, outers, holes, _label) in zip(keys, candidates):
        mask = Image.new("L", plan.size)
        mask_draw = ImageDraw.Draw(mask)
        for loop in outers:
            if len(loop) >= 3:
                mask_draw.polygon([point(value) for value in loop], fill=255)
        for loop in holes:
            if len(loop) >= 3:
                mask_draw.polygon([point(value) for value in loop], fill=0)
        tint = Image.blend(plan, Image.new("RGB", plan.size, colors[key]),
                           ATLAS_FILL_OPACITY)
        plan.paste(tint, mask=mask)

    inside = np.zeros((plan.height, plan.width), dtype=bool)
    for zone in zones:
        inside |= polygon_mask(plan.size, zone["ZoneLoops"], point)

    pixels = np.asarray(plan).copy()
    pixels[~inside] = np.rint(
        pixels[~inside] * ATLAS_OUTSIDE_OPACITY
        + 255 * (1 - ATLAS_OUTSIDE_OPACITY)).astype(np.uint8)
    ink = crop_grid_mask(unpack_mask(bits, width, height), x0, y0, x1, y1)[::-1]
    outside_ink = tuple(round(channel * ATLAS_OUTSIDE_OPACITY
                              + 255 * (1 - ATLAS_OUTSIDE_OPACITY)) for channel in INK)
    pixels[ink & ~inside] = outside_ink
    pixels[ink & inside] = INK
    plan = Image.fromarray(pixels)
    draw = ImageDraw.Draw(plan)
    styles = {
        "accepted": (ACCEPTED, 4, None, "A"),
        "held": (HELD, 4, (6, 4), "H"),
        "review-held": (REVIEW_HELD, 3, (7, 4), "C"),
        "excluded": (EXCLUDED, 2, (2, 5), "X"),
        "void": (VOID, 2, (10, 4), "V"),
    }
    label_font = font(11)
    for status, _zone, candidate_id, outers, holes, label in candidates:
        color, line_width, dash, prefix = styles[status]
        for loop in [*outers, *holes]:
            if len(loop) >= 2:
                _draw_dashed(draw, [point(value) for value in loop], color, line_width, dash)
        if status in ("accepted", "held", "review-held"):
            _atlas_label(draw, point(label), _short_atlas_label(status, candidate_id), label_font)

    zone_font = font(14)
    for zone in zones:
        for loop in zone["ZoneLoops"]:
            if len(loop) >= 2:
                _draw_dashed(draw, [point(value) for value in loop], ATLAS_ZONE, 3, (14, 8))
        _atlas_label(draw, point((zone["MinX"] + 1.0, zone["MaxY"] - 1.0)),
                     f"Z{zone['Zone'].rsplit('#', 1)[-1]}", zone_font)

    panel = Image.new("RGB", (plan.width, plan.height + ATLAS_HEADER_HEIGHT), "white")
    panel.paste(plan, (0, ATLAS_HEADER_HEIGHT))
    panel_draw = ImageDraw.Draw(panel)
    panel_draw.text((12, 7), f"{level} full-plan atlas", fill=(25, 25, 25), font=font(20))
    panel_draw.text((12, 33),
                    f"{len(zones)} zones   {len(candidates)} colored candidates   "
                    + ("real plan reference + replay seed ink" if plan_reference is not None
                       else "replay seed ink"),
                    fill=(70, 70, 70), font=font(15))
    _draw_atlas_key(panel_draw, 57)
    panel.save(output)
    return len(candidates)


def render_level_atlases(root, report):
    levels = {}
    for zone in report["Zones"]:
        levels.setdefault(zone["Level"], []).append(zone)
    output_dir = root / "review-atlas"
    output_dir.mkdir(exist_ok=True)
    outputs = []
    for index, (level, zones) in enumerate(levels.items(), start=1):
        output = output_dir / panel_name(index, level)
        render_level_atlas(root, level, zones, output)
        outputs.append(output)
    contact = output_dir / "contact-sheet.png"
    columns, thumb_size = 2, (900, 700)
    sheet_header = ATLAS_HEADER_HEIGHT
    sheet = Image.new("RGB", (columns * thumb_size[0],
                              sheet_header + math.ceil(len(outputs) / columns) * thumb_size[1]),
                      "white")
    sheet_draw = ImageDraw.Draw(sheet)
    sheet_draw.text((16, 14), "Full-plan room atlas by level", fill=(30, 30, 30), font=font(22))
    _draw_atlas_key(sheet_draw, 45, text_size=15)
    for index, path in enumerate(outputs):
        with Image.open(path) as image:
            image = image.convert("RGB")
            tile = Image.new("RGB", (image.width, image.height - ATLAS_HEADER_HEIGHT + 56),
                             "white")
            tile.paste(image.crop((0, 0, image.width, 56)), (0, 0))
            tile.paste(image.crop((0, ATLAS_HEADER_HEIGHT, image.width, image.height)),
                       (0, 56))
            thumb = ImageOps.contain(tile, thumb_size, Image.Resampling.LANCZOS)
        sheet.paste(thumb, ((index % columns) * thumb_size[0],
                            sheet_header + (index // columns) * thumb_size[1]))
    sheet.save(contact)
    return outputs, contact


def verify(manifest_path):
    manifest_path = Path(manifest_path).resolve()
    root = manifest_path.parent
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    expected = {
        manifest["report"]: manifest["reportSha256"],
        **manifest["inputs"],
        **manifest["files"],
    }
    failures = []
    for relative, expected_hash in expected.items():
        path = artifact_path(root, relative)
        actual = digest(path) if path.is_file() else None
        if actual != expected_hash:
            failures.append(f"{relative}: expected {expected_hash}, got {actual or 'missing'}")
    report_path = artifact_path(root, manifest["report"])
    if report_path.is_file():
        zone_count = len(json.loads(report_path.read_text(encoding="utf-8"))["Zones"])
        if zone_count != manifest["panelCount"]:
            failures.append(
                f"panelCount: manifest {manifest['panelCount']}, report {zone_count}")
    expected_outputs = set(manifest["files"])
    output_dirs = [root / "review"]
    if manifest.get("provenanceContactSheet"):
        output_dirs.append(root / "review-provenance")
    if manifest.get("atlasContactSheet"):
        output_dirs.append(root / "review-atlas")
    actual_outputs = {
        path.relative_to(root).as_posix()
        for directory in output_dirs for path in directory.glob("*.png")
    }
    for relative in sorted(actual_outputs - expected_outputs):
        failures.append(f"{relative}: unexpected output")
    if failures:
        raise SystemExit("review verification failed:\n" + "\n".join(failures))
    print(f"verified {manifest['panelCount']} panels and {len(manifest['inputs'])} inputs: {root}")
    return len(expected)


def semantic_verdict_rows(verdict_path):
    text = Path(verdict_path).read_text(encoding="utf-8")
    declared = re.findall(r"Manifest SHA-256:\s*`([0-9a-fA-F]{64})`", text)
    if len(declared) != 1:
        raise SystemExit(
            "semantic verdict must declare exactly one Manifest SHA-256")
    pattern = re.compile(
        r"^\|\s*(\d+)\s*\|\s*`([^`]+)`\s*\|\s*"
        r"(PASS|FAIL|AMBIGUOUS)\s*\|\s*([^|]+?)\s*\|\s*"
        r"([^|]+?)\s*\|\s*([^|]+?)\s*\|$", re.MULTILINE)
    rows = [{
        "ordinal": int(match.group(1)),
        "panel": match.group(2),
        "verdict": match.group(3),
        "highestSeverity": match.group(4).strip(),
        "namedDefect": match.group(5).strip(),
        "concreteLocation": match.group(6).strip(),
    } for match in pattern.finditer(text)]
    panels = [row["panel"] for row in rows]
    ordinals = [row["ordinal"] for row in rows]
    if len(panels) != len(set(panels)) or len(ordinals) != len(set(ordinals)):
        raise SystemExit("semantic verdict contains duplicate panel or ordinal rows")
    return declared[0].lower(), rows


def semantic_census(manifest_path, verdict_path):
    manifest_path = Path(manifest_path).resolve()
    verdict_path = Path(verdict_path).resolve()
    declared_manifest_hash, rows = semantic_verdict_rows(verdict_path)
    manifest_hash = digest(manifest_path)
    if declared_manifest_hash != manifest_hash:
        raise SystemExit(
            "semantic verdict manifest mismatch: "
            f"declared {declared_manifest_hash}, actual {manifest_hash}")
    verified_hashes = verify(manifest_path)
    root = manifest_path.parent
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    report_path = artifact_path(root, manifest["report"])
    report = json.loads(report_path.read_text(encoding="utf-8"))
    expected = [
        f"review/{panel_name(index, zone['Zone'])}"
        for index, zone in enumerate(report["Zones"], start=1)
    ]
    manifest_panels = {
        relative for relative in manifest["files"]
        if relative.startswith("review/")
        and relative.endswith(".png")
        and relative != manifest["contactSheet"]
    }
    verdict_panels = {f"review/{row['panel']}" for row in rows}
    failures = []
    for source, panels in (("manifest", manifest_panels), ("verdict", verdict_panels)):
        missing = sorted(set(expected) - panels)
        unexpected = sorted(panels - set(expected))
        if missing:
            failures.append(f"{source} missing: {', '.join(missing)}")
        if unexpected:
            failures.append(f"{source} unexpected: {', '.join(unexpected)}")
    expected_ordinals = set(range(1, len(expected) + 1))
    actual_ordinals = {row["ordinal"] for row in rows}
    if actual_ordinals != expected_ordinals:
        failures.append(
            "verdict ordinals: expected "
            f"{sorted(expected_ordinals)}, got {sorted(actual_ordinals)}")
    if failures:
        raise SystemExit(
            "semantic verdict panel census failed:\n" + "\n".join(failures))

    labels = {row["panel"]: row for row in rows}
    counts = {
        verdict: sum(row["verdict"] == verdict for row in rows)
        for verdict in ("PASS", "FAIL", "AMBIGUOUS")
    }
    zones = []
    for index, zone in enumerate(report["Zones"], start=1):
        panel = panel_name(index, zone["Zone"])
        zone_sqft = float(field(zone, "ZoneSqft", default=0.0))
        if zone_sqft <= 0:
            raise SystemExit(f"semantic census zone has no positive area: {zone['Zone']}")
        dispositions = {}
        for name, source in (
                ("accepted", "AcceptedSqft"), ("held", "HeldSqft"),
                ("void", "VoidSqft"), ("excluded", "ExcludedSqft")):
            sqft = float(field(zone, source, default=0.0))
            dispositions[name] = {"sqft": sqft, "fraction": sqft / zone_sqft}
        label = labels[panel]
        zones.append({
            "ordinal": index,
            "panel": panel,
            "zone": zone["Zone"],
            "zoneKey": field(zone, "zoneKey"),
            "verdict": label["verdict"],
            "highestSeverity": label["highestSeverity"],
            "namedDefect": label["namedDefect"],
            "concreteLocation": label["concreteLocation"],
            "zoneSqft": zone_sqft,
            "dispositions": dispositions,
        })
    return {
        "schemaVersion": 1,
        "scope": "external evaluation data; never solver or product input",
        "reviewManifest": str(manifest_path),
        "reviewManifestSha256": manifest_hash,
        "semanticVerdict": str(verdict_path),
        "semanticVerdictSha256": digest(verdict_path),
        "verifiedHashes": verified_hashes,
        "panelCount": len(expected),
        "counts": counts,
        "zones": zones,
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("report", nargs="?")
    parser.add_argument("--verify", metavar="MANIFEST")
    parser.add_argument("--semantic-verdict", metavar="VERDICT")
    parser.add_argument("--manifest", metavar="MANIFEST")
    parser.add_argument("--out", metavar="JSON")
    parser.add_argument("--provenance", action="store_true")
    parser.add_argument("--require-plan", action="store_true",
                        help="fail unless every panel has a registered real-plan raster")
    args = parser.parse_args()
    if args.semantic_verdict:
        if not args.manifest:
            parser.error("--manifest is required with --semantic-verdict")
        if args.report or args.verify:
            parser.error("--semantic-verdict cannot be combined with report or --verify")
        census = semantic_census(args.manifest, args.semantic_verdict)
        payload = json.dumps(census, indent=2) + "\n"
        if args.out:
            output = Path(args.out).resolve()
            output.parent.mkdir(parents=True, exist_ok=True)
            output.write_text(payload, encoding="utf-8")
            print(
                f"semantic census PASS={census['counts']['PASS']} "
                f"FAIL={census['counts']['FAIL']} "
                f"AMBIGUOUS={census['counts']['AMBIGUOUS']}: {output}")
        else:
            print(payload, end="")
        return
    if args.verify:
        if args.manifest or args.out or args.provenance:
            parser.error("--manifest and --out require --semantic-verdict")
        verify(args.verify)
        return
    if args.manifest or args.out:
        parser.error("--manifest and --out require --semantic-verdict")
    if not args.report:
        parser.error("report is required unless --verify is used")
    report_path = Path(args.report).resolve()
    root = report_path.parent
    report = json.loads(report_path.read_text(encoding="utf-8"))
    plan_references = [load_plan_reference(root, zone) for zone in report["Zones"]]
    raster_backed_panels = sum(reference is not None for reference in plan_references)
    if args.require_plan and raster_backed_panels != len(plan_references):
        raise SystemExit(
            f"full-plan review requires raster coverage: "
            f"{raster_backed_panels}/{len(plan_references)} zones")
    inputs = {
        path.relative_to(root).as_posix(): digest(path)
        for zone in report["Zones"] for path in zone_input_paths(root, zone)
    }
    review = root / "review"
    review.mkdir(exist_ok=True)
    panels = []
    for index, zone in enumerate(report["Zones"]):
        output = review / panel_name(index + 1, zone["Zone"])
        render_zone(root, zone, output)
        panels.append(output)

    contact_path = review / "contact-sheet.png"
    render_contact_sheet(report, panels, contact_path)
    atlas_panels, atlas_contact = render_level_atlases(root, report)
    provenance_files = []
    provenance_contact = None
    if args.provenance:
        provenance_review = root / "review-provenance"
        provenance_review.mkdir(exist_ok=True)
        provenance_panels = []
        provenance_zones = []
        for index, zone in enumerate(report["Zones"]):
            output = provenance_review / panel_name(index + 1, zone["Zone"])
            metadata = {"zone": zone["Zone"]}
            render_zone(root, zone, output, metadata=metadata, provenance=True)
            provenance_panels.append(output)
            provenance_zones.append(metadata)
        provenance_contact = provenance_review / "contact-sheet.png"
        render_contact_sheet(report, provenance_panels, provenance_contact)
        provenance_path = root / "boundary-provenance.json"
        provenance_path.write_text(json.dumps({
            "schemaVersion": 2,
            "scope": "external evaluation data; never solver input",
            "zones": provenance_zones,
        }, indent=2) + "\n", encoding="utf-8")
        provenance_files = [*provenance_panels, provenance_contact, provenance_path]
    manifest = {
        "schemaVersion": 2,
        "report": report_path.name,
        "reportSha256": digest(report_path),
        "panelCount": len(panels),
        "rasterBackedPanels": raster_backed_panels,
        "inputs": dict(sorted(inputs.items())),
        "contactSheet": contact_path.relative_to(root).as_posix(),
        "files": {
            path.relative_to(root).as_posix(): digest(path)
            for path in [*panels, contact_path, *atlas_panels, atlas_contact, *provenance_files]
        },
        "levelAtlases": [path.relative_to(root).as_posix() for path in atlas_panels],
        "atlasContactSheet": atlas_contact.relative_to(root).as_posix(),
    }
    if provenance_contact:
        manifest["provenanceContactSheet"] = provenance_contact.relative_to(root).as_posix()
    (root / "review-manifest.json").write_text(
        json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    verify(root / "review-manifest.json")
    print(contact_path)


if __name__ == "__main__":
    main()
