"""Render cropped per-zone promotion disposition panels from the offline report."""

import argparse
import hashlib
import json
import math
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont, ImageOps

import overlay


ACCEPTED = (24, 91, 122)
HELD = (219, 150, 55)
HELD_FILL = (250, 231, 197)
VOID = (145, 145, 145)
VOID_FILL = (232, 232, 232)
INK = (190, 190, 190)
# Closure rasters: obstruction the sealers invented, drawn under the room outlines so a reviewer
# can see which "walls" the drawing never drew. SEAL is the door/window closure (saturated
# orange-red, unmistakable against amber HELD_FILL and teal ACCEPTED even at thumbnail scale);
# CLOSE is the generic stud-gap morphology, muted because it rims every wall by construction.
SEAL = (222, 58, 20)
CLOSE = (206, 178, 168)
ZONE = (112, 44, 138)
TRIAGE = (183, 46, 46)
DISPOSITION_ALPHA = 64

HEADER_HEIGHT = 62


def font(size):
    try:
        return ImageFont.truetype("arial.ttf", size)
    except OSError:
        return ImageFont.load_default()


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


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


def render_zone(root, zone, output, padding_cells=12, scale=2):
    ink_path = root / zone["Ink"]
    tsv_path = root / zone["Tsv"]
    width, height, min_x, min_y, cell, bits = overlay.load_ink(ink_path)
    # Optional (schemaVersion 3+) closure rasters. They ride the detection grid, so a mismatch
    # means the artifact is inconsistent — drop them rather than draw cells at the wrong place.
    def closure_bits(key):
        relative = zone.get(key)
        if not relative:
            return None
        path = root / relative
        if not path.exists():
            return None
        seal_width, seal_height, *_, seal_bits = overlay.load_ink(path)
        return seal_bits if (seal_width, seal_height) == (width, height) else None

    seal_bits = closure_bits("Seals")
    close_bits = closure_bits("Close")
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

    image = Image.new("RGB", (x1 - x0, y1 - y0), "white")
    pixels = image.load()
    for y in range(y0, y1):
        row = y * width
        py = y1 - 1 - y
        for x in range(x0, x1):
            index = row + x
            if close_bits is not None and (close_bits[index >> 3] >> (index & 7)) & 1:
                pixels[x - x0, py] = CLOSE
            if (bits[index >> 3] >> (index & 7)) & 1:
                pixels[x - x0, py] = INK
            # Seals paint last of the three: a closure is the claim under review, so it must never
            # be hidden by the raw ink it bridges.
            if seal_bits is not None and (seal_bits[index >> 3] >> (index & 7)) & 1:
                pixels[x - x0, py] = SEAL

    rooms, polygons, residues = overlay.load_disposition_tsv(tsv_path)

    def point(value):
        return ((value[0] - min_x) / cell - x0,
                y1 - (value[1] - min_y) / cell)

    for residue in residues:
        loops = residue["loops"]
        if not loops:
            continue
        color, fill = ((HELD, HELD_FILL) if residue["reason"] == "rejected"
                       else (VOID, VOID_FILL))
        layer = Image.new("RGBA", image.size, (0, 0, 0, 0))
        layer_draw = ImageDraw.Draw(layer)
        layer_draw.polygon([point(value) for value in loops[0]],
                           fill=(*fill, DISPOSITION_ALPHA))
        for hole in loops[1:]:
            layer_draw.polygon([point(value) for value in hole], fill=(0, 0, 0, 0))
        image = Image.alpha_composite(image.convert("RGBA"), layer).convert("RGB")

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
    image.thumbnail((900, 650), Image.Resampling.LANCZOS)
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
                f"leak {zone['ClosureErrorSqft']:.3f} sf")
    panel = Image.new("RGB", (900, 700), "white")
    panel.paste(image, ((900 - image.width) // 2, 66 + (630 - image.height) // 2))
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
    if output is not None:
        panel.save(output)
    return panel


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("report")
    args = parser.parse_args()
    report_path = Path(args.report).resolve()
    root = report_path.parent
    report = json.loads(report_path.read_text(encoding="utf-8"))
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
        "schemaVersion": 1,
        "report": report_path.name,
        "reportSha256": digest(report_path),
        "contactSheet": contact_path.relative_to(root).as_posix(),
        "files": {
            path.relative_to(root).as_posix(): digest(path)
            for path in [*panels, contact_path]
        },
    }
    (root / "review-manifest.json").write_text(
        json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(contact_path)


if __name__ == "__main__":
    main()
