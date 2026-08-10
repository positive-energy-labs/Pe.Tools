"""Compare Upper-Level takeoff quality and room-width separation across cell sizes."""
import argparse
import json
import math
import os
from collections import Counter, defaultdict

import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy.ndimage import distance_transform_cdt
from shapely.geometry import LineString, Polygon
from shapely.ops import unary_union

HERE = os.path.dirname(os.path.abspath(__file__))
projectA = os.path.join(HERE, "project-a")
JUNK_IOU = 0.2
SMALL_CANDIDATE_SF = 200
WIDTH_RASTER_FT = 1 / 16  # fixed 0.75-in measurement grid for every detector resolution
WALL_HIT_FRAC = 0.7


def load_candidates(directory):
    path = os.path.join(directory, "rooms_Level_2_Upper_Level.tsv")
    loops = defaultdict(lambda: {"outer": [], "hole": []})
    for line in open(path, encoding="utf-8"):
        parts = line.rstrip("\n").split("\t")
        if parts[0] == "POLY":
            loops[parts[1]][parts[2]].append([tuple(map(float, point.split(";")))
                                               for point in parts[3].split("|")])
    candidates = {}
    for room_id, room_loops in loops.items():
        polygon = Polygon(room_loops["outer"][0], room_loops["hole"])
        if not polygon.is_valid:
            polygon = polygon.buffer(0)
        if polygon.area > 0:
            candidates[room_id] = polygon
    return candidates


def load_truth():
    geometry = json.load(open(os.path.join(projectA, "oracle-geometry.json"), encoding="utf-8"))
    stale_path = os.path.join(projectA, "stale-rooms.json")
    stale = json.load(open(stale_path, encoding="utf-8")) if os.path.exists(stale_path) else {"exclude": []}
    excluded = {str(item["number"]) for item in stale["exclude"]}
    rooms = {}
    for number, room in geometry["rooms"].items():
        if room["floor"] == 2 and number not in excluded:
            rooms[number] = Polygon(room["polygonModelFt"])
    walls = [LineString(wall["pointsModelFt"]) for wall in geometry["walls"]
             if wall["floor"] == 2]
    return rooms, walls


def iou(left, right):
    intersection = left.intersection(right).area
    return intersection / (left.area + right.area - intersection) if intersection else 0.0


def interior_width_ft(polygon):
    """Approximate the largest-inscribed-disc diameter with a chessboard chamfer raster."""
    min_x, min_y, max_x, max_y = polygon.bounds
    pad = 2
    width = math.ceil((max_x - min_x) / WIDTH_RASTER_FT) + 2 * pad
    height = math.ceil((max_y - min_y) / WIDTH_RASTER_FT) + 2 * pad
    image = Image.new("1", (width, height))
    draw = ImageDraw.Draw(image)

    def pixels(points):
        return [((x - min_x) / WIDTH_RASTER_FT + pad,
                 (max_y - y) / WIDTH_RASTER_FT + pad) for x, y in points]

    draw.polygon(pixels(polygon.exterior.coords), fill=1)
    for hole in polygon.interiors:
        draw.polygon(pixels(hole.coords), fill=0)
    distance = distance_transform_cdt(np.asarray(image, dtype=np.uint8), metric="chessboard")
    return 2 * float(distance.max()) * WIDTH_RASTER_FT


def wall_recall(candidates, walls, tolerance_ft):
    if not candidates:
        return 0.0
    boundary = unary_union([polygon.boundary for polygon in candidates.values()])
    recalled = 0
    for wall in walls:
        samples = max(3, int(wall.length // 2) + 1)
        hits = sum(boundary.distance(wall.interpolate(i / (samples - 1), normalized=True))
                   <= tolerance_ft for i in range(samples))
        recalled += hits / samples >= WALL_HIT_FRAC
    return recalled / len(walls) if walls else 0.0


def histogram(values, bin_ft=0.5):
    counts = Counter(int(value / bin_ft) for value in values)
    return {f"{index * bin_ft:.1f}-{(index + 1) * bin_ft:.1f}": counts[index]
            for index in range(max(counts, default=-1) + 1)}


def overlap_pct(left, right, bin_ft=0.25):
    if not left or not right:
        return 0.0
    left_counts = Counter(int(value / bin_ft) for value in left)
    right_counts = Counter(int(value / bin_ft) for value in right)
    bins = set(left_counts) | set(right_counts)
    return 100 * sum(min(left_counts[index] / len(left), right_counts[index] / len(right))
                     for index in bins)


def best_threshold(junk_widths, real_widths):
    labeled = [(width, False) for width in junk_widths] + [(width, True) for width in real_widths]
    evaluations = []
    for threshold in sorted({0.0, *(width for width, _ in labeled)}):
        true_positive = sum(real and width >= threshold for width, real in labeled)
        false_positive = sum(not real and width >= threshold for width, real in labeled)
        precision = true_positive / (true_positive + false_positive) if true_positive + false_positive else 1.0
        recall = true_positive / len(real_widths) if real_widths else 0.0
        f1 = 2 * precision * recall / (precision + recall) if precision + recall else 0.0
        evaluations.append((threshold, precision, recall, f1))
    threshold, precision, recall, f1 = max(
        evaluations, key=lambda result: (result[3], result[2], result[1], -result[0]))
    return {
        "acceptRealAtOrAboveFt": round(threshold, 3),
        "precisionPct": round(100 * precision, 1),
        "recallPct": round(100 * recall, 1),
        "f1Pct": round(100 * f1, 1),
        "has90PctPrecisionRecallWindow": any(item[1] >= 0.9 and item[2] >= 0.9
                                               for item in evaluations),
    }


def analyze(label, cell_ft, directory, truth, walls):
    candidates = load_candidates(directory)
    rows = []
    for room_id, candidate in candidates.items():
        best_number, best_iou = max(
            ((number, iou(candidate, polygon)) for number, polygon in truth.items()),
            key=lambda item: item[1], default=(None, 0.0))
        rows.append({"id": room_id, "polygon": candidate, "areaSf": candidate.area,
                     "bestGt": best_number, "bestIoU": best_iou})
    junk = [row for row in rows if row["bestIoU"] < JUNK_IOU]
    real_small = [row for row in rows if row["bestIoU"] >= JUNK_IOU
                  and row["areaSf"] <= SMALL_CANDIDATE_SF]
    for row in junk + real_small:
        row["widthFt"] = interior_width_ft(row["polygon"])
    junk_widths = [row["widthFt"] for row in junk]
    real_widths = [row["widthFt"] for row in real_small]
    gt_ious = [max((iou(gt, candidate) for candidate in candidates.values()), default=0.0)
               for gt in truth.values()]
    metrics = {
        "label": label,
        "cellFt": cell_ft,
        "candidateCount": len(candidates),
        "meanBestGtIoU": round(sum(gt_ious) / len(gt_ious), 4),
        "junkCount": len(junk),
        "junkAreaSf": round(sum(row["areaSf"] for row in junk), 1),
        "wallRecallPct": {
            "0.75ft": round(100 * wall_recall(candidates, walls, 0.75), 1),
            "1.5ft": round(100 * wall_recall(candidates, walls, 1.5), 1),
        },
        "width": {
            "method": "0.0625-ft polygon raster; scipy chessboard chamfer; diameter=2*maxDistance",
            "junkCount": len(junk_widths),
            "matchedUnder200SfCount": len(real_widths),
            "junkHistogram": histogram(junk_widths),
            "matchedUnder200SfHistogram": histogram(real_widths),
            "histogramOverlapPct": round(overlap_pct(junk_widths, real_widths), 1),
            "bestThreshold": best_threshold(junk_widths, real_widths),
        },
    }
    return metrics, candidates, {row["id"] for row in junk}


def render_overlay(path, panels, truth):
    all_polygons = list(truth.values()) + [polygon for _, candidates, _ in panels
                                           for polygon in candidates.values()]
    min_x = min(polygon.bounds[0] for polygon in all_polygons)
    min_y = min(polygon.bounds[1] for polygon in all_polygons)
    max_x = max(polygon.bounds[2] for polygon in all_polygons)
    max_y = max(polygon.bounds[3] for polygon in all_polygons)
    panel_w, panel_h, margin = 1200, 1050, 55
    scale = min((panel_w - 2 * margin) / (max_x - min_x),
                (panel_h - 2 * margin) / (max_y - min_y))
    image = Image.new("RGB", (panel_w * len(panels), panel_h), "white")
    try:
        font = ImageFont.truetype("arial.ttf", 28)
    except OSError:
        font = ImageFont.load_default()
    for panel_index, (label, candidates, junk_ids) in enumerate(panels):
        offset = panel_index * panel_w
        draw = ImageDraw.Draw(image, "RGBA")

        def point(coordinate):
            x, y = coordinate
            return (offset + margin + (x - min_x) * scale,
                    panel_h - margin - (y - min_y) * scale)

        for polygon in truth.values():
            draw.line([point(value) for value in polygon.exterior.coords], fill=(80, 80, 80, 130), width=2)
        for room_id, polygon in candidates.items():
            junk = room_id in junk_ids
            fill = (225, 0, 150, 85) if junk else (0, 145, 155, 38)
            outline = (215, 0, 145, 255) if junk else (0, 125, 135, 210)
            draw.polygon([point(value) for value in polygon.exterior.coords], fill=fill, outline=outline,
                         width=4 if junk else 2)
            for hole in polygon.interiors:
                draw.polygon([point(value) for value in hole.coords], fill=(255, 255, 255, 255),
                             outline=outline, width=2)
        draw.text((offset + 20, 15), f"{label}: {len(candidates)} candidates, {len(junk_ids)} junk",
                  fill=(20, 20, 20, 255), font=font)
        if panel_index:
            draw.line([(offset, 0), (offset, panel_h)], fill=(120, 120, 120, 255), width=3)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    image.save(path)


def self_check():
    square = Polygon([(0, 0), (4, 0), (4, 4), (0, 4)])
    assert 3.8 <= interior_width_ft(square) <= 4.2
    assert best_threshold([1, 2], [4, 5])["has90PctPrecisionRecallWindow"]


def main():
    self_check()
    parser = argparse.ArgumentParser()
    parser.add_argument("--baseline", default=os.path.join(projectA, "takeoff"))
    parser.add_argument("--cell-0125", default=os.path.join(
        HERE, "..", "..", ".artifacts", "tmp", "rhvac-finecell-replay", "cell_0125_current"))
    parser.add_argument("--cell-00833", default=os.path.join(
        HERE, "..", "..", ".artifacts", "tmp", "rhvac-finecell-replay", "cell_00833_current"))
    parser.add_argument("--overlay", default=os.path.join(projectA, "probe", "overlay_finecell.png"))
    parser.add_argument("--json-out")
    args = parser.parse_args()

    truth, walls = load_truth()
    datasets = [("0.25 ft", 0.25, args.baseline), ("0.125 ft", 0.125, args.cell_0125)]
    if os.path.exists(args.cell_00833):
        datasets.append(("1 in", 1 / 12, args.cell_00833))
    results, panels = [], []
    for label, cell_ft, directory in datasets:
        metrics, candidates, junk_ids = analyze(label, cell_ft, directory, truth, walls)
        results.append(metrics)
        if cell_ft in (0.25, 0.125):
            panels.append((label, candidates, junk_ids))
    render_overlay(args.overlay, panels, truth)
    payload = {"datasets": results, "overlay": os.path.abspath(args.overlay)}
    if args.json_out:
        os.makedirs(os.path.dirname(os.path.abspath(args.json_out)), exist_ok=True)
        json.dump(payload, open(args.json_out, "w", encoding="utf-8"), indent=2)
    print(json.dumps(payload, indent=2))


if __name__ == "__main__":
    main()
