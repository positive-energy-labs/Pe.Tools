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


def font(size):
    try:
        return ImageFont.truetype("arial.ttf", size)
    except OSError:
        return ImageFont.load_default()


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def render_zone(root, zone, output, padding_cells=12, scale=2):
    ink_path = root / zone["Ink"]
    tsv_path = root / zone["Tsv"]
    width, height, min_x, min_y, cell, bits = overlay.load_ink(ink_path)
    x0 = max(0, math.floor((zone["MinX"] - min_x) / cell) - padding_cells)
    x1 = min(width, math.ceil((zone["MaxX"] - min_x) / cell) + padding_cells)
    y0 = max(0, math.floor((zone["MinY"] - min_y) / cell) - padding_cells)
    y1 = min(height, math.ceil((zone["MaxY"] - min_y) / cell) + padding_cells)
    if x1 <= x0 or y1 <= y0:
        panel = Image.new("RGB", (900, 700), "white")
        draw = ImageDraw.Draw(panel)
        draw.text((14, 14), zone["Zone"], fill=(30, 30, 30), font=font(18))
        draw.text((250, 330), "outside captured raster", fill=(120, 120, 120), font=font(24))
        panel.save(output)
        return

    image = Image.new("RGB", (x1 - x0, y1 - y0), "white")
    pixels = image.load()
    for y in range(y0, y1):
        row = y * width
        py = y1 - 1 - y
        for x in range(x0, x1):
            if (bits[(row + x) >> 3] >> ((row + x) & 7)) & 1:
                pixels[x - x0, py] = INK

    rooms, polygons, residues = overlay.load_disposition_tsv(tsv_path)
    draw = ImageDraw.Draw(image)

    def point(value):
        return ((value[0] - min_x) / cell - x0,
                y1 - (value[1] - min_y) / cell)

    for residue in residues:
        loops = residue["loops"]
        if not loops:
            continue
        color, fill = ((HELD, HELD_FILL) if residue["reason"] == "rejected"
                       else (VOID, VOID_FILL))
        draw.polygon([point(value) for value in loops[0]], fill=fill, outline=color, width=2)
        for hole in loops[1:]:
            draw.polygon([point(value) for value in hole], fill="white", outline=color, width=1)
    for room_id in sorted(rooms):
        for kind, loop in polygons.get(room_id, []):
            if len(loop) >= 2:
                draw.line([point(value) for value in loop] + [point(loop[0])],
                          fill=ACCEPTED, width=3 if kind == "outer" else 2)

    if scale != 1:
        image = image.resize((image.width * scale, image.height * scale), Image.Resampling.NEAREST)
    image.thumbnail((900, 650), Image.Resampling.LANCZOS)
    title = (f"{zone['Zone']}   raw {zone['RawRooms']}   accepted {zone['AcceptedRooms']}   "
             f"held {zone['HeldRooms']}   ink {zone['InkBackedEdgeFraction']:.0%}   "
             f"closure {zone['ClosureErrorSqft']:.3f} sf")
    panel = Image.new("RGB", (900, 700), "white")
    panel.paste(image, ((900 - image.width) // 2, 48 + (650 - image.height) // 2))
    ImageDraw.Draw(panel).text((14, 14), title, fill=(30, 30, 30), font=font(18))
    panel.save(output)


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
    contact = Image.new("RGB", (columns * thumb_size[0], rows * thumb_size[1]), "white")
    for index, path in enumerate(panels):
        with Image.open(path) as image:
            thumb = ImageOps.contain(image.convert("RGB"), thumb_size, Image.Resampling.LANCZOS)
        contact.paste(thumb, ((index % columns) * thumb_size[0],
                              (index // columns) * thumb_size[1]))
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
