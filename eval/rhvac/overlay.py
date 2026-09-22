# Render a curation overlay: the takeoff's replay seed ink (wall evidence) + candidate room
# polygons + labels, all in model feet so registration is exact by construction. This is the
# visual-evidence surface for room-map curation and detection debugging.
#
#   python eval/rhvac/overlay.py Level_1_Main_Level                    # fixture TSV + captured replay ink
#   python eval/rhvac/overlay.py Level_1_Main_Level --live             # live Documents TSV + replay ink
#   python eval/rhvac/overlay.py Level_1_Main_Level --out out.png --thumb 2000
#
# Evidence comes from replay_<slug>.bin ONLY (the DetectSnapshot the solver partitioned on).
# The stale ink_*.bin lane was deleted 2026-08-17 — those bins drifted from the replay seed
# (Attic was missing 51% of seed cells). Replay bins live next to the TSVs
# (Documents\Pe.Tools\takeoff); the eval fixture commits TSVs only, so --live is the norm right
# after a detection run, and fixture mode needs a dir whose run produced the committed TSVs
# (pass --ink-dir). Missing replay = hard error; recapture per
# docs/features/takeoffs/manual-e2e-runbook.md (Capture step writes replay_<level>.bin).
import argparse, os, struct
from PIL import Image, ImageDraw, ImageFont
from shapely.geometry import GeometryCollection, MultiPolygon, Polygon
from shapely.validation import make_valid
from shapely.ops import unary_union

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
LIVE = next((d for d in [
    os.path.expanduser(r"~\OneDrive\Documents\Pe.Tools\takeoff"),
    os.path.expanduser(r"~\Documents\Pe.Tools\takeoff"),
] if os.path.isdir(d)), None)

PALETTE = [(230,60,60),(60,120,230),(40,160,90),(220,140,30),(160,70,200),(200,60,150),
           (30,170,170),(120,120,40),(240,90,110),(90,90,240),(80,190,60),(250,110,40)]

BLIND_COLOR = (24, 91, 122)
DIAGNOSTIC_COLOR = (45, 45, 45)
PROBLEM_COLOR = (205, 45, 45)
DISPOSITION_ACCEPTED = (24, 91, 122)
DISPOSITION_REJECTED = (219, 150, 55)
DISPOSITION_CRUMB = (150, 150, 150)
DISPOSITION_EXCLUDED = (220, 220, 220)
DISPOSITION_OVERLAP = (205, 45, 45)


def load_ink(path):
    with open(path, "rb") as f:
        magic, w, h = struct.unpack("<Iii", f.read(12))
        if magic != 0x504B4E49:
            raise ValueError(f"{path}: not an INKP raster")
        minx, miny, cell = struct.unpack("<ddd", f.read(24))
        bits = f.read((w * h + 7) // 8)
    return w, h, minx, miny, cell, bits


def load_classes(path):
    """Per-cell seal-class raster (INKC): INKP's header, but a raw byte-per-cell payload.
    Classes (Detector.Seal* in Pe.Revit.Takeoff/Detector.cs): 0 none, 1 gap-close,
    2 door-head, 3 wall-run, 4 door-head-oversize. Written as classes_<token>.bin next to
    the merged seals_<token>.bin, which cannot attribute door vs run per cell."""
    with open(path, "rb") as f:
        magic, w, h = struct.unpack("<Iii", f.read(12))
        if magic != 0x434B4E49:
            raise ValueError(f"{path}: not an INKC class raster")
        minx, miny, cell = struct.unpack("<ddd", f.read(24))
        data = f.read(w * h)
    return w, h, minx, miny, cell, data


def load_replay_seed_ink(path):
    """Seed ink straight from a gzipped DetectSnapshot (replay_*.bin), in load_ink's
    return shape. The separately persisted ink_*.bin can be STALE relative to the replay
    (verified 2026-08-16: Attic ink bin was missing 51% of replay seed cells), so any
    surface that claims to show solver input must read this, not the ink bin."""
    import gzip, struct as _struct

    def read_7bit_length(stream):
        shift = value = 0
        while True:
            byte = stream.read(1)[0]
            value |= (byte & 0x7F) << shift
            if not byte & 0x80:
                return value
            shift += 7

    with gzip.open(path, "rb") as f:
        magic, _version = _struct.unpack("<Ii", f.read(8))
        if magic != 0x54414B53:  # "SKAT"
            raise ValueError(f"{path}: not a detect snapshot")
        f.read(read_7bit_length(f))            # level name
        f.read(8)                              # elevation
        f.read(read_7bit_length(f))            # capture options
        w, h = _struct.unpack("<ii", f.read(8))
        minx, miny, cell = _struct.unpack("<ddd", f.read(24))
        f.read(8 * w * h)                      # FloorZ + CeilZ floats
        bits = f.read((w * h + 7) // 8)
    return w, h, minx, miny, cell, bits


def load_tsv(path):
    rooms, polys = {}, {}
    for line in open(path, encoding="utf-8"):
        parts = line.rstrip("\n").split("\t")
        if parts[0] == "ROOM":
            rooms[parts[1]] = dict(sqft=float(parts[2]), lx=float(parts[4]), ly=float(parts[5]),
                                   ceil=float(parts[6]))
        elif parts[0] == "POLY":
            loop = [tuple(map(float, p.split(";"))) for p in parts[3].split("|")]
            polys.setdefault(parts[1], []).append((parts[2], loop))
    return rooms, polys


def load_disposition_tsv(path):
    rooms, polys = load_tsv(path)
    residues = []
    for line in open(path, encoding="utf-8"):
        parts = line.rstrip("\r\n").split("\t")
        if len(parts) < 9 or parts[:2] != ["META", "residue"]:
            continue
        residues.append({
            "id": parts[2],
            "reason": parts[3].lower(),
            "sqft": float(parts[4]),
            "loops": [
                [tuple(map(float, point.split(";"))) for point in value.split("|")]
                for value in parts[8:]
            ],
        })
    return rooms, polys, residues


def render_disposition(ink_path, tsv_path, scale=2):
    """Render accepted/held accounting on the exact same registered extent as the blind panel."""
    w, h, minx, miny, cell, _ = load_ink(ink_path)
    rooms, polys, residues = load_disposition_tsv(tsv_path)
    accepted = [_geometry(polys.get(room_id, [])) for room_id in sorted(rooms)]
    rejected = [_residue_geometry(item) for item in residues if item["reason"] == "rejected"]
    crumbs = [_residue_geometry(item) for item in residues if item["reason"] == "crumb"]
    excluded = [_residue_geometry(item) for item in residues if item["reason"] == "excluded"]
    accepted = [geometry for geometry in accepted if not geometry.is_empty]
    rejected = [geometry for geometry in rejected if not geometry.is_empty]
    crumbs = [geometry for geometry in crumbs if not geometry.is_empty]
    excluded = [geometry for geometry in excluded if not geometry.is_empty]
    all_geometries = accepted + rejected + crumbs + excluded
    intersections = []
    # Red means at least two disposition geometries claim the same area. Union the
    # pairwise intersections so triple claims stay one geometry-derived area.
    for index, left in enumerate(all_geometries):
        for right in all_geometries[index + 1:]:
            if not left.intersects(right):
                continue
            intersection = left.intersection(right)
            if intersection.area > 1e-7:
                intersections.append(intersection)
    overlap = unary_union(intersections) if intersections else GeometryCollection()

    size = (w * scale, h * scale)
    image = Image.new("RGB", size, "white")

    def to_pixel(point):
        return ((point[0] - minx) / cell * scale,
                (h - (point[1] - miny) / cell) * scale)

    for geometries, color in (
        (accepted, DISPOSITION_ACCEPTED),
        (rejected, DISPOSITION_REJECTED),
        (crumbs, DISPOSITION_CRUMB),
        (excluded, DISPOSITION_EXCLUDED),
        ([overlap], DISPOSITION_OVERLAP),
    ):
        mask = Image.new("1", size)
        draw = ImageDraw.Draw(mask)
        for geometry in geometries:
            _draw_geometry(draw, geometry, to_pixel)
        image.paste(color, mask=mask)

    accounting = {
        "acceptedCount": len(rooms),
        "acceptedSqft": round(sum(room["sqft"] for room in rooms.values()), 1),
        "rejectedCount": sum(item["reason"] == "rejected" for item in residues),
        "rejectedSqft": round(sum(item["sqft"] for item in residues
                                  if item["reason"] == "rejected"), 1),
        "crumbCount": sum(item["reason"] == "crumb" for item in residues),
        "crumbSqft": round(sum(item["sqft"] for item in residues
                               if item["reason"] == "crumb"), 1),
        "excludedCount": sum(item["reason"] == "excluded" for item in residues),
        "excludedSqft": round(sum(item["sqft"] for item in residues
                                   if item["reason"] == "excluded"), 1),
        "overlapSqft": round(overlap.area, 1),
    }
    _draw_disposition_legend(image, accounting)
    return image, accounting


def _geometry(loops):
    outers = [loop for kind, loop in loops if kind == "outer"]
    holes = [loop for kind, loop in loops if kind == "hole"]
    return _valid_polygonal(Polygon(outers[0], holes)) if outers else GeometryCollection()


def _residue_geometry(residue):
    loops = residue["loops"]
    return _valid_polygonal(Polygon(loops[0], loops[1:])) if loops else GeometryCollection()


def _valid_polygonal(geometry):
    repaired = make_valid(geometry) if not geometry.is_valid else geometry
    if isinstance(repaired, (Polygon, MultiPolygon)):
        return repaired
    polygons = [part for part in getattr(repaired, "geoms", ())
                if isinstance(part, (Polygon, MultiPolygon))]
    return unary_union(polygons) if polygons else GeometryCollection()


def _draw_geometry(draw, geometry, to_pixel):
    polygons = ([geometry] if isinstance(geometry, Polygon) else
                list(geometry.geoms) if isinstance(geometry, MultiPolygon) else [])
    for polygon in polygons:
        draw.polygon([to_pixel(point) for point in polygon.exterior.coords], fill=1)
        for hole in polygon.interiors:
            draw.polygon([to_pixel(point) for point in hole.coords], fill=0)


def _draw_disposition_legend(image, accounting):
    rows = [
        (DISPOSITION_ACCEPTED,
         f"accepted  {accounting['acceptedCount']} rooms  {accounting['acceptedSqft']:.1f} sf"),
        (DISPOSITION_REJECTED,
         f"rejected  {accounting['rejectedCount']} rooms  {accounting['rejectedSqft']:.1f} sf"),
        (DISPOSITION_CRUMB,
         f"crumbs  {accounting['crumbCount']} regions  {accounting['crumbSqft']:.1f} sf"),
        (DISPOSITION_EXCLUDED,
         f"excluded  {accounting['excludedCount']} regions  {accounting['excludedSqft']:.1f} sf"),
        (DISPOSITION_OVERLAP, f"overlap  {accounting['overlapSqft']:.1f} sf"),
    ]
    text_font = _font(18)
    row_height, padding, swatch = 25, 10, 14
    width = 325
    height = padding * 2 + row_height * len(rows)
    draw = ImageDraw.Draw(image)
    draw.rectangle((8, 8, 8 + width, 8 + height), fill="white", outline=(70, 70, 70), width=1)
    for index, (color, text) in enumerate(rows):
        y = 8 + padding + index * row_height
        draw.rectangle((18, y + 3, 18 + swatch, y + 3 + swatch), fill=color)
        draw.text((40, y), text, fill=(35, 35, 35), font=text_font)


def render_review(ink_path, tsv_path, mode="blind", scale=2, problem_ids=(),
                  problem_segments=(), problem_points=()):
    """Render a neutral taste panel or an addressable diagnostic panel."""
    if mode not in ("blind", "diagnostic"):
        raise ValueError("mode must be 'blind' or 'diagnostic'")
    w, h, minx, miny, cell, bits = load_ink(ink_path)
    rooms, polys = load_tsv(tsv_path)

    mask = Image.new("1", (w, h))
    mask.putdata([
        255 if (bits[i >> 3] >> (i & 7)) & 1 else 0
        for i in range(w * h)
    ])
    mask = mask.transpose(Image.Transpose.FLIP_TOP_BOTTOM)
    image = Image.new("RGB", (w, h), "white")
    image.paste((184, 184, 184), mask=mask)
    if scale != 1:
        image = image.resize((w * scale, h * scale), Image.Resampling.NEAREST)

    draw = ImageDraw.Draw(image)
    problems = set(problem_ids)

    def to_pixel(point):
        return ((point[0] - minx) / cell * scale,
                (h - (point[1] - miny) / cell) * scale)

    font = _font(22)
    for rid, meta in sorted(rooms.items()):
        problem = rid in problems
        color = (PROBLEM_COLOR if problem else
                 BLIND_COLOR if mode == "blind" else DIAGNOSTIC_COLOR)
        width = 6 if problem else 4
        for kind, loop in polys.get(rid, []):
            if len(loop) >= 2:
                draw.line([to_pixel(point) for point in loop] + [to_pixel(loop[0])],
                          fill=color, width=width if kind == "outer" else max(2, width - 2),
                          joint="curve")
        if mode == "diagnostic":
            x, y = to_pixel((meta["lx"], meta["ly"]))
            label = f"{rid}  {meta['sqft']:.0f} sf"
            draw.text((x + 2, y + 2), label, fill="white", font=font)
            draw.text((x, y), label, fill=color, font=font)
    if mode == "diagnostic":
        for start, end in problem_segments:
            a, b = to_pixel(start), to_pixel(end)
            draw.line((a, b), fill=PROBLEM_COLOR, width=7)
            radius = 4
            draw.ellipse((a[0] - radius, a[1] - radius, a[0] + radius, a[1] + radius),
                         fill=PROBLEM_COLOR)
        for point in problem_points:
            x, y = to_pixel(point)
            radius = 7
            draw.ellipse((x - radius, y - radius, x + radius, y + radius),
                         outline=PROBLEM_COLOR, width=4)
    return image


def _font(size):
    try:
        return ImageFont.truetype("arial.ttf", size)
    except OSError:
        return ImageFont.load_default()


def render(replay_path, tsv_path, out_path, scale=4, thumb=None, junk_ids=(), quiet=False):
    """CLI overlay renderer. Evidence is the replay snapshot's seed ink only — the raster
    the solver actually partitioned on (the stale ink_*.bin lane is deleted)."""
    w, h, minx, miny, cell, bits = load_replay_seed_ink(replay_path)
    rooms, polys = load_tsv(tsv_path)
    img = Image.new("RGB", (w * scale, h * scale), (255, 255, 255))
    px = img.load()
    for y in range(h):
        row = (h - 1 - y) * scale
        for x in range(w):
            if (bits[(y * w + x) >> 3] >> ((y * w + x) & 7)) & 1:
                for dy in range(scale):
                    for dx in range(scale):
                        px[x * scale + dx, row + dy] = (170, 170, 170)
    dr = ImageDraw.Draw(img)

    def tp(pt):
        return ((pt[0] - minx) / cell * scale, (h - (pt[1] - miny) / cell) * scale)

    try:
        font = ImageFont.truetype("arial.ttf", 26)
    except OSError:
        font = ImageFont.load_default()
    for i, (rid, meta) in enumerate(sorted(rooms.items())):
        is_junk = rid in junk_ids
        col = (255, 0, 255) if is_junk else PALETTE[i % len(PALETTE)]
        for kind, loop in polys.get(rid, []):
            dr.line([tp(p) for p in loop] + [tp(loop[0])], fill=col,
                    width=6 if is_junk else (3 if kind == "outer" else 2))
        lx, ly = tp((meta["lx"], meta["ly"]))
        label = f'{"JUNK " if is_junk else ""}{rid} {meta["sqft"]:.0f}sf h{meta["ceil"]:.1f}'
        dr.text((lx + 2, ly + 2), label, fill=(255, 255, 255), font=font)
        dr.text((lx, ly), label, fill=col, font=font)
    img.save(out_path)
    if not quiet:
        print(out_path, img.size)
    if thumb:
        small = img.copy()
        small.thumbnail((thumb, thumb))
        root, ext = os.path.splitext(out_path)
        small.save(f"{root}_small{ext}")
        if not quiet:
            print(f"{root}_small{ext}", small.size)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("slug", help="e.g. Level_1_Main_Level")
    ap.add_argument("--project", default="project-a")
    ap.add_argument("--live", action="store_true", help="use live Documents TSV+ink, not fixtures")
    ap.add_argument("--ink-dir", default=LIVE, help="dir with replay_<slug>.bin (seed ink)")
    ap.add_argument("--out", default=None)
    ap.add_argument("--thumb", type=int, default=2000)
    ap.add_argument("--tsv-dir", default=None, help="score any TSV dir (e.g. an offline replay dump)")
    a = ap.parse_args()
    tsv_dir = a.tsv_dir or (a.ink_dir if a.live else os.path.join(os.environ.get("PE_PRIVATE_FIXTURES") or os.path.join(REPO, ".private", "fixtures"), a.project, "rhvac", "takeoff"))
    replay = os.path.join(a.ink_dir, f"replay_{a.slug}.bin")
    if not os.path.isfile(replay):
        raise SystemExit(
            f"missing replay seed ink: {replay}\n"
            "replay_<level>.bin is the only evidence source (stale ink_*.bin lane deleted). "
            "Recapture: docs/features/takeoffs/manual-e2e-runbook.md "
            "(Capture step writes replay_<level>.bin)")
    render(
        replay,
        os.path.join(tsv_dir, f"rooms_{a.slug}.tsv"),
        a.out or os.path.join(os.getcwd(), f"overlay_{a.slug}.png"),
        thumb=a.thumb,
    )
