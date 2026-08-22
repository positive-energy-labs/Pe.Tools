"""Render cropped per-zone promotion disposition panels from the offline report."""

import argparse
import hashlib
import json
import math
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
#   DECIDED   accepted / held / void rooms — crisp outlines over pale solid fills that sit
#             UNDER the evidence, so a decision can never obscure the ink it was made on.
#   REFERENCE the zone boundary.
ACCEPTED = (24, 91, 122)
ACCEPTED_FILL = (229, 237, 241)
HELD = (219, 150, 55)
HELD_FILL = (250, 238, 217)
VOID = (145, 145, 145)
VOID_FILL = (236, 236, 236)
INK = (25, 25, 25)
SEAL_DOOR = (222, 58, 20)      # door-head (+ oversize fringe) closure; also merged-bin fallback
SEAL_RUN = (235, 130, 20)      # heuristic wall-run gap sealer (never backs a boundary)
CLOSE = (200, 165, 130)
ZONE = (112, 44, 138)
TRIAGE = (183, 46, 46)
# Closure components smaller than this carry no reviewable signal (single-cell ceiling-height
# speckle); they are hidden from the CLOSURE layers only. Evidence ink is never denoised.
SPECK_SQFT = 0.25

HEADER_HEIGHT = 62


def font(size):
    try:
        return ImageFont.truetype("arial.ttf", size)
    except OSError:
        return ImageFont.load_default()


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def artifact_path(root, relative):
    root = root.resolve()
    path = (root / relative).resolve()
    try:
        path.relative_to(root)
    except ValueError:
        raise SystemExit(f"visual input escapes artifact root: {relative}")
    return path


def zone_input_paths(root, zone):
    ink_path = artifact_path(root, zone["Ink"])
    replay_path = ink_path.parent / f"replay_{ink_path.stem.removeprefix('ink_')}.bin"
    if not replay_path.is_file():
        raise SystemExit(
            f"missing replay seed ink: {replay_path}\n"
            f"replay_<level>.bin is the only evidence source (stale ink_*.bin lane "
            f"deleted). Recapture: docs/features/takeoffs/manual-e2e-runbook.md "
            f"(Capture step writes replay_<level>.bin)")
    paths = [
        artifact_path(root, zone["Tsv"]),
        replay_path,
    ]
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


def render_zone(root, zone, output, padding_cells=12, scale=2):
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
    ink_source = "ink replay-seed"
    ink_mask = unpack_mask(bits, width, height)

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
    x0 = max(0, math.floor((zone["MinX"] - min_x) / cell) - padding_cells)
    x1 = min(width, math.ceil((zone["MaxX"] - min_x) / cell) + padding_cells)
    y0 = max(0, math.floor((zone["MinY"] - min_y) / cell) - padding_cells)
    y1 = min(height, math.ceil((zone["MaxY"] - min_y) / cell) + padding_cells)
    if x1 <= x0 or y1 <= y0:
        panel = Image.new("RGB", (900, 700), "white")
        draw = ImageDraw.Draw(panel)
        draw.text((14, 14), zone["Zone"], fill=(30, 30, 30), font=font(18))
        draw.text((250, 330), "outside captured raster", fill=(120, 120, 120), font=font(24))
        if output is not None:
            panel.save(output)
        return panel

    rooms, polygons, residues = overlay.load_disposition_tsv(tsv_path)

    def point(value):
        return ((value[0] - min_x) / cell - x0,
                y1 - (value[1] - min_y) / cell)

    # Decision fills go down FIRST so nothing they claim can hide a single evidence cell.
    image = Image.new("RGB", (x1 - x0, y1 - y0), "white")
    fill_draw = ImageDraw.Draw(image)
    for residue in residues:
        loops = residue["loops"]
        if not loops:
            continue
        fill = HELD_FILL if residue["reason"] == "rejected" else VOID_FILL
        fill_draw.polygon([point(value) for value in loops[0]], fill=fill)
        for hole in loops[1:]:
            fill_draw.polygon([point(value) for value in hole], fill="white")
    for room_id in sorted(rooms):
        for kind, loop in polygons.get(room_id, []):
            if len(loop) >= 3:
                fill_draw.polygon([point(value) for value in loop],
                                  fill=ACCEPTED_FILL if kind == "outer" else "white")

    # Raster layers over the fills: synthetic closures screened (checkerboard — never solid,
    # so they cannot read as drawn walls), then evidence ink solid black on top of everything.
    pixels = np.asarray(image).copy()          # rows top-down; grid rows bottom-up

    def paint(mask, color, screened):
        crop = mask[y0:y1, x0:x1]
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
    image = Image.fromarray(pixels)

    draw = ImageDraw.Draw(image)
    for residue in residues:
        loops = residue["loops"]
        if not loops:
            continue
        color = HELD if residue["reason"] == "rejected" else VOID
        draw.line([point(value) for value in loops[0]] + [point(loops[0][0])],
                  fill=color, width=2)
        for hole in loops[1:]:
            draw.line([point(value) for value in hole] + [point(hole[0])],
                      fill=color, width=1)
    for room_id in sorted(rooms):
        for kind, loop in polygons.get(room_id, []):
            if len(loop) >= 2:
                draw.line([point(value) for value in loop] + [point(loop[0])],
                          fill=ACCEPTED, width=3 if kind == "outer" else 2)
    # Scope is a first-class review datum, not an inferred crop. Draw every outer/hole loop last
    # so a reviewer can see exactly what the accepted, held, and excluded areas must partition.
    for loop in zone["ZoneLoops"]:
        if len(loop) >= 2:
            draw.line([point(value) for value in loop] + [point(loop[0])],
                      fill=ZONE, width=3)

    if scale != 1:
        image = image.resize((image.width * scale, image.height * scale), Image.Resampling.NEAREST)
    image.thumbnail((900, 588), Image.Resampling.LANCZOS)
    verdict, reason = triage_of(zone)
    # A held zone still shows its raster and zone loops: triage is a routing verdict a reviewer
    # must be able to argue with, not a reason to hide the evidence.
    banner = f"TRIAGE-HELD {reason}".strip() + "   " if verdict == "hold" else ""
    title = (f"{zone['Zone']}   zone {zone['ZoneSqft']:.0f} sf   raw {zone['RawRooms']}   "
             f"network-strict {zone.get('SharedNetworkStrictRooms', 0)}   "
             f"accepted {zone['AcceptedRooms']}   held {zone['HeldRooms']}   "
             f"excluded {zone['ExcludedSqft']:.0f} sf")
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
                + f"shared {zone['SharedEdgePairs']}/{zone['LostSharedEdgePairs']} lost   "
                f"leak {zone['ClosureErrorSqft']:.3f} sf   {ink_source}")
    panel = Image.new("RGB", (900, 700), "white")
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
    draw_legend(panel_draw)
    if output is not None:
        panel.save(output)
    return panel


LEGEND_ROWS = (
    ((INK, "solid", "received ink"),
     (SEAL_DOOR, "screen", "added: door-head seal"),
     (SEAL_RUN, "screen", "added: wall-run seal"),
     (CLOSE, "screen", "added: gap-close")),
    ((ACCEPTED, "outline", "accepted"),
     (HELD, "outline", "held"),
     (VOID, "outline", "void"),
     (ZONE, "outline", "zone")),
)


def draw_legend(panel_draw):
    """The in-image key every panel carries: received / added / decided / reference."""
    legend_font = font(14)

    def swatch(x, y, color, style):
        if style == "outline":
            panel_draw.rectangle((x, y + 3, x + 13, y + 16), outline=color, width=2)
        elif style == "screen":
            for sy in range(14):
                for sx in range(14):
                    if (sx + sy) % 2 == 0:
                        panel_draw.point((x + sx, y + 3 + sy), fill=color)
        else:
            panel_draw.rectangle((x, y + 3, x + 13, y + 16), fill=color)
        return x + 18

    for row_index, row in enumerate(LEGEND_ROWS):
        x, y = 14, 656 + row_index * 21
        for color, style, label in row:
            x = swatch(x, y, color, style)
            panel_draw.text((x, y), label, fill=(60, 60, 60), font=legend_font)
            x += panel_draw.textlength(label, font=legend_font) + 14
        if row_index == 0:
            panel_draw.text((x, y), f"(closure specks <{SPECK_SQFT} sf hidden)",
                            fill=(140, 140, 140), font=legend_font)


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
    actual_outputs = {
        path.relative_to(root).as_posix()
        for path in (root / "review").glob("*.png")
    }
    for relative in sorted(actual_outputs - expected_outputs):
        failures.append(f"{relative}: unexpected output")
    if failures:
        raise SystemExit("review verification failed:\n" + "\n".join(failures))
    print(f"verified {manifest['panelCount']} panels and {len(manifest['inputs'])} inputs: {root}")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("report", nargs="?")
    parser.add_argument("--verify", metavar="MANIFEST")
    args = parser.parse_args()
    if args.verify:
        verify(args.verify)
        return
    if not args.report:
        parser.error("report is required unless --verify is used")
    report_path = Path(args.report).resolve()
    root = report_path.parent
    report = json.loads(report_path.read_text(encoding="utf-8"))
    inputs = {
        path.relative_to(root).as_posix(): digest(path)
        for zone in report["Zones"] for path in zone_input_paths(root, zone)
    }
    review = root / "review"
    review.mkdir(exist_ok=True)
    panels = []
    for index, zone in enumerate(report["Zones"]):
        output = review / f"{index + 1:02d}_{zone['Zone'].replace(' ', '_').replace('#', '_')}.png"
        render_zone(root, zone, output)
        panels.append(output)

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
    contact_path = review / "contact-sheet.png"
    contact.save(contact_path)
    manifest = {
        "schemaVersion": 2,
        "report": report_path.name,
        "reportSha256": digest(report_path),
        "panelCount": len(panels),
        "inputs": dict(sorted(inputs.items())),
        "contactSheet": contact_path.relative_to(root).as_posix(),
        "files": {
            path.relative_to(root).as_posix(): digest(path)
            for path in [*panels, contact_path]
        },
    }
    (root / "review-manifest.json").write_text(
        json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    verify(root / "review-manifest.json")
    print(contact_path)


if __name__ == "__main__":
    main()
