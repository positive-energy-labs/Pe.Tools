"""Render law-bound verdict and forensic views from an offline takeoff report."""

# COUPLING: source/pe-tools/apps/web/src/runs/visual-law.json is the single visual-law
# declaration shared with the /runs TypeScript renderer. Do not restate its values here.

import argparse
import colorsys
import hashlib
import json
import math
import re
from pathlib import Path

import numpy as np
from PIL import Image, ImageChops, ImageDraw, ImageFont, ImageOps

import overlay


LAW_PATH = (Path(__file__).resolve().parents[2]
            / "source/pe-tools/apps/web/src/runs/visual-law.json")


def load_visual_law(path=LAW_PATH):
    return json.loads(Path(path).read_text(encoding="utf-8"))


LAW = load_visual_law()


def rgb(value):
    return tuple(value[:3])


def rgba(value):
    return tuple(value)


PLAN_LAW = LAW["substrate"]["plan"]
INK = rgba(LAW["substrate"]["ink"]["rgba"])
SEAL_DOOR = rgba(LAW["invented"]["sealDoor"])
SEAL_RUN = rgba(LAW["invented"]["sealRun"])
CLOSE = rgba(LAW["invented"]["close"])
VOID = rgba(LAW["voidWash"]["rgba"])
EXCLUDED = rgba(LAW["excludedWash"]["rgba"])
ZONE = rgba(LAW["zone"]["stroke"]["rgba"])
ZONE_WIDTH = LAW["zone"]["stroke"]["widthPx"]
ZONE_DASH = tuple(LAW["zone"]["stroke"]["dash"])
CANDIDATE_ALPHA = LAW["candidate"]["fill"]["alpha"]
LABEL_COLOR = rgba(LAW["label"]["rgba"])
LABEL_SIZE = LAW["label"]["sizePx"]

# The forensic panel answers four questions, and every color belongs to exactly one of them:
#   RECEIVED  what the solver partitioned on as captured evidence — replay seed ink, solid
#             near-black, never denoised, never painted over. If the input is noisy (attic
#             framing lattice), showing that noise is the point.
#   ADDED     obstruction the sealers invented — translucent warm tints. When the INKC sidecar
#             (classes_<token>.bin, derived from the zone's Seals path) is present the seal
#             layer splits honestly: SEAL_DOOR is door-head (+ oversize fringe) closure,
#             SEAL_RUN is the heuristic wall-run gap sealer. Older artifacts fall back to
#             the merged seals_*.bin drawn as one SEAL_DOOR-colored layer. CLOSE is the
#             stud-gap morphological close, muted because it rims every wall by construction.
#   DECIDED   accepted / held / void / excluded areas — crisp outlines over pale solid fills
#             UNDER the evidence, so a decision can never obscure the ink it was made on.
#   REFERENCE the zone boundary.
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
VERDICT_CONTACT_HEADER_HEIGHT = 56


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
    return np.asarray(polygon_mask_image(size, loops, point), dtype=bool)


def polygon_mask_image(size, loops, point):
    """Rasterize even-odd loops without expanding a plan-native NumPy frame."""
    inside = Image.new("1", size)
    for loop in loops:
        if len(loop) < 3:
            continue
        current = Image.new("1", size)
        ImageDraw.Draw(current).polygon([point(value) for value in loop], fill=1)
        inside = ImageChops.logical_xor(inside, current)
    return inside.convert("L")


def cropped_polygon_mask(size, loops, point):
    points = [point(value) for loop in loops for value in loop]
    if not points:
        return Image.new("L", (1, 1)), (0, 0)
    left = max(0, math.floor(min(value[0] for value in points)))
    top = max(0, math.floor(min(value[1] for value in points)))
    right = min(size[0], math.ceil(max(value[0] for value in points)) + 1)
    bottom = min(size[1], math.ceil(max(value[1] for value in points)) + 1)
    if right <= left or bottom <= top:
        return Image.new("L", (1, 1)), (0, 0)
    return (polygon_mask_image((right - left, bottom - top), loops,
                               lambda value: (point(value)[0] - left,
                                              point(value)[1] - top)),
            (left, top))


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


def stretch_plan(image):
    black, white = PLAN_LAW["blackPoint"], PLAN_LAW["whitePoint"]
    if white <= black:
        raise SystemExit("visual law plan whitePoint must exceed blackPoint")
    lut = [0 if value <= black else 255 if value >= white
           else round((value - black) * 255 / (white - black))
           for value in range(256)]
    return image.point(lut * len(image.getbands()))


def plan_point(reference, value):
    manifest = reference["manifest"]
    top_left = np.asarray(manifest["topLeft"], dtype=float)
    basis = np.column_stack((np.asarray(manifest["topRight"], dtype=float) - top_left,
                             np.asarray(manifest["bottomLeft"], dtype=float) - top_left))
    if abs(np.linalg.det(basis)) < 1e-9:
        raise SystemExit(f"degenerate plan reference registration: {reference['manifestPath']}")
    uv = np.linalg.solve(basis, np.asarray(value, dtype=float) - top_left)
    return (float(uv[0] * reference["image"].width),
            float(uv[1] * reference["image"].height))


def composite_mask(image, mask, color, box=(0, 0)):
    color = rgba(color)
    opacity = mask if color[3] == 255 else mask.point(
        lambda value: round(value * color[3] / 255))
    image.paste((*color[:3], 255), box, opacity)


def darkened(color):
    return tuple(round(channel * 0.58) for channel in color[:3]) + (255,)


def draw_hatch(image, mask, color, hatch, box=(0, 0)):
    spacing = hatch["spacingPx"]
    lines = Image.new("RGBA", mask.size)
    draw = ImageDraw.Draw(lines)
    # The law currently declares 45 degrees. The formula supports either diagonal direction.
    slope = -1 if hatch["angleDeg"] % 180 == 45 else 1
    for offset in range(-mask.height, mask.width + mask.height, spacing):
        draw.line((offset, 0, offset + slope * mask.height, mask.height),
                  fill=color, width=hatch["widthPx"])
    image.paste(lines, box, ImageChops.multiply(mask, lines.getchannel("A")))


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
    return stretch_plan(reference["image"]).transform(
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
    grid_size = (x1 - x0, y1 - y0)
    if plan_reference is not None:
        plan_tl = plan_point(plan_reference, (world_crop[0], world_crop[3]))
        plan_tr = plan_point(plan_reference, (world_crop[2], world_crop[3]))
        plan_bl = plan_point(plan_reference, (world_crop[0], world_crop[1]))
        render_size = (max(1, round(math.dist(plan_tl, plan_tr))),
                       max(1, round(math.dist(plan_tl, plan_bl))))
    else:
        render_size = grid_size
    render_scale = (render_size[0] / grid_size[0], render_size[1] / grid_size[1])
    if metadata is not None:
        metadata.update({
            "requestedBounds": [float(value) for value in bounds],
            "gridCrop": {"x0": x0, "y0": y0, "x1": x1, "y1": y1},
            "worldCrop": list(world_crop),
            "sourceGrid": {"width": width, "height": height, "minX": min_x,
                           "minY": min_y, "cell": cell},
            "paddingCells": padding_cells,
            "scale": scale,
            "layers": LAW["renders"]["forensic"]["layers"],
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
        return (((value[0] - min_x) / cell - x0) * render_scale[0],
                (y1 - (value[1] - min_y) / cell) * render_scale[1])

    # Layer order comes from LAW.renders.forensic.layers.
    base_plan = (crop_plan_reference(plan_reference, world_crop, render_size)
                 if plan_reference is not None
                 else Image.new("RGB", render_size, "white"))
    inside_zone = polygon_mask(base_plan.size, zone["ZoneLoops"], point)
    image = Image.new("RGBA", base_plan.size)

    def paint(mask, color):
        if mask is not None:
            crop = crop_grid_mask(mask, x0, y0, x1, y1)[::-1]
            layer_mask = Image.fromarray(crop.astype(np.uint8) * 255)
            if layer_mask.size != image.size:
                layer_mask = layer_mask.resize(image.size, Image.Resampling.NEAREST)
            composite_mask(image, layer_mask, color)

    candidate_rows, wash_rows = [], []
    for residue in ([] if bare_zone else residues):
        if not residue["loops"]:
            continue
        if residue["reason"] == "excluded":
            wash_rows.append(("excluded", residue["loops"]))
        elif residue["reason"] != "rejected":
            wash_rows.append(("void", residue["loops"]))
        else:
            candidate_rows.append(("held", residue["id"], residue["loops"]))
    for room_id in ([] if bare_zone else sorted(rooms)):
        candidate_rows.append(("accepted", room_id,
                               [loop for _kind, loop in polygons.get(room_id, [])]))
    for candidate in ([] if bare_zone else review_held):
        candidate_rows.append(("reviewHeld", field(candidate, "id"),
                               field(candidate, "polygons", default=[]) or []))
    keys = [_atlas_candidate_key(zone, candidate_id)
            for _status, candidate_id, _loops in candidate_rows]
    colors = _adjacent_colors([
        {"zone": zone, "id": candidate_id, "loops": loops}
        for _status, candidate_id, loops in candidate_rows
    ], cell / min(render_scale))
    candidate_masks = {}
    for key, (status, candidate_id, loops) in zip(keys, candidate_rows):
        candidate_masks[key] = cropped_polygon_mask(image.size, loops, point)

    def plan_layer():
        nonlocal image
        pixels = np.asarray(base_plan).copy()
        for selected, opacity in ((inside_zone, PLAN_LAW["insideZoneOpacity"]),
                                  (~inside_zone, PLAN_LAW["outsideZoneOpacity"])):
            pixels[selected] = np.rint(
                pixels[selected] * opacity + 255 * (1 - opacity)).astype(np.uint8)
        image = Image.fromarray(pixels).convert("RGBA")

    def wash_layer(kind, color):
        for wash_kind, loops in wash_rows:
            if wash_kind == kind:
                mask, box = cropped_polygon_mask(image.size, loops, point)
                composite_mask(image, mask, color, box)

    def candidate_fill_layer():
        for key in keys:
            mask, box = candidate_masks[key]
            composite_mask(image, mask,
                           (*colors[key], round(CANDIDATE_ALPHA * 255)), box)

    def candidate_outline_layer():
        outline = LAW["candidate"]["outline"]["forensic"]
        for key, (status, _candidate_id, loops) in zip(keys, candidate_rows):
            color = darkened(colors[key])
            if status in ("held", "reviewHeld"):
                mask, box = candidate_masks[key]
                draw_hatch(image, mask, color,
                           LAW["candidate"]["status"][status]["hatch"], box)
            draw = ImageDraw.Draw(image)
            for loop in loops:
                if len(loop) >= 2:
                    draw.line([point(value) for value in loop] + [point(loop[0])],
                              fill=color, width=outline["widthPx"])

    def zone_layer():
        draw = ImageDraw.Draw(image)
        for loop in zone["ZoneLoops"]:
            if len(loop) >= 2:
                _draw_dashed(draw, [point(value) for value in loop], ZONE,
                             ZONE_WIDTH, ZONE_DASH)

    def label_layer():
        draw = ImageDraw.Draw(image)
        for _key, (status, candidate_id, loops) in zip(keys, candidate_rows):
            if loops and loops[0]:
                xs, ys = zip(*loops[0])
                label = ((min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2)
                _atlas_label(draw, point(label), _short_atlas_label(status, candidate_id),
                             font(LABEL_SIZE))

    layers = {
        "plan": plan_layer,
        "close": lambda: paint(close_mask, CLOSE),
        "sealRun": lambda: paint(run_mask, SEAL_RUN),
        "sealDoor": lambda: paint(door_mask, SEAL_DOOR),
        "ink": lambda: paint(ink_mask, INK),
        "voidWash": lambda: wash_layer("void", VOID),
        "excludedWash": lambda: wash_layer("excluded", EXCLUDED),
        "candidateFill": candidate_fill_layer,
        "candidateOutline": candidate_outline_layer,
        "zoneOutline": zone_layer,
        "label": label_layer,
    }
    for layer in LAW["renders"]["forensic"]["layers"]:
        try:
            layers[layer]()
        except KeyError:
            raise SystemExit(f"unsupported forensic visual-law layer: {layer}")

    if provenance:
        draw = ImageDraw.Draw(image)
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

    forensic_image = image.convert("RGB")
    if output is not None and plan_reference is not None and not provenance:
        forensic_image.save(output)
    image = forensic_image
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
    if output is not None and (plan_reference is None or provenance):
        panel.save(output)
    return panel


def _legend_swatch(draw, x, y, color, style, fill=None):
    if style == "hatch":
        draw.rectangle((x, y + 2, x + 14, y + 16), fill=fill)
        draw.line((x, y + 16, x + 14, y + 2), fill=color)
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
    (INK, "solid", "received", None),
    (SEAL_DOOR, "solid", "door-head tint", None),
    (SEAL_RUN, "solid", "wall-run tint", None),
    (CLOSE, "solid", "gap-close tint", None),
)
DECISION_LEGEND = (
    ((30, 80, 130), "decision", "candidate", (80, 170, 240)),
    ((30, 80, 130), "hatch", "held", (80, 170, 240)),
    (EXCLUDED, "solid", "excluded wash", None),
    (VOID, "solid", "void wash", None),
)


def draw_legend(panel_draw):
    """The in-image key every panel carries: received / added / decided / reference."""
    _legend_items(panel_draw, LEGEND_Y, "PIXELS", PIXEL_LEGEND)
    _legend_items(panel_draw, LEGEND_Y + 20, "FILL + OUTLINE", DECISION_LEGEND)
    _legend_items(panel_draw, LEGEND_Y + 40, "ZONE", (
        (ZONE, "line", "authority hairline; outside plan faded", None),
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
        (ZONE, "line", "authority hairline; outside plan faded", None),
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
    """Stable hue keyed independently of disposition, neighbors, and report order."""
    value = hashlib.sha256(key.encode("utf-8")).digest()
    hue = int.from_bytes(value[:8], "big") / (1 << 64)
    variants = ((0.84, 0.94), (1.00, 0.62), (0.72, 0.78), (0.92, 0.72),
                (0.76, 0.98), (1.00, 0.82), (0.68, 0.66), (0.88, 0.56))
    saturation, brightness = variants[salt % len(variants)]
    rgb = colorsys.hsv_to_rgb(hue, saturation, brightness)
    return tuple(round(component * 255) for component in rgb)


def _atlas_candidate_key(zone, candidate_id):
    return f"{field(zone, 'zoneKey') or zone['Zone']}\0{candidate_id}"


def _atlas_colors(keys):
    colors, used = {}, set()
    for key in sorted(keys):
        choices = [_atlas_color(key, salt) for salt in range(8)]
        color = next((choice for choice in choices if choice not in used), choices[0])
        colors[key] = color
        used.add(color)
    return colors


def _adjacent_colors(candidates, pixel_feet):
    rows = []
    for candidate in candidates:
        points = [point for loop in candidate["loops"] for point in loop]
        bounds = None if not points else (
            min(point[0] for point in points), min(point[1] for point in points),
            max(point[0] for point in points), max(point[1] for point in points))
        rows.append((_atlas_candidate_key(candidate["zone"], candidate["id"]), bounds))
    colors = {}
    # ponytail: conservative O(n^2) bounding-box adjacency is exact enough for tens of rooms;
    # use a spatial index only when a level reaches hundreds of candidates.
    for index, (key, bounds) in enumerate(rows):
        adjacent = []
        for other_key, other in rows[:index]:
            if other_key not in colors or bounds is None or other is None:
                continue
            dx = max(other[0] - bounds[2], bounds[0] - other[2], 0)
            dy = max(other[1] - bounds[3], bounds[1] - other[3], 0)
            if math.hypot(dx, dy) <= pixel_feet * 1.5:
                adjacent.append(colors[other_key])
        choices = [_atlas_color(key, salt) for salt in range(8)]
        color = next((choice for choice in choices
                      if all(math.dist(choice, other) >= 80 for other in adjacent)),
                     max(choices, key=lambda choice: min(
                         (math.dist(choice, other) for other in adjacent), default=math.inf)))
        colors[key] = color
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
    draw.text(point, text, fill=LABEL_COLOR, font=text_font, anchor="mm")


def _short_atlas_label(status, candidate_id):
    match = re.search(r"R(\d+)", candidate_id)
    suffix = f"{int(match.group(1)):02d}" if match else ""
    return {"accepted": "A", "held": "H", "review-held": "C",
            "reviewHeld": "C"}[status] + suffix


def _verdict_items(root, zones):
    candidates, washes = [], []
    for zone in zones:
        rooms, polygons, residues = overlay.load_disposition_tsv(
            artifact_path(root, zone["Tsv"]))
        verdict, reason = triage_of(zone)
        bare = verdict == "hold" and reason in ("no-raster", "no-evidence",
                                                   "no-replay-evidence")
        for room_id in ([] if bare else sorted(rooms)):
            candidates.append({"status": "accepted", "zone": zone, "id": room_id,
                               "loops": [loop for _kind, loop in polygons.get(room_id, [])],
                               "label": (rooms[room_id]["lx"], rooms[room_id]["ly"])})
        for residue in ([] if bare else residues):
            if not residue["loops"]:
                continue
            if residue["reason"] == "rejected":
                xs, ys = zip(*residue["loops"][0])
                candidates.append({"status": "held", "zone": zone, "id": residue["id"],
                                   "loops": residue["loops"],
                                   "label": ((min(xs) + max(xs)) / 2,
                                             (min(ys) + max(ys)) / 2)})
            else:
                washes.append(("excluded" if residue["reason"] == "excluded" else "void",
                               residue["loops"]))
        domain_reflood = field(zone, "domainReflood", default={}) or {}
        for candidate in ([] if bare else field(
                domain_reflood, "heldCandidates", default=[]) or []):
            loops = field(candidate, "polygons", default=[]) or []
            if loops:
                xs, ys = zip(*loops[0])
                candidates.append({"status": "reviewHeld", "zone": zone,
                                   "id": field(candidate, "id"), "loops": loops,
                                   "label": ((min(xs) + max(xs)) / 2,
                                             (min(ys) + max(ys)) / 2)})
    return candidates, washes


def render_level_verdict(root, level, zones, output=None, law=None):
    law = law or LAW
    references = [load_plan_reference(root, zone) for zone in zones]
    if not all(references):
        raise SystemExit(f"verdict render requires a registered plan for level {level}")
    if len({reference["imagePath"] for reference in references}) != 1:
        raise SystemExit(f"level {level} has multiple plan references")
    reference = references[0]
    point = lambda value: plan_point(reference, value)
    base_plan = stretch_plan(reference["image"])
    inside_image = Image.new("1", base_plan.size)
    for zone in zones:
        inside_image = ImageChops.logical_or(
            inside_image, polygon_mask_image(base_plan.size, zone["ZoneLoops"], point).convert("1"))
    inside = np.asarray(inside_image, dtype=bool)
    candidates, washes = _verdict_items(root, zones)
    keys = [_atlas_candidate_key(candidate["zone"], candidate["id"])
            for candidate in candidates]
    if len(keys) != len(set(keys)):
        raise SystemExit(f"level {level} has duplicate candidate identity")
    manifest = reference["manifest"]
    pixel_feet = max(
        math.dist(manifest["topLeft"], manifest["topRight"]) / reference["image"].width,
        math.dist(manifest["topLeft"], manifest["bottomLeft"]) / reference["image"].height)
    colors = _adjacent_colors(candidates, pixel_feet)
    image = Image.new("RGBA", base_plan.size)

    def candidate_mask(candidate):
        return cropped_polygon_mask(base_plan.size, candidate["loops"], point)

    def plan_layer():
        nonlocal image
        pixels = np.asarray(base_plan).copy()
        for selected, opacity in (
                (inside, law["substrate"]["plan"]["insideZoneOpacity"]),
                (~inside, law["substrate"]["plan"]["outsideZoneOpacity"])):
            pixels[selected] = np.rint(pixels[selected] * opacity
                                        + 255 * (1 - opacity)).astype(np.uint8)
        image = Image.fromarray(pixels).convert("RGBA")

    def wash_layer(kind):
        for wash_kind, loops in washes:
            if wash_kind == kind:
                mask, box = cropped_polygon_mask(image.size, loops, point)
                composite_mask(image, mask, law[f"{kind}Wash"]["rgba"], box)

    def candidate_fill_layer():
        for key, candidate in zip(keys, candidates):
            mask, box = candidate_mask(candidate)
            composite_mask(image, mask,
                           (*colors[key], round(law["candidate"]["fill"]["alpha"] * 255)),
                           box)

    def candidate_hatch_layer():
        for key, candidate in zip(keys, candidates):
            hatch = law["candidate"]["status"][candidate["status"]]["hatch"]
            if hatch:
                mask, box = candidate_mask(candidate)
                draw_hatch(image, mask, darkened(colors[key]), hatch, box)

    def zone_layer():
        draw = ImageDraw.Draw(image)
        stroke = law["zone"]["stroke"]
        for zone in zones:
            for loop in zone["ZoneLoops"]:
                if len(loop) >= 2:
                    _draw_dashed(draw, [point(value) for value in loop],
                                 tuple(stroke["rgba"]), stroke["widthPx"],
                                 tuple(stroke["dash"]))

    def label_layer():
        draw, label_font = ImageDraw.Draw(image), font(law["label"]["sizePx"])
        for candidate in candidates:
            draw.text(point(candidate["label"]),
                      _short_atlas_label(candidate["status"], candidate["id"]),
                      fill=tuple(law["label"]["rgba"]), font=label_font, anchor="mm")

    layers = {
        "plan": plan_layer,
        "voidWash": lambda: wash_layer("void"),
        "excludedWash": lambda: wash_layer("excluded"),
        "candidateFill": candidate_fill_layer,
        "candidateHatch": candidate_hatch_layer,
        "zoneOutline": zone_layer,
        "label": label_layer,
    }
    for layer in law["renders"]["verdict"]["layers"]:
        try:
            layers[layer]()
        except KeyError:
            raise SystemExit(f"unsupported verdict visual-law layer: {layer}")
    image = image.convert("RGB")
    if output:
        image.save(output)
    return image


def render_level_verdicts(root, report):
    levels = {}
    for zone in report["Zones"]:
        levels.setdefault(zone["Level"], []).append(zone)
    output_dir = root / "review-verdict"
    output_dir.mkdir(exist_ok=True)
    outputs = []
    for index, (level, zones) in enumerate(levels.items(), start=1):
        output = output_dir / panel_name(index, level)
        render_level_verdict(root, level, zones, output)
        outputs.append(output)
    contact = output_dir / "contact-sheet.png"
    columns, thumb_size = 2, (1000, 750)
    sheet_header = VERDICT_CONTACT_HEADER_HEIGHT
    sheet = Image.new("RGB", (columns * thumb_size[0],
                              sheet_header + math.ceil(len(outputs) / columns) * thumb_size[1]),
                      "white")
    sheet_draw = ImageDraw.Draw(sheet)
    sheet_draw.text((16, 14), "Verdict renders by level", fill=rgb(LABEL_COLOR), font=font(22))
    for index, path in enumerate(outputs):
        with Image.open(path) as image:
            thumb = ImageOps.contain(image.convert("RGB"), thumb_size,
                                     Image.Resampling.LANCZOS)
        sheet.paste(thumb, ((index % columns) * thumb_size[0],
                            sheet_header + (index // columns) * thumb_size[1]))
    sheet.save(contact)
    return outputs, contact


def render_verdict_pair(report_a_path, report_b_path, level, output,
                        label_a="A", label_b="B"):
    paths = [Path(report_a_path).resolve(), Path(report_b_path).resolve()]
    reports = [json.loads(path.read_text(encoding="utf-8")) for path in paths]
    images = []
    for path, report in zip(paths, reports):
        zones = [zone for zone in report["Zones"] if zone["Level"] == level]
        if not zones:
            raise SystemExit(f"level {level!r} not found in {path}")
        images.append(render_level_verdict(path.parent, level, zones))
    if images[0].size != images[1].size:
        raise SystemExit(f"non-comparable verdict plan size for {level}: "
                         f"{images[0].size} vs {images[1].size}")
    header = max(36, LABEL_SIZE + 16)
    pair = Image.new("RGB", (images[0].width * 2, images[0].height + header), "white")
    pair.paste(images[0], (0, header))
    pair.paste(images[1], (images[0].width, header))
    draw = ImageDraw.Draw(pair)
    draw.text((12, 8), label_a, fill=rgb(LABEL_COLOR), font=font(LABEL_SIZE + 4))
    draw.text((images[0].width + 12, 8), label_b,
              fill=rgb(LABEL_COLOR), font=font(LABEL_SIZE + 4))
    output = Path(output).resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    pair.save(output)
    return output


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
    if manifest.get("verdictContactSheet"):
        output_dirs.append(root / "review-verdict")
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
    parser.add_argument("--verdict-pair", nargs=2, metavar=("REPORT_A", "REPORT_B"))
    parser.add_argument("--level")
    parser.add_argument("--label-a", default="A")
    parser.add_argument("--label-b", default="B")
    parser.add_argument("--provenance", action="store_true")
    parser.add_argument("--require-plan", action="store_true",
                        help="fail unless every panel has a registered real-plan raster")
    args = parser.parse_args()
    if args.verdict_pair:
        if not args.level or not args.out:
            parser.error("--verdict-pair requires --level and --out")
        render_verdict_pair(*args.verdict_pair, args.level, args.out,
                            args.label_a, args.label_b)
        print(Path(args.out).resolve())
        return
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
    verdict_panels, verdict_contact = (render_level_verdicts(root, report)
                                       if raster_backed_panels == len(plan_references)
                                       else ([], None))
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
            for path in [*panels, contact_path, *verdict_panels,
                         *([verdict_contact] if verdict_contact else []), *provenance_files]
        },
        "verdictRenders": [path.relative_to(root).as_posix() for path in verdict_panels],
    }
    if verdict_contact:
        manifest["verdictContactSheet"] = verdict_contact.relative_to(root).as_posix()
    if provenance_contact:
        manifest["provenanceContactSheet"] = provenance_contact.relative_to(root).as_posix()
    (root / "review-manifest.json").write_text(
        json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    verify(root / "review-manifest.json")
    print(contact_path)


if __name__ == "__main__":
    main()
