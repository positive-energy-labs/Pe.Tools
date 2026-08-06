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
import argparse, json, math, os, re, sys
from collections import defaultdict

import overlay
from shapely.geometry import LineString, Polygon
from shapely.ops import unary_union

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
GATE_WALL_RECALL_MIN = 0.8    # mined walls recalled at WALL_TOL_FT


def load_takeoff(takeoff_dir):
    """{floor: {'Level 0/Lower Level:R01': Polygon}} — floor parsed from the META level name."""
    floors = defaultdict(dict)
    loaded = []
    for f in sorted(os.listdir(takeoff_dir)):
        if not (f.startswith("rooms_") and f.endswith(".tsv")):
            continue
        level, elevation, polys = None, None, defaultdict(list)
        for line in open(os.path.join(takeoff_dir, f), encoding="utf-8"):
            p = line.rstrip("\n").split("\t")
            if p[0] == "META" and p[1] == "level":
                level = p[2].strip()
            elif p[0] == "META" and p[1] == "elev":
                elevation = float(p[2])
            elif p[0] == "POLY" and p[2] == "outer":
                polys[p[1]].append([tuple(map(float, q.split(";"))) for q in p[3].split("|")])
        if level is None or elevation is None:
            raise SystemExit(f"{f}: no META level/elev line")
        loaded.append((level, elevation, polys))
    elevations = sorted({elevation for _, elevation, _ in loaded})
    for level, elevation, polys in loaded:
        match = re.search(r"Level\s+(\d+)", level, re.I)
        floor = int(match.group(1)) if match else elevations.index(elevation)
        for rid, loops in polys.items():
            pg = Polygon(loops[0])
            if not pg.is_valid:
                pg = pg.buffer(0)
            if pg.area > 0:
                floors[floor][f"{level}:{rid}"] = pg
    return floors


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


def precision(floors, gts, excluded):
    levels = {}
    all_candidates = []
    for fl in sorted(set(floors) | {g["floor"] for g in gts.values()}):
        fl_gts = [g["poly"] for n, g in gts.items() if g["floor"] == fl and n not in excluded]
        candidates = []
        for key, cand in floors.get(fl, {}).items():
            area = cand.area
            best_iou = 0.0
            for gt in fl_gts:
                intersection = cand.intersection(gt).area
                best_iou = max(best_iou, intersection / (area + gt.area - intersection))
            candidates.append({"candidate": key, "floor": fl, "areaSf": area,
                               "centroid": [round(cand.centroid.x, 2), round(cand.centroid.y, 2)],
                               "bestIoU": best_iou})
        all_candidates.extend(candidates)
        levels[fl] = precision_rollup(len(fl_gts), candidates)
    return {"levels": levels,
            "total": precision_rollup(sum(1 for n in gts if n not in excluded), all_candidates)}


def precision_rollup(gt_count, candidates):
    junk = [c for c in candidates if c["bestIoU"] < JUNK_IOU]
    histogram = {
        "under60": sum(c["areaSf"] < 60 for c in junk),
        "60to150": sum(60 <= c["areaSf"] <= 150 for c in junk),
        "over150": sum(c["areaSf"] > 150 for c in junk),
    }
    return {
        "gtRooms": gt_count,
        "candidates": len(candidates),
        "candidateGtRatio": round(len(candidates) / gt_count, 2) if gt_count else None,
        "matchedCandidatePct": round(100 * (len(candidates) - len(junk)) / len(candidates), 1)
                               if candidates else 0.0,
        "junkCount": len(junk),
        "junkAreaSf": round(sum(c["areaSf"] for c in junk), 1),
        "junkAreaHistogram": histogram,
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
        "wallRecall": {"passed": wall_fraction >= GATE_WALL_RECALL_MIN,
                       "actualPct": totals["gateWallRecallPct"],
                       "minimumPct": 100 * GATE_WALL_RECALL_MIN,
                       "toleranceFt": WALL_TOL_FT},
    }
    return {"passed": all(c["passed"] for c in checks.values()), "checks": checks}


def score(takeoff_dir, geo, stale, wall_tol=WALL_TOL_FT):
    floors = load_takeoff(takeoff_dir)
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
    precision_out = precision(floors, gts, excluded)
    return {"takeoffDir": os.path.relpath(takeoff_dir, HERE).replace("\\", "/"),
            "totals": totals, "levels": levels_out,
            "precision": precision_out, "gates": gates(precision_out, totals),
            "rooms": {str(n): rooms_out[n] for n in sorted(rooms_out)}}


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
    out.extend(["", f"PRECISION  (candidate best same-floor GT IoU; matched >= {JUNK_IOU:.2f})",
                f"{'floor':>5} {'gt':>3} {'cand':>4} {'ratio':>5} {'match%':>6} "
                f"{'junk':>4} {'junk sf':>8} {'<60':>4} {'60-150':>6} {'>150':>5}"])
    precision_levels = list(sorted(sb["precision"]["levels"].items())) + [("TOTAL", sb["precision"]["total"])]
    for fl, p in precision_levels:
        h = p["junkAreaHistogram"]
        ratio = (f"{p['candidateGtRatio']:.2f}" if p["candidateGtRatio"] is not None
                 else ("inf" if p["candidates"] else "-"))
        out.append(f"{str(fl):>5} {p['gtRooms']:>3} {p['candidates']:>4} {ratio:>5} "
                   f"{p['matchedCandidatePct']:>6.1f} {p['junkCount']:>4} {p['junkAreaSf']:>8.1f} "
                   f"{h['under60']:>4} {h['60to150']:>6} {h['over150']:>5}")
    for fl, p in precision_levels:
        out.append(f"worst junk by area ({'total' if fl == 'TOTAL' else f'L{fl}'}):")
        for c in p["worstJunkByArea"]:
            out.append(f"  L{c['floor']} {c['candidate']:<38} {c['areaSf']:>8.1f} sf  "
                       f"centroid ({c['centroid'][0]:.2f}, {c['centroid'][1]:.2f})  "
                       f"best IoU {c['bestIoU']:.3f}")

    g = sb["gates"]
    ratio_gate = g["checks"]["candidateGtRatioPerLevel"]
    ratio_detail = "  ".join(
        f"L{fl} {p['candidateGtRatio'] if p['candidateGtRatio'] is not None else ('inf' if p['candidates'] else '-')} "
        f"{'PASS' if ratio_gate['levels'][fl] else 'FAIL'}"
        for fl, p in sorted(sb["precision"]["levels"].items()))
    tax = g["checks"]["taxonomyOk"]
    junk = g["checks"]["zeroJunkUnder60Sf"]
    wall = g["checks"]["wallRecall"]
    out.extend(["", "GATES  (absolute; --gate exits nonzero on failure)",
                f"{'PASS' if ratio_gate['passed'] else 'FAIL'} candidate/GT <= {ratio_gate['limit']:.1f} per level: {ratio_detail}",
                f"{'PASS' if tax['passed'] else 'FAIL'} taxonomy ok >= {tax['minimumPct']:.0f}% of GT rooms: {tax['actualPct']:.1f}%",
                f"{'PASS' if junk['passed'] else 'FAIL'} zero junk candidates <60 sf: {junk['actual']}",
                f"{'PASS' if wall['passed'] else 'FAIL'} wall recall >= {wall['minimumPct']:.0f}% at {wall['toleranceFt']:.1f} ft: "
                f"{wall['actualPct'] if wall['actualPct'] is not None else '-'}%",
                f"OVERALL {'PASS' if g['passed'] else 'FAIL'}"])
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
    ap.add_argument("--quiet", action="store_true")
    a = ap.parse_args()

    project = os.path.abspath(a.project)
    takeoff_dir = a.takeoff_dir or os.path.join(project, "takeoff")
    geo_path = a.geo or os.path.join(project, "oracle-geometry.json")
    stale_path = a.stale or os.path.join(project, "stale-rooms.json")
    geo = json.load(open(geo_path))
    stale = json.load(open(stale_path)) if os.path.exists(stale_path) else {"exclude": []}
    sb = score(takeoff_dir, geo, stale, a.wall_tol)
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
