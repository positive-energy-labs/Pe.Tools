# Takeoff scoreboard: score a detector takeoff (rooms_*.tsv) against the geometric ground truth
# mined from the engineer's Bluebeam takeoffs (project-a/oracle-geometry.json, model feet).
# This is the per-room geometric feedback loop detector iteration is judged by.
#
#   python eval/rhvac/score-takeoff.py                       # committed snapshot in project-a/takeoff
#   python eval/rhvac/score-takeoff.py --project eval/rhvac/project-b --takeoff-dir <dir>
#   python eval/rhvac/score-takeoff.py --write-room-map      # regenerate project-a/room-map.json from
#                                                            # mutual-best IoU pairs (provenance
#                                                            # "auto-iou"; curated entries preserved)
#
# Outputs a compact, diff-stable text scoreboard (stdout + project-a/scoreboard.txt) and JSON
# (project-a/scoreboard.json); both are gitignored per-run artifacts.
#
# Honesty notes:
# - Ground-truth polygons carry a confidence tag ("high"/"medium"/"flagged") from the area-match +
#   registration pipeline; the headline score uses all rooms, the high-confidence subset is also
#   reported. Most markups are 2024-vintage; rooms whose ground truth is stale belong in
#   project-a/stale-rooms.json (excluded here without code edits).
# - Over-detection counts candidate area outside ANY ground-truth polygon, which includes real
#   rooms whose ground truth is simply missing (15 in-model oracle rooms have no polygon).
import argparse, json, math, os, re, statistics, sys
from collections import defaultdict

import overlay
from shapely.geometry import LineString, Point, Polygon
from shapely.ops import split as split_polygon, unary_union

HERE = os.path.dirname(os.path.abspath(__file__))
projectA = os.path.join(HERE, "project-a")

IOU_OK = 0.7          # 1:1 match below this is "shape-poor"
MISSING_COVER = 0.25  # GT covered less than this by all candidates together -> "missing"
MERGE_COVER = 0.45    # candidate covering this fraction of >=2 GT rooms -> those rooms "merged"
FRAG_PIECE = 0.15     # a candidate covering this fraction of a GT room is a fragment piece
WALL_TOL_FT = 1.5     # candidate edge within this of a wall line sample point counts
                      # (default absorbs typical 2-4 ft registration residual + wall thickness;
                      #  recall vs tol on the baseline: 0.75->17%, 1.0->26%, 1.5->44%, 2.0->56%)
WALL_HIT_FRAC = 0.7   # fraction of sample points that must hit for a wall to be "recalled"

JUNK_IOU = 0.2                # candidate below this best same-floor GT IoU is junk
GATE_COUNT_RATIO_MAX = 1.2    # candidates / GT rooms, on every level
GATE_TAXONOMY_OK_MIN = 0.8    # fraction of GT rooms classified ok
GATE_JUNK_UNDER_60_MAX = 0    # zero junk candidates smaller than 60 sf
GATE_UNFLAGGED_JUNK_UNDER_60_MAX = 25  # review queue target
GATE_SUSPECT_PRECISION_MIN = 0.85
GATE_SUSPECT_FALSE_POSITIVE_MAX = 20
GATE_WALL_RECALL_MIN = 0.8    # mined walls recalled at WALL_TOL_FT


def load_takeoff(takeoff_dir):
    """Candidate polygons and META flags keyed by level-qualified room id."""
    floors = defaultdict(dict)
    candidate_flags = defaultdict(set)
    candidate_meta = {}
    residues = defaultdict(dict)
    level_names = {}
    loaded = []
    for f in sorted(os.listdir(takeoff_dir)):
        if not (f.startswith("rooms_") and f.endswith(".tsv")):
            continue
        level, elevation, polys, flags, rooms, raw_residues = (None, None, defaultdict(list),
                                                               defaultdict(set), {}, [])
        for line in open(os.path.join(takeoff_dir, f), encoding="utf-8"):
            p = line.rstrip("\n").split("\t")
            if p[0] == "META" and p[1] == "level":
                level = p[2].strip()
            elif p[0] == "META" and p[1] == "elev":
                elevation = float(p[2])
            elif p[0] == "META" and p[1] == "flag":
                rid, separator, payload = p[2].partition(":")
                if separator and rid.startswith("R"):
                    flags[rid].update(flag for flag in payload.split("+") if flag)
            elif p[0] == "META" and p[1] == "residue" and len(p) >= 9:
                raw_residues.append({
                    "id": p[2], "reason": p[3], "sqft": float(p[4]),
                    "label": [float(p[5]), float(p[6])], "meanCeilingFt": float(p[7]),
                    "loops": [[tuple(map(float, q.split(";"))) for q in loop.split("|")]
                              for loop in p[8:]],
                })
            elif p[0] == "ROOM":
                rooms[p[1]] = {"sqft": float(p[2]), "label": [float(p[4]), float(p[5])],
                               "meanCeilingFt": float(p[6])}
            elif p[0] == "POLY" and p[2] == "outer":
                polys[p[1]].append([tuple(map(float, q.split(";"))) for q in p[3].split("|")])
        if level is None or elevation is None:
            raise SystemExit(f"{f}: no META level/elev line")
        loaded.append((level, elevation, polys, flags, rooms, raw_residues))
    elevations = sorted({elevation for _, elevation, _, _, _, _ in loaded})
    for level, elevation, polys, flags, rooms, raw_residues in loaded:
        match = re.search(r"Level\s+(\d+)", level, re.I)
        floor = int(match.group(1)) if match else elevations.index(elevation)
        level_names[floor] = level
        for rid, loops in polys.items():
            pg = Polygon(loops[0])
            if not pg.is_valid:
                pg = pg.buffer(0)
            if pg.area > 0:
                key = f"{level}:{rid}"
                floors[floor][key] = pg
                candidate_flags[key].update(flags[rid])
                rooms[rid]["vertices"] = len(loops[0])
                rooms[rid]["level"] = level
                candidate_meta[key] = rooms[rid]
        for residue in raw_residues:
            pg = Polygon(residue["loops"][0], residue["loops"][1:])
            if not pg.is_valid:
                pg = pg.buffer(0)
            if pg.area > 0:
                residues[floor][f"{level}:{residue['id']}"] = {
                    **residue, "polygon": pg, "level": level, "claimed": False,
                }
    return floors, candidate_flags, candidate_meta, residues, level_names


def straightness(candidate_meta, candidate_flags):
    """Report polygon complexity; this is evidence, not a detector gate."""
    levels = defaultdict(list)
    for key, meta in candidate_meta.items():
        levels[meta["level"]].append((meta["vertices"], "unregularized" in candidate_flags[key]))

    def summarize(values):
        counts = [vertices for vertices, _ in values]
        return {
            "rooms": len(values),
            "meanVertices": round(sum(counts) / len(counts), 1),
            "medianVertices": round(statistics.median(counts), 1),
            "roomsLe12Pct": round(100 * sum(count <= 12 for count in counts) / len(counts), 1),
            "unregularizedPct": round(100 * sum(flagged for _, flagged in values) / len(values), 1),
        }

    return {level: summarize(values) for level, values in sorted(levels.items())}


def apply_resolutions(takeoff, sidecar):
    """Apply v1 key-only or v2 anchor-backed decisions with loss accounting."""
    if sidecar.get("version") not in (1, 2) or not isinstance(sidecar.get("resolutions"), list):
        raise SystemExit("resolutions sidecar must be version 1 or 2 with a resolutions array")
    floors, candidate_flags, candidate_meta, residues, level_names = takeoff
    floors = defaultdict(dict, {floor: dict(candidates) for floor, candidates in floors.items()})
    candidate_flags = defaultdict(set, {key: set(flags) for key, flags in candidate_flags.items()})
    candidate_meta = dict(candidate_meta)
    residues = defaultdict(dict, {
        floor: {key: dict(value) for key, value in values.items()}
        for floor, values in residues.items()
    })
    accounting = {"applied": 0, "remapped": 0, "orphaned": 0}
    touches = defaultdict(int)
    grouped = defaultdict(list)
    split_pieces = {}
    split_targets = set()
    merge_sources = set()
    merge_source_floors = {}
    merged_by_target = {}
    claimed_residues = set()

    def resolve_candidate(key, anchor):
        target = next(((floor, key) for floor, candidates in floors.items()
                       if key in candidates), None)
        if sidecar.get("version") == 1:
            return target, False
        if not anchor:
            return None, False
        point = Point(anchor["label"])
        exact_valid = (target is not None and floors[target[0]][target[1]].contains(point)
                       and abs(candidate_meta[target[1]]["sqft"] - anchor["sqft"])
                       <= anchor["sqft"] * 0.2)
        if exact_valid:
            return target, False
        level = key.rsplit(":", 1)[0] if isinstance(key, str) and ":" in key else ""
        return next(((floor, candidate_key)
                     for floor, candidates in floors.items()
                     for candidate_key, polygon in candidates.items()
                     if candidate_key.rsplit(":", 1)[0] == level and polygon.contains(point)),
                    None), True

    def resolve_residue(key, anchor):
        target = next(((floor, key) for floor, values in residues.items() if key in values), None)
        if sidecar.get("version") == 1:
            return target, False
        if not anchor:
            return None, False
        point = Point(anchor["label"])
        exact_valid = (target is not None
                       and residues[target[0]][target[1]]["polygon"].contains(point)
                       and abs(residues[target[0]][target[1]]["sqft"] - anchor["sqft"])
                       <= anchor["sqft"] * 0.2)
        if exact_valid:
            return target, False
        level = key.rsplit(":", 1)[0] if isinstance(key, str) and ":" in key else ""
        return next(((floor, residue_key)
                     for floor, values in residues.items()
                     for residue_key, residue in values.items()
                     if residue["level"] == level and residue["polygon"].contains(point)),
                    None), True

    for resolution in sidecar.get("resolutions", []):
        action = resolution.get("action")
        if not resolution.get("candidateKey") or not resolution.get("flag"):
            raise SystemExit("each resolution requires candidateKey and flag")
        if action not in ("accept", "split", "reject", "merge", "claim-residue"):
            raise SystemExit(f"unknown resolution action: {action}")
        touches[action] += 1
        key = resolution.get("candidateKey")
        if action == "claim-residue":
            params = resolution.get("params") or {}
            if not params.get("residueId"):
                raise SystemExit("claim-residue params require residueId")
            if params.get("residueId") != key.rsplit(":", 1)[-1]:
                accounting["orphaned"] += 1
                continue
            source, was_remapped = resolve_residue(key, resolution.get("anchor"))
            if source is None or source in claimed_residues:
                accounting["orphaned"] += 1
                continue
            floor, source_key = source
            residue = residues[floor][source_key]
            if params.get("into"):
                if not params.get("anchor"):
                    raise SystemExit("claim-residue into requires a target anchor")
                target, target_remapped = resolve_candidate(params["into"], params["anchor"])
                if target is None or target[0] != floor or target[1] in merge_sources:
                    accounting["orphaned"] += 1
                    continue
                target_state = merged_by_target.get(target[1], {
                    "floor": target[0], "polygon": floors[target[0]][target[1]],
                    "flags": set(candidate_flags[target[1]]),
                    "sqft": candidate_meta[target[1]]["sqft"],
                })
                merged = residue["polygon"].union(target_state["polygon"])
                if not isinstance(merged, Polygon):
                    accounting["orphaned"] += 1
                    continue
                merged_by_target[target[1]] = {
                    **target_state, "polygon": merged,
                    "sqft": target_state["sqft"] + residue["sqft"],
                }
                was_remapped = was_remapped or target_remapped
            else:
                floors[floor][source_key] = residue["polygon"]
                candidate_flags[source_key] = set()
                candidate_meta[source_key] = {
                    "sqft": residue["sqft"], "label": residue["label"],
                    "vertices": len(residue["polygon"].exterior.coords) - 1,
                    "level": residue["level"],
                }
            claimed_residues.add(source)
            accounting["remapped" if was_remapped else "applied"] += 1
            continue
        source, was_remapped = resolve_candidate(key, resolution.get("anchor"))
        if source is None:
            accounting["orphaned"] += 1
            continue

        floor, source_key = source
        if action == "split":
            if source_key in split_targets:
                accounting["orphaned"] += 1
                continue
            params = resolution.get("params") or {}
            try:
                pieces = [piece for piece in split_polygon(
                    floors[floor][source_key], LineString([params["a"], params["b"]])).geoms
                          if isinstance(piece, Polygon) and piece.area >= 1]
            except (KeyError, TypeError, ValueError):
                pieces = []
            if len(pieces) != 2:
                accounting["orphaned"] += 1
                continue
            pieces.sort(key=lambda piece: (-piece.area, piece.centroid.x, piece.centroid.y))
            split_targets.add(source_key)
            split_pieces[source_key] = pieces
        elif action == "merge":
            params = resolution.get("params") or {}
            if not params.get("other") or not params.get("anchor"):
                raise SystemExit("merge params require other and anchor")
            survivor, survivor_remapped = resolve_candidate(
                params["other"], params["anchor"])
            if (survivor is None or survivor == source or survivor[0] != floor
                    or source_key in merge_sources or survivor[1] in merge_sources):
                accounting["orphaned"] += 1
                continue
            source_state = merged_by_target.get(source_key, {
                "polygon": floors[floor][source_key],
                "flags": set(candidate_flags[source_key]),
                "sqft": candidate_meta[source_key]["sqft"],
            })
            survivor_state = merged_by_target.get(survivor[1], {
                "polygon": floors[survivor[0]][survivor[1]],
                "flags": set(candidate_flags[survivor[1]]),
                "sqft": candidate_meta[survivor[1]]["sqft"],
            })
            merged = source_state["polygon"].union(survivor_state["polygon"])
            if not isinstance(merged, Polygon):
                accounting["orphaned"] += 1
                continue
            merge_sources.add(source_key)
            merge_source_floors[source_key] = floor
            merged_by_target.pop(source_key, None)
            merged_by_target[survivor[1]] = {
                "floor": survivor[0],
                "polygon": merged,
                "flags": (survivor_state["flags"]
                          | (source_state["flags"] - {resolution["flag"]})),
                "sqft": survivor_state["sqft"] + source_state["sqft"],
            }
            was_remapped = was_remapped or survivor_remapped

        if action != "merge":
            grouped[(floor, source_key)].append(resolution)
        accounting["remapped" if was_remapped else "applied"] += 1

    for source_key in merge_sources:
        del floors[merge_source_floors[source_key]][source_key]
        candidate_flags.pop(source_key, None)
        candidate_meta.pop(source_key, None)
    for target_key, state in merged_by_target.items():
        floors[state["floor"]][target_key] = state["polygon"]
        candidate_flags[target_key] = state["flags"]
        candidate_meta[target_key] = {
            **candidate_meta[target_key],
            "sqft": state["sqft"],
            "vertices": len(state["polygon"].exterior.coords) - 1,
        }
    for floor, key in claimed_residues:
        del residues[floor][key]

    for (floor, target_key), resolutions in grouped.items():
        if target_key not in floors[floor]:
            continue
        accepted = {resolution["flag"] for resolution in resolutions
                    if resolution["action"] == "accept"}
        flags = candidate_flags.pop(target_key, set()) - accepted
        if any(resolution["action"] == "reject" for resolution in resolutions):
            meta = candidate_meta[target_key]
            residues[floor][target_key] = {
                "id": target_key.rsplit(":", 1)[-1], "reason": "rejected",
                "sqft": meta["sqft"], "label": meta["label"],
                "meanCeilingFt": meta["meanCeilingFt"], "polygon": floors[floor][target_key],
                "level": target_key.rsplit(":", 1)[0], "claimed": True,
            }
            del floors[floor][target_key]
            candidate_meta.pop(target_key, None)
            continue
        split = next((resolution for resolution in resolutions
                      if resolution["action"] == "split"), None)
        if split is None:
            candidate_flags[target_key] = flags
            continue
        flags.discard(split["flag"])
        del floors[floor][target_key]
        parent_meta = candidate_meta[target_key]
        del candidate_meta[target_key]
        for suffix, piece in zip(("a", "b"), split_pieces[target_key]):
            child_key = f"{target_key}.{suffix}"
            floors[floor][child_key] = piece
            candidate_flags[child_key] = set(flags)
            candidate_meta[child_key] = {
                "sqft": piece.area,
                "label": [piece.centroid.x, piece.centroid.y],
                "vertices": len(piece.exterior.coords) - 1,
                "level": parent_meta["level"],
            }

    return (floors, candidate_flags, candidate_meta, residues, level_names), {
        "touchesByVerb": dict(sorted(touches.items())), **accounting,
    }


def classify(gt, cands):
    """Failure taxonomy for one GT room against same-floor candidates.
    Returns (cls, iou, best_key, detail)."""
    inters = {}
    for key, c in cands.items():
        a = gt["poly"].intersection(c).area
        if a > 0:
            inters[key] = a
    garea = gt["poly"].area
    covered = (unary_union([cands[k].intersection(gt["poly"]) for k in inters]).area / garea
               if inters else 0.0)
    best_key, best_iou = None, 0.0
    for k, a in inters.items():
        v = a / (garea + cands[k].area - a)
        if v > best_iou:
            best_key, best_iou = k, v
    if covered < MISSING_COVER:
        return "missing", best_iou, best_key, f"covered {covered:.0%}"
    pieces = [k for k, a in inters.items() if a >= FRAG_PIECE * garea]
    if len(pieces) >= 2 and covered >= 0.5:
        return "fragmented", best_iou, best_key, f"{len(pieces)} pieces cover {covered:.0%}"
    return None, best_iou, best_key, f"covered {covered:.0%}"  # merged/1:1 decided by caller


def precision(floors, candidate_flags, gts, excluded):
    levels = {}
    flag_levels = {}
    all_candidates = []
    for fl in sorted(set(floors) | {g["floor"] for g in gts.values()}):
        fl_gts = [(n, g) for n, g in gts.items() if g["floor"] == fl and n not in excluded]
        candidates = []
        for key, cand in floors.get(fl, {}).items():
            area = cand.area
            best_iou, best_gt = 0.0, None
            for number, gt in fl_gts:
                intersection = cand.intersection(gt["poly"]).area
                iou = intersection / (area + gt["poly"].area - intersection)
                if iou > best_iou:
                    best_iou, best_gt = iou, number
            suspect_flags = sorted(flag for flag in candidate_flags[key]
                                   if flag.startswith("suspect:"))
            candidates.append({"candidate": key, "floor": fl, "areaSf": area,
                               "centroid": [round(cand.centroid.x, 2), round(cand.centroid.y, 2)],
                               "bestIoU": best_iou, "bestGt": best_gt,
                               "bestGtName": gts[best_gt]["name"] if best_gt is not None else None,
                               "flags": sorted(candidate_flags[key]),
                               "suspectFlags": suspect_flags})
        all_candidates.extend(candidates)
        levels[fl] = precision_rollup(len(fl_gts), candidates)
        flag_levels[fl] = flag_quality(candidates)
    return {"levels": levels,
            "total": precision_rollup(sum(1 for n in gts if n not in excluded), all_candidates),
            "flagQuality": {"levels": flag_levels, "total": flag_quality(all_candidates)}}


def area_histogram(candidates):
    return {
        "under60": sum(c["areaSf"] < 60 for c in candidates),
        "60to150": sum(60 <= c["areaSf"] <= 150 for c in candidates),
        "over150": sum(c["areaSf"] > 150 for c in candidates),
    }


def flag_quality(candidates):
    flagged = [c for c in candidates if c["suspectFlags"]]
    junk = [c for c in candidates if c["bestIoU"] < JUNK_IOU]
    flagged_junk = [c for c in junk if c["suspectFlags"]]
    small_junk = [c for c in junk if c["areaSf"] < 60]
    flagged_small_junk = [c for c in small_junk if c["suspectFlags"]]
    false_positives = [c for c in flagged if c["bestIoU"] >= JUNK_IOU]
    return {
        "flaggedCandidates": len(flagged),
        "flaggedJunk": len(flagged_junk),
        "precisionPct": round(100 * len(flagged_junk) / len(flagged), 1) if flagged else None,
        "junkUnder60RecallPct": (round(100 * len(flagged_small_junk) / len(small_junk), 1)
                                  if small_junk else None),
        "junkUnder60": len(small_junk),
        "flaggedJunkUnder60": len(flagged_small_junk),
        "unflaggedJunkUnder60": len(small_junk) - len(flagged_small_junk),
        "junkRecallPct": round(100 * len(flagged_junk) / len(junk), 1) if junk else None,
        "falsePositiveCount": len(false_positives),
        "falsePositiveCandidates": false_positives,
    }


def precision_rollup(gt_count, candidates):
    junk = [c for c in candidates if c["bestIoU"] < JUNK_IOU]
    flagged_junk = [c for c in junk if c["flags"]]
    unflagged_junk = [c for c in junk if not c["flags"]]
    return {
        "gtRooms": gt_count,
        "candidates": len(candidates),
        "candidateGtRatio": round(len(candidates) / gt_count, 2) if gt_count else None,
        "matchedCandidatePct": round(100 * (len(candidates) - len(junk)) / len(candidates), 1)
                               if candidates else 0.0,
        "junkCount": len(junk),
        "junkAreaSf": round(sum(c["areaSf"] for c in junk), 1),
        "junkAreaHistogram": area_histogram(junk),
        "flaggedJunkCount": len(flagged_junk),
        "unflaggedJunkCount": len(unflagged_junk),
        "flaggedJunkAreaHistogram": area_histogram(flagged_junk),
        "unflaggedJunkAreaHistogram": area_histogram(unflagged_junk),
        "junkCandidates": junk,
        "worstJunkByArea": sorted(junk, key=lambda c: (-c["areaSf"], c["candidate"]))[:10],
    }


def gates(precision_out, totals):
    ratio_levels = {fl: (l["candidates"] == 0 if not l["gtRooms"]
                         else l["candidates"] / l["gtRooms"] <= GATE_COUNT_RATIO_MAX)
                    for fl, l in precision_out["levels"].items()}
    ok = totals["taxonomy"].get("ok", 0)
    taxonomy_fraction = ok / totals["gtRooms"] if totals["gtRooms"] else 0.0
    junk_under_60 = precision_out["total"]["junkAreaHistogram"]["under60"]
    unflagged_junk_under_60 = precision_out["total"]["unflaggedJunkAreaHistogram"]["under60"]
    flag_quality = precision_out["flagQuality"]["total"]
    junk_without_suspect = flag_quality["unflaggedJunkUnder60"]
    suspect_precision = (flag_quality["flaggedJunk"] / flag_quality["flaggedCandidates"]
                         if flag_quality["flaggedCandidates"] else 0)
    wall_fraction = ((totals["gateWallRecallPct"] or 0) / 100)
    checks = {
        "candidateGtRatioPerLevel": {
            "passed": all(ratio_levels.values()), "levels": ratio_levels,
            "limit": GATE_COUNT_RATIO_MAX,
        },
        "taxonomyOk": {"passed": taxonomy_fraction >= GATE_TAXONOMY_OK_MIN,
                       "actualPct": round(100 * taxonomy_fraction, 1),
                       "minimumPct": 100 * GATE_TAXONOMY_OK_MIN},
        "zeroJunkUnder60Sf": {"passed": junk_under_60 <= GATE_JUNK_UNDER_60_MAX,
                              "actual": junk_under_60,
                              "maximum": GATE_JUNK_UNDER_60_MAX},
        "unflaggedJunkUnder60Sf": {
            "passed": unflagged_junk_under_60 <= GATE_UNFLAGGED_JUNK_UNDER_60_MAX,
            "actual": unflagged_junk_under_60,
            "maximum": GATE_UNFLAGGED_JUNK_UNDER_60_MAX,
        },
        "junkWithoutSuspectFlagUnder60Sf": {
            "passed": junk_without_suspect <= GATE_UNFLAGGED_JUNK_UNDER_60_MAX,
            "actual": junk_without_suspect,
            "maximum": GATE_UNFLAGGED_JUNK_UNDER_60_MAX,
        },
        "suspectFlagPrecision": {
            "passed": suspect_precision >= GATE_SUSPECT_PRECISION_MIN,
            "actualPct": round(100 * suspect_precision, 1),
            "minimumPct": 100 * GATE_SUSPECT_PRECISION_MIN,
        },
        "suspectFalsePositives": {
            "passed": flag_quality["falsePositiveCount"] <= GATE_SUSPECT_FALSE_POSITIVE_MAX,
            "actual": flag_quality["falsePositiveCount"],
            "maximum": GATE_SUSPECT_FALSE_POSITIVE_MAX,
        },
        "wallRecall": {"passed": wall_fraction >= GATE_WALL_RECALL_MIN,
                       "actualPct": totals["gateWallRecallPct"],
                       "minimumPct": 100 * GATE_WALL_RECALL_MIN,
                       "toleranceFt": WALL_TOL_FT},
    }
    return {"passed": all(c["passed"] for c in checks.values()), "checks": checks}


def score(takeoff_dir, geo, stale, wall_tol=WALL_TOL_FT, takeoff=None):
    floors, candidate_flags, candidate_meta, residues, level_names = takeoff or load_takeoff(takeoff_dir)
    excluded = {e["number"]: e.get("reason", "") for e in stale.get("exclude", [])}
    gts = {}
    for num, g in geo["rooms"].items():
        pg = Polygon(g["polygonModelFt"])
        if not pg.is_valid:
            pg = pg.buffer(0)
        gts[int(num)] = {**g, "poly": pg}

    # candidate -> GT major coverage (for "merged"), computed per floor
    merged_gts = set()
    merges = {}  # cand key -> [gt numbers]
    for fl in sorted({g["floor"] for g in gts.values()}):
        fl_gts = {n: g for n, g in gts.items() if g["floor"] == fl and n not in excluded}
        for key, c in floors.get(fl, {}).items():
            major = [n for n, g in fl_gts.items()
                     if g["poly"].intersection(c).area >= MERGE_COVER * g["poly"].area]
            if len(major) >= 2:
                merges[key] = sorted(major)
                merged_gts.update(major)

    rooms_out = {}
    for num in sorted(gts):
        g = gts[num]
        if num in excluded:
            rooms_out[num] = {**{k: g[k] for k in ("name", "floor", "confidence")},
                              "class": "stale-excluded", "iou": None, "detail": excluded[num]}
            continue
        cands = floors.get(g["floor"], {})
        cls, iou, best_key, detail = classify(g, cands)
        if cls is None:
            if num in merged_gts:
                cls = "merged"
                mk = next(k for k, v in merges.items() if num in v)
                detail = f"{mk.split(':')[-1]} spans #" + ",#".join(map(str, merges[mk]))
            elif iou >= IOU_OK:
                cls = "ok"
            else:
                cls = "shape-poor"
        rooms_out[num] = {"name": g["name"], "floor": g["floor"], "confidence": g["confidence"],
                          "class": cls, "iou": round(iou, 3), "bestCandidate": best_key,
                          "detail": detail, "vintage": g.get("vintage")}

    # per-level rollups: IoU means + area coverage/over-detection + wall recall
    levels_out = {}
    gate_walls_recalled = gate_walls_total = 0
    walls_by_floor = defaultdict(list)
    for w in geo.get("walls", []):
        if isinstance(w["floor"], int):
            walls_by_floor[w["floor"]].append(w)
    for fl in sorted(floors):
        fl_rooms = [r for r in rooms_out.values()
                    if r["floor"] == fl and r["class"] != "stale-excluded"]
        fl_gt_polys = [gts[n]["poly"] for n, r in rooms_out.items()
                       if r["floor"] == fl and r["class"] != "stale-excluded"]
        cand_polys = list(floors[fl].values())
        gt_union = unary_union(fl_gt_polys) if fl_gt_polys else None
        cand_union = unary_union(cand_polys) if cand_polys else None
        cov = over = None
        if gt_union is not None and cand_union is not None:
            cov = gt_union.intersection(cand_union).area / gt_union.area
            over = (cand_union.area - cand_union.intersection(gt_union).area) / cand_union.area
        elif cand_union is not None:
            over = 1.0
        # wall lane
        recalled = total = 0
        boundary = unary_union([p.exterior for p in cand_polys]) if cand_polys else None
        for w in walls_by_floor.get(fl, []):
            ls = LineString(w["pointsModelFt"])
            if ls.length <= 0 or boundary is None:
                continue
            n = max(3, int(ls.length // 2) + 1)
            distances = [boundary.distance(ls.interpolate(i / (n - 1), normalized=True))
                         for i in range(n)]
            hits = sum(distance <= wall_tol for distance in distances)
            total += 1
            recalled += hits / n >= WALL_HIT_FRAC
            gate_walls_total += 1
            gate_walls_recalled += (sum(distance <= WALL_TOL_FT for distance in distances) / n
                                    >= WALL_HIT_FRAC)
        ious = [r["iou"] for r in fl_rooms]
        taxo = defaultdict(int)
        for r in fl_rooms:
            taxo[r["class"]] += 1
        levels_out[fl] = {
            "gtRooms": len(fl_rooms), "candidates": len(cand_polys),
            "meanIoU": round(sum(ious) / len(ious), 3) if ious else None,
            "gtAreaCoveredPct": round(100 * cov, 1) if cov is not None else None,
            "candAreaOutsideGtPct": round(100 * over, 1) if over is not None else None,
            "wallsRecalled": recalled, "wallsTotal": total,
            "wallRecallPct": round(100 * recalled / total, 1) if total else None,
            "taxonomy": dict(taxo),
        }

    scored = [r for r in rooms_out.values() if r["class"] != "stale-excluded"]
    hi = [r for r in scored if r["confidence"] == "high"]
    taxo = defaultdict(int)
    for r in scored:
        taxo[r["class"]] += 1
    walls_recalled = sum(l["wallsRecalled"] for l in levels_out.values())
    walls_total = sum(l["wallsTotal"] for l in levels_out.values())
    totals = {
        "totalScore": round(100 * sum(r["iou"] for r in scored) / len(scored), 1) if scored else 0,
        "highConfScore": round(100 * sum(r["iou"] for r in hi) / len(hi), 1) if hi else None,
        "gtRooms": len(scored), "highConfRooms": len(hi),
        "staleExcluded": len(excluded),
        "taxonomy": dict(taxo),
        "wallRecallPct": round(100 * walls_recalled / walls_total, 1) if walls_total else None,
        "gateWallRecallPct": (round(100 * gate_walls_recalled / gate_walls_total, 1)
                              if gate_walls_total else None),
        "wallsTotal": walls_total,
        "wallTolFt": wall_tol,
    }
    precision_out = precision(floors, candidate_flags, gts, excluded)
    residue_census = defaultdict(lambda: {
        "count": 0, "sqft": 0.0, "claimed": 0, "claimedSqft": 0.0,
        "unclaimed": 0, "unclaimedSqft": 0.0,
    })
    for level in level_names.values():
        residue_census[level]
    for values in residues.values():
        for residue in values.values():
            residue_census[residue["level"]]["count"] += 1
            residue_census[residue["level"]]["sqft"] += residue["sqft"]
            state = "claimed" if residue.get("claimed") else "unclaimed"
            residue_census[residue["level"]][state] += 1
            residue_census[residue["level"]][f"{state}Sqft"] += residue["sqft"]
    return {"takeoffDir": os.path.relpath(takeoff_dir, HERE).replace("\\", "/"),
            "totals": totals, "levels": levels_out,
            "straightness": straightness(candidate_meta, candidate_flags),
            "precision": precision_out, "gates": gates(precision_out, totals),
            "residue": {level: {key: round(number, 1) if key.endswith("Sqft") or key == "sqft" else number
                                for key, number in value.items()}
                        for level, value in sorted(residue_census.items())},
            "rooms": {str(n): rooms_out[n] for n in sorted(rooms_out)}}


def clean_status(before, after, resolved_takeoff, sidecar):
    """Phase-5 touches-to-clean status for every level touched by the sidecar."""
    floors, candidate_flags, candidate_meta, residues, level_names = resolved_takeoff
    level_floor = {level: floor for floor, level in level_names.items()}
    for floor, candidates in floors.items():
        for key in candidates:
            level_floor[key.rsplit(":", 1)[0]] = floor
    for floor, values in residues.items():
        for residue in values.values():
            level_floor[residue["level"]] = floor
    touched = sorted({resolution["candidateKey"].rsplit(":", 1)[0]
                      for resolution in sidecar["resolutions"]})
    output = {}
    for level in touched:
        floor = level_floor.get(level)
        if floor is None:
            continue
        pending = sum(len(flags) for key, flags in candidate_flags.items()
                      if key.rsplit(":", 1)[0] == level)
        unclaimed = after["residue"].get(level, {"unclaimed": 0})["unclaimed"]
        ratio = after["precision"]["levels"].get(floor, {}).get("candidateGtRatio")
        before_level = before["levels"].get(floor, {})
        after_level = after["levels"].get(floor, {})
        before_score = before_level.get("meanIoU")
        after_score = after_level.get("meanIoU")
        score_delta = (round(100 * (after_score - before_score), 1)
                       if before_score is not None and after_score is not None else None)
        before_missing = before_level.get("taxonomy", {}).get("missing", 0)
        after_missing = after_level.get("taxonomy", {}).get("missing", 0)
        missing_delta = after_missing - before_missing
        blockers = []
        if pending:
            blockers.append(f"{pending} pending flags")
        if unclaimed:
            blockers.append(f"{unclaimed} unclaimed residue")
        if ratio is None or ratio > GATE_COUNT_RATIO_MAX:
            blockers.append(f"candidate/GT {ratio} > {GATE_COUNT_RATIO_MAX}")
        if score_delta is None or score_delta < 0:
            blockers.append(f"score delta {score_delta}")
        if missing_delta > 0:
            blockers.append(f"taxonomy missing +{missing_delta}")
        touches = sum(1 for resolution in sidecar["resolutions"]
                      if resolution["candidateKey"].rsplit(":", 1)[0] == level)
        output[level] = {
            "clean": not blockers,
            "touchesToClean": touches if not blockers else None,
            "blockingReasons": blockers,
            "pendingFlags": pending,
            "unclaimedResidue": unclaimed,
            "candidateGtRatio": ratio,
            "ratioLimit": GATE_COUNT_RATIO_MAX,
            "scoreDelta": score_delta,
            "taxonomyMissingDelta": missing_delta,
        }
    return output


CLS_MARK = {"ok": "ok  ", "shape-poor": "POOR", "fragmented": "FRAG", "merged": "MERG",
            "missing": "MISS", "stale-excluded": "stal"}


def to_text(sb):
    t, L = sb["totals"], sb["levels"]
    out = [f"TAKEOFF SCOREBOARD  ({sb['takeoffDir']})",
           f"TOTAL SCORE {t['totalScore']:.1f}  (mean IoU x100 over {t['gtRooms']} GT rooms; "
           f"high-conf {t['highConfScore']} over {t['highConfRooms']}; "
           f"{t['staleExcluded']} stale-excluded)",
           f"taxonomy    " + "  ".join(f"{k}:{v}" for k, v in sorted(t["taxonomy"].items())),
           f"wall recall {t['wallRecallPct']}% of {t['wallsTotal']} mined wall lines "
           f"(tol {t['wallTolFt']} ft)", ""]
    out.append(f"{'floor':>5} {'gt':>3} {'cand':>4} {'mIoU':>6} {'cover%':>6} {'over%':>6} "
               f"{'wall%':>6}  taxonomy")
    for fl, l in sorted(L.items()):
        tx = " ".join(f"{k}:{v}" for k, v in sorted(l["taxonomy"].items()))
        out.append(f"{fl:>5} {l['gtRooms']:>3} {l['candidates']:>4} "
                   f"{l['meanIoU'] if l['meanIoU'] is not None else '-':>6} "
                   f"{l['gtAreaCoveredPct'] if l['gtAreaCoveredPct'] is not None else '-':>6} "
                   f"{l['candAreaOutsideGtPct'] if l['candAreaOutsideGtPct'] is not None else '-':>6} "
                   f"{l['wallRecallPct'] if l['wallRecallPct'] is not None else '-':>6}  {tx}")
    out.extend(["", "STRAIGHTNESS  (report only)",
                f"{'level':<26} {'rooms':>5} {'mean v':>7} {'median':>7} {'<=12%':>7} {'unreg%':>7}"])
    for level, metrics in sb["straightness"].items():
        out.append(f"{level:<26} {metrics['rooms']:>5} {metrics['meanVertices']:>7.1f} "
                   f"{metrics['medianVertices']:>7.1f} {metrics['roomsLe12Pct']:>7.1f} "
                   f"{metrics['unregularizedPct']:>7.1f}")
    out.extend(["", f"PRECISION  (candidate best same-floor GT IoU; matched >= {JUNK_IOU:.2f})",
                f"{'floor':>5} {'gt':>3} {'cand':>4} {'ratio':>5} {'match%':>6} "
                f"{'junk':>4} {'flag':>4} {'unfl':>4} {'junk sf':>8} {'<60':>4} {'60-150':>6} {'>150':>5}"])
    precision_levels = list(sorted(sb["precision"]["levels"].items())) + [("TOTAL", sb["precision"]["total"])]
    for fl, p in precision_levels:
        h = p["junkAreaHistogram"]
        ratio = (f"{p['candidateGtRatio']:.2f}" if p["candidateGtRatio"] is not None
                 else ("inf" if p["candidates"] else "-"))
        out.append(f"{str(fl):>5} {p['gtRooms']:>3} {p['candidates']:>4} {ratio:>5} "
                   f"{p['matchedCandidatePct']:>6.1f} {p['junkCount']:>4} "
                   f"{p['flaggedJunkCount']:>4} {p['unflaggedJunkCount']:>4} {p['junkAreaSf']:>8.1f} "
                   f"{h['under60']:>4} {h['60to150']:>6} {h['over150']:>5}")
    for fl, p in precision_levels:
        out.append(f"worst junk by area ({'total' if fl == 'TOTAL' else f'L{fl}'}):")
        for c in p["worstJunkByArea"]:
            out.append(f"  L{c['floor']} {c['candidate']:<38} {c['areaSf']:>8.1f} sf  "
                       f"centroid ({c['centroid'][0]:.2f}, {c['centroid'][1]:.2f})  "
                       f"best IoU {c['bestIoU']:.3f}")

    def pct(value):
        return f"{value:.1f}" if value is not None else "-"

    out.extend(["", f"SUSPECT FLAGS  (junk truth: best IoU < {JUNK_IOU:.2f})",
                f"{'floor':>5} {'flagged':>7} {'junk':>4} {'prec%':>6} "
                f"{'<60rec%':>8} {'allrec%':>7} {'false+':>6}"])
    flag_levels = list(sorted(sb["precision"]["flagQuality"]["levels"].items())) + [
        ("TOTAL", sb["precision"]["flagQuality"]["total"])]
    for fl, quality in flag_levels:
        out.append(f"{str(fl):>5} {quality['flaggedCandidates']:>7} {quality['flaggedJunk']:>4} "
                   f"{pct(quality['precisionPct']):>6} {pct(quality['junkUnder60RecallPct']):>8} "
                   f"{pct(quality['junkRecallPct']):>7} {quality['falsePositiveCount']:>6}")
    out.append("suspect-flag false positives (matched candidates):")
    for candidate in sb["precision"]["flagQuality"]["total"]["falsePositiveCandidates"]:
        out.append(f"  {candidate['candidate']}  {candidate['areaSf']:.1f} sf  "
                   f"best GT #{candidate['bestGt']} {candidate['bestGtName']}  "
                   f"IoU {candidate['bestIoU']:.3f}  {','.join(candidate['suspectFlags'])}")

    g = sb["gates"]
    ratio_gate = g["checks"]["candidateGtRatioPerLevel"]
    ratio_detail = "  ".join(
        f"L{fl} {p['candidateGtRatio'] if p['candidateGtRatio'] is not None else ('inf' if p['candidates'] else '-')} "
        f"{'PASS' if ratio_gate['levels'][fl] else 'FAIL'}"
        for fl, p in sorted(sb["precision"]["levels"].items()))
    tax = g["checks"]["taxonomyOk"]
    junk = g["checks"]["zeroJunkUnder60Sf"]
    unflagged_junk = g["checks"]["unflaggedJunkUnder60Sf"]
    junk_without_suspect = g["checks"]["junkWithoutSuspectFlagUnder60Sf"]
    suspect_precision = g["checks"]["suspectFlagPrecision"]
    suspect_false_positives = g["checks"]["suspectFalsePositives"]
    wall = g["checks"]["wallRecall"]
    out.extend(["", "GATES  (absolute; --gate exits nonzero on failure)",
                f"{'PASS' if ratio_gate['passed'] else 'FAIL'} candidate/GT <= {ratio_gate['limit']:.1f} per level: {ratio_detail}",
                f"{'PASS' if tax['passed'] else 'FAIL'} taxonomy ok >= {tax['minimumPct']:.0f}% of GT rooms: {tax['actualPct']:.1f}%",
                f"{'PASS' if junk['passed'] else 'FAIL'} zero junk candidates <60 sf: {junk['actual']}",
                f"{'PASS' if unflagged_junk['passed'] else 'FAIL'} unflagged junk candidates <60 sf <= {unflagged_junk['maximum']}: {unflagged_junk['actual']}",
                f"{'PASS' if junk_without_suspect['passed'] else 'FAIL'} junk without suspect flag <60 sf <= {junk_without_suspect['maximum']}: {junk_without_suspect['actual']}",
                f"{'PASS' if suspect_precision['passed'] else 'FAIL'} suspect precision >= {suspect_precision['minimumPct']:.0f}%: {suspect_precision['actualPct']:.1f}%",
                f"{'PASS' if suspect_false_positives['passed'] else 'FAIL'} suspect false positives <= {suspect_false_positives['maximum']}: {suspect_false_positives['actual']}",
                f"{'PASS' if wall['passed'] else 'FAIL'} wall recall >= {wall['minimumPct']:.0f}% at {wall['toleranceFt']:.1f} ft: "
                f"{wall['actualPct'] if wall['actualPct'] is not None else '-'}%",
                f"OVERALL {'PASS' if g['passed'] else 'FAIL'}"])
    out.append("")
    out.append("RESIDUE")
    for level, census in sb["residue"].items():
        out.append(f"{level}: {census['count']} total  {census['sqft']} sf  "
                   f"claimed {census['claimed']}  unclaimed {census['unclaimed']}")
    out.append("")
    if "resolutions" in sb:
        r = sb["resolutions"]
        out.extend([
            "RESOLUTIONS",
            "touches " + "  ".join(f"{verb}:{count}" for verb, count in r["touchesByVerb"].items()),
            f"applied {r['applied']}  remapped {r['remapped']}  orphaned {r['orphaned']}",
            f"before ratio {r['before']['candidateGtRatio']}  score {r['before']['totalScore']}",
            f"after  ratio {r['after']['candidateGtRatio']}  score {r['after']['totalScore']}",
        ])
        for level, census in r["residueCensus"].items():
            out.append(f"residue {level}: {census['count']} total  {census['sqft']} sf  "
                       f"claimed {census['claimed']}  unclaimed {census['unclaimed']}")
        for level, status in r["cleanStatus"].items():
            verdict = (f"CLEAN — touches-to-clean {status['touchesToClean']}" if status["clean"]
                       else "NOT CLEAN — " + "; ".join(status["blockingReasons"]))
            out.append(f"CLEAN {level}: {verdict}; pending={status['pendingFlags']} "
                       f"residue={status['unclaimedResidue']} ratio={status['candidateGtRatio']} "
                       f"scoreΔ={status['scoreDelta']} missingΔ={status['taxonomyMissingDelta']}")
        out.append("")
    out.append("per-room (sorted by oracle number; * = non-high confidence ground truth):")
    for n, r in sb["rooms"].items():
        conf = " " if r["confidence"] == "high" else "*"
        iou = f"{r['iou']:.3f}" if r["iou"] is not None else "  -  "
        out.append(f"  #{n:>3}{conf}{CLS_MARK[r['class']]} {iou} L{r['floor']} "
                   f"{r['name'][:34]:<34} {r.get('detail', '')}")
    return "\n".join(out) + "\n"


def overlay_jobs(takeoff_dir, project, ink_dir):
    jobs = []
    for name in sorted(f for f in os.listdir(takeoff_dir)
                       if f.startswith("rooms_") and f.endswith(".tsv")):
        slug = name[len("rooms_"):-len(".tsv")]
        tsv_path = os.path.join(takeoff_dir, name)
        level = next(line.rstrip("\n").split("\t")[2]
                     for line in open(tsv_path, encoding="utf-8") if line.startswith("META\tlevel\t"))
        ink_path = os.path.join(ink_dir, f"ink_{slug}.bin") if ink_dir else None
        if not ink_path or not os.path.exists(ink_path):
            raise SystemExit(f"overlay ink missing for {slug}; pass --ink-dir")
        jobs.append((level, ink_path, tsv_path, os.path.join(project, f"overlay_{slug}.png")))
    return jobs


def render_overlays(scoreboard, jobs):
    junk = {c["candidate"] for level in scoreboard["precision"]["levels"].values()
            for c in level["junkCandidates"]}
    for level, ink_path, tsv_path, out_path in jobs:
        overlay.render(ink_path, tsv_path, out_path,
                       scale=2, thumb=None,
                       junk_ids={key.rsplit(":", 1)[1] for key in junk
                                 if key.startswith(f"{level}:")}, quiet=True)


def write_room_map(sb, geo, iou_min, project):
    """Regenerate room-map.json: keep curated matches + skips, add mutual-best IoU pairs."""
    path = os.path.join(project, "room-map.json")
    cur = json.load(open(path)) if os.path.exists(path) else {"matches": [], "skip": []}
    # regenerate: keep human-curated entries, drop previous auto-iou (their candidate ids bind to
    # whatever snapshot produced them; fresh autos below re-derive against the scored takeoff)
    kept = [m for m in cur["matches"] if m.get("provenance", "curated") != "auto-iou"]
    curated_oracle = {m["oracleNumber"] for m in kept}
    curated_cand = {m["candidate"] for m in kept}
    skips = {s["oracleNumber"] for s in cur["skip"]}
    # mutual-best check: candidate's best GT must be this room too
    best_gt_for_cand = {}
    for n, r in sb["rooms"].items():
        k, v = r.get("bestCandidate"), r.get("iou")
        if k and v and (k not in best_gt_for_cand or v > best_gt_for_cand[k][1]):
            best_gt_for_cand[k] = (int(n), v)
    auto = []
    for n, r in sb["rooms"].items():
        n = int(n)
        if (r.get("iou") or 0) < iou_min or r["class"] not in ("ok", "shape-poor"):
            continue
        if r["confidence"] not in ("high", "medium"):
            continue  # ambiguous-area-twin GT identity (cookie-cutter rooms) stays out of the map
        k = r["bestCandidate"]
        if n in curated_oracle or n in skips or k in curated_cand:
            continue
        if best_gt_for_cand.get(k, (None,))[0] != n:
            continue
        auto.append({"oracleNumber": n, "candidate": k, "provenance": "auto-iou",
                     "iou": r["iou"], "gtConfidence": r["confidence"]})
    matches = [{**m, "provenance": m.get("provenance", "curated")} for m in kept]
    matches += sorted(auto, key=lambda m: m["oracleNumber"])
    doc = {"matches": matches, "skip": cur["skip"]}
    json.dump(doc, open(path, "w"), indent=1)
    return len(auto)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--project", default=projectA,
                    help="project directory containing takeoff/ and oracle-geometry.json")
    ap.add_argument("--takeoff-dir", default=None)
    ap.add_argument("--geo", default=None)
    ap.add_argument("--stale", default=None)
    ap.add_argument("--write-room-map", action="store_true",
                    help="regenerate PROJECT/room-map.json with auto-iou matches")
    ap.add_argument("--iou-min", type=float, default=0.5,
                    help="mutual-best IoU threshold for --write-room-map")
    ap.add_argument("--wall-tol", type=float, default=WALL_TOL_FT,
                    help="wall-recall distance tolerance in feet")
    ap.add_argument("--ink-dir", default=overlay.LIVE,
                    help="directory containing ink_<level>.bin for automatic overlays")
    ap.add_argument("--gate", action="store_true", help="exit nonzero when an absolute gate fails")
    ap.add_argument("--resolutions", default=None,
                    help="apply takeoff-resolutions.json decisions before scoring")
    ap.add_argument("--quiet", action="store_true")
    a = ap.parse_args()

    project = os.path.abspath(a.project)
    takeoff_dir = a.takeoff_dir or os.path.join(project, "takeoff")
    geo_path = a.geo or os.path.join(project, "oracle-geometry.json")
    stale_path = a.stale or os.path.join(project, "stale-rooms.json")
    geo = json.load(open(geo_path))
    stale = json.load(open(stale_path)) if os.path.exists(stale_path) else {"exclude": []}
    takeoff = load_takeoff(takeoff_dir)
    before = score(takeoff_dir, geo, stale, a.wall_tol, takeoff)
    if a.resolutions:
        sidecar = json.load(open(a.resolutions, encoding="utf-8"))
        resolved, accounting = apply_resolutions(takeoff, sidecar)
        sb = score(takeoff_dir, geo, stale, a.wall_tol, resolved)
        sb["resolutions"] = {
            **accounting,
            "before": {
                "candidateGtRatio": before["precision"]["total"]["candidateGtRatio"],
                "totalScore": before["totals"]["totalScore"],
            },
            "after": {
                "candidateGtRatio": sb["precision"]["total"]["candidateGtRatio"],
                "totalScore": sb["totals"]["totalScore"],
            },
            "residueCensus": {
                level: {
                    "count": (sb["residue"].get(level, {}).get("count", 0)
                              + max(0, before["residue"].get(level, {}).get("unclaimed", 0)
                                    - sb["residue"].get(level, {}).get("unclaimed", 0))),
                    "sqft": round(sb["residue"].get(level, {}).get("sqft", 0)
                                  + max(0, before["residue"].get(level, {}).get("unclaimedSqft", 0)
                                        - sb["residue"].get(level, {}).get("unclaimedSqft", 0)), 1),
                    "claimed": (sb["residue"].get(level, {}).get("claimed", 0)
                                + max(0, before["residue"].get(level, {}).get("unclaimed", 0)
                                      - sb["residue"].get(level, {}).get("unclaimed", 0))),
                    "unclaimed": sb["residue"].get(level, {}).get("unclaimed", 0),
                }
                for level in sorted(set(before["residue"]) | set(sb["residue"]))
            },
            "cleanStatus": clean_status(before, sb, resolved, sidecar),
        }
    else:
        sb = before
    if os.path.abspath(takeoff_dir) == os.path.join(projectA, "takeoff"):
        game_room = sb["rooms"]["4"]
        assert (game_room["bestCandidate"] == "Level 0/Lower Level:R03"
                and game_room["iou"] >= 0.55), "project-a registration self-check failed"
    jobs = overlay_jobs(takeoff_dir, project, a.ink_dir)
    text = to_text(sb)
    json.dump(sb, open(os.path.join(project, "scoreboard.json"), "w"), indent=1)
    open(os.path.join(project, "scoreboard.txt"), "w", encoding="utf-8").write(text)
    render_overlays(sb, jobs)
    if not a.quiet:
        print(text, end="")
    if a.write_room_map:
        n = write_room_map(sb, geo, a.iou_min, project)
        print(f"room-map.json: +{n} auto-iou matches (mutual-best IoU >= {a.iou_min})")
    if a.gate and not sb["gates"]["passed"]:
        sys.exit(1)


if __name__ == "__main__":
    main()
