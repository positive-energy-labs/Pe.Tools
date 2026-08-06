"""Score the Upper Level vector probe against the mined wall oracle and render its overlay."""
import json
import math
import os

from PIL import Image, ImageDraw, ImageFont
from shapely.geometry import LineString, MultiLineString, Polygon
from shapely.ops import substring, unary_union

import overlay


HERE = os.path.dirname(os.path.abspath(__file__))
projectA = os.path.join(HERE, "project-a")
PROBE = os.path.join(projectA, "probe")
HARVEST = os.path.join(PROBE, "harvest_upper.json")
ORACLE = os.path.join(projectA, "oracle-geometry.json")
TSV = os.path.join(projectA, "takeoff", "rooms_Level_2_Upper_Level.tsv")
INK = next((path for path in (
    os.path.expanduser(r"~\OneDrive\Documents\Pe.Tools\takeoff\ink_Level_2_Upper_Level.bin"),
    os.path.expanduser(r"~\Documents\Pe.Tools\takeoff\ink_Level_2_Upper_Level.bin"),
) if os.path.isfile(path)), None)
OUT_IMAGE = os.path.join(PROBE, "overlay_upper_probe.png")
OUT_SCORE = os.path.join(PROBE, "score_upper.json")
TOLERANCES = (0.75, 1.5)
WALL_HIT_FRAC = 0.7


def recall(walls, evidence, tolerance):
    recalled = 0
    for wall in walls:
        n = max(3, int(wall.length // 2) + 1)
        hits = 0 if evidence is None else sum(
            evidence.distance(wall.interpolate(i / (n - 1), normalized=True)) <= tolerance
            for i in range(n)
        )
        recalled += hits / n >= WALL_HIT_FRAC
    return recalled, len(walls)


def lines_geometry(lines):
    coords = [list(line.coords) for line in lines if line.length > 0]
    return MultiLineString(coords) if coords else None


def raster_boundary():
    _, polys = overlay.load_tsv(TSV)
    candidates = []
    for loops in polys.values():
        for kind, points in loops:
            if kind != "outer":
                continue
            polygon = Polygon(points)
            if not polygon.is_valid:
                polygon = polygon.buffer(0)
            if polygon.area:
                candidates.append(polygon)
    return unary_union([polygon.exterior for polygon in candidates])


def dashed(draw, points, fill, width=3, dash=10, gap=6):
    for a, b in zip(points, points[1:]):
        dx, dy = b[0] - a[0], b[1] - a[1]
        length = math.hypot(dx, dy)
        if not length:
            continue
        cursor = 0.0
        while cursor < length:
            end = min(cursor + dash, length)
            draw.line((a[0] + dx * cursor / length, a[1] + dy * cursor / length,
                       a[0] + dx * end / length, a[1] + dy * end / length),
                      fill=fill, width=width)
            cursor += dash + gap


def render(harvest, walls, scores):
    if INK is None:
        raise FileNotFoundError("ink_Level_2_Upper_Level.bin was not found in a Pe.Tools takeoff directory")
    width, height, minx, miny, cell, bits = overlay.load_ink(INK)
    pixels = bytearray(b"\xff" * (width * height * 3))
    for y in range(height):
        row = height - 1 - y
        for x in range(width):
            if (bits[(y * width + x) >> 3] >> ((y * width + x) & 7)) & 1:
                i = (row * width + x) * 3
                pixels[i:i + 3] = b"\xb0\xb0\xb0"
    image = Image.frombytes("RGB", (width, height), bytes(pixels))
    draw = ImageDraw.Draw(image)

    def tp(point):
        return ((point[0] - minx) / cell, height - (point[1] - miny) / cell)

    for element in harvest["laneB"]["elements"]:
        for segment in element["segments"]:
            draw.line([tp(point) for point in segment], fill=(145, 55, 190), width=2)

    insert_colors = {"door": (225, 45, 45), "window": (0, 150, 210), "opening": (240, 135, 20)}
    for wall in harvest["laneA"]["walls"]:
        line = LineString(wall["points"])
        draw.line([tp(point) for point in line.coords], fill=(25, 90, 220), width=4)
        for insert in wall["inserts"]:
            span = substring(line, insert["spanStartFt"], insert["spanEndFt"])
            if span.geom_type == "LineString":
                draw.line([tp(point) for point in span.coords],
                          fill=insert_colors[insert["type"]], width=7)

    for wall in walls:
        dashed(draw, [tp(point) for point in wall.coords], (20, 125, 35), width=4)

    try:
        font = ImageFont.truetype("arial.ttf", 18)
    except OSError:
        font = ImageFont.load_default()
    legend = [
        "Upper Level plane-cut probe",
        "gray raster | blue wall | red door | cyan window | orange opening",
        "purple plane cut | dashed green mined GT",
        f"A+B recall: {scores['laneAPlusB']['0.75']['pct']:.1f}% @0.75 ft | "
        f"{scores['laneAPlusB']['1.5']['pct']:.1f}% @1.5 ft",
        f"Raster recall: {scores['raster']['0.75']['pct']:.1f}% @0.75 ft | "
        f"{scores['raster']['1.5']['pct']:.1f}% @1.5 ft",
    ]
    draw.rectangle((8, 8, 720, 122), fill=(255, 255, 255), outline=(40, 40, 40), width=2)
    for i, text in enumerate(legend):
        draw.text((18, 14 + i * 21), text, fill=(20, 20, 20), font=font)
    image.save(OUT_IMAGE)


def main():
    with open(HARVEST, encoding="utf-8") as stream:
        harvest = json.load(stream)
    with open(ORACLE, encoding="utf-8") as stream:
        oracle = json.load(stream)

    walls = []
    for wall in oracle["walls"]:
        line = LineString(wall["pointsModelFt"])
        if wall["floor"] == 2 and line.length > 0:
            walls.append(line)
    lane_a_lines = [LineString(wall["points"]) for wall in harvest["laneA"]["walls"]]
    lane_b_lines = [LineString(segment) for element in harvest["laneB"]["elements"]
                    for segment in element["segments"]]
    evidence = {
        "laneA": lines_geometry(lane_a_lines),
        "laneAPlusB": lines_geometry(lane_a_lines + lane_b_lines),
        "raster": raster_boundary(),
    }
    scores = {}
    for name, geometry in evidence.items():
        scores[name] = {}
        for tolerance in TOLERANCES:
            hit, total = recall(walls, geometry, tolerance)
            scores[name][str(tolerance)] = {
                "recalled": hit, "total": total, "pct": round(100 * hit / total, 1),
            }

    perfect = LineString([(0, 0), (10, 0)])
    assert recall([perfect], perfect, 0.01) == (1, 1)
    assert recall([perfect], None, 1.5) == (0, 1)

    output = {"upperWallCount": len(walls), "scores": scores,
              "harvestCounts": harvest["laneB"]["counts"]}
    with open(OUT_SCORE, "w", encoding="utf-8") as stream:
        json.dump(output, stream, indent=2)
        stream.write("\n")
    render(harvest, walls, scores)

    print(f"{'evidence':<22} {'0.75 ft':>17} {'1.5 ft':>17}")
    for name in ("laneA", "laneAPlusB", "raster"):
        cells = [f"{scores[name][str(t)]['pct']:.1f}% "
                 f"({scores[name][str(t)]['recalled']}/{len(walls)})" for t in TOLERANCES]
        print(f"{name:<22} {cells[0]:>17} {cells[1]:>17}")
    print(OUT_SCORE)
    print(OUT_IMAGE)


if __name__ == "__main__":
    main()
