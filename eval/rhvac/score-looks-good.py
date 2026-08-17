# Measure suite v1 for the takeoff room-solving tuning loop. Everything here is a
# DIAGNOSTIC / gradient, never a gate ("conservation gates, not scores" stands).
#
#   python eval/rhvac/score-looks-good.py score <report.json> [--out scores.json]
#   python eval/rhvac/score-looks-good.py audit-registration <report.json>
#   python eval/rhvac/score-looks-good.py compare <reportA.json> <reportB.json>
#
# The oracle (eval/rhvac/project-a/oracle-geometry.json) is UNTRUSTED: registration/vintage
# drift is inherent. Oracle-derived numbers are diagnostic-only; boundary-distance uses
# confidence=high rooms only; when oracle metrics disagree with ink metrics, suspect the
# oracle first. audit-registration exists to put evidence behind that suspicion.
#
# Evidence semantics mirrored from C# (TakeoffEvidenceFidelity / DetectSnapshot):
#   - backing evidence = seed ink OR door-head seal cells. The persisted seals_*.bin holds
#     doorHead|wallRunGap MERGED (ZoneBoundedDetectTests.cs:303), close_*.bin holds gapClose
#     only — pure door-head cells are NOT recoverable from bins. We therefore report edge
#     backing against two rails: ink-only (under-counts door-heads) and ink|seals
#     (over-counts wall-run plugs). C# truth sits between; the agreement check tells which
#     rail is closer per zone.
#   - sampling: collinear-collapsed edges (0.25 deg), step 0.25 ft, endpoints included,
#     hit when grid distance-to-evidence <= 0.25 ft, zone-edge samples exempt within
#     InkBackedZoneEdgeExemptFt (1.0 ft) of the zone boundary. The C#-emitted zone-level
#     InkBackedEdgeFraction uses accepted rooms with NO exemption; we mirror that exactly
#     for the agreement check.
#
# Saved-work score v1 (change freely; this is a gradient, not a contract):
#   per oracle room r in the zoned area:
#     contribution(r) = quality(P)        if rep-point lands in an accepted polygon P
#                     = 0.25 * quality(P) if it lands only in a held polygon P
#                     = 0                 if missing
#     quality(P) = 0.7 * edgeOnInk(P) + 0.3 * onFrameLenFraction(P)
#   savedWork(zone|board) = mean contribution over its oracle rooms.
#   Rationale: an accepted room saves the full trace if its edges stand on evidence and
#   need no ortho cleanup; a held room saves ~a quarter (it must be reviewed and promoted);
#   a missing room saves nothing.
import argparse
import json
import math
import os
import sys

import numpy as np
import shapely
from scipy.ndimage import distance_transform_edt
from shapely.geometry import GeometryCollection, LineString, MultiPolygon, Point, Polygon

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import overlay  # noqa: E402  (INKP + TSV parsing, polygon repair)

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
FIXTURES = os.path.join(REPO, "eval", "rhvac", "project-a")

# report Level name -> (bin token, oracle floor); mirrors ZoneBoundedDetectTests.LevelMap
LEVELS = {
    "Lower Level": ("Level_0_Lower_Level", 0),
    "Main Level": ("Level_1_Main_Level", 1),
    "Upper Level": ("Level_2_Upper_Level", 2),
    "Attic Level": ("Level_3_Attic", 3),
}

SAMPLE_STEP_FT = 0.25
HIT_FT = 0.25
# Registration-audit coverage radius: a wall sample with no ink within this many feet has nothing
# to register against — the detector is ink-starved there (LL06/LL08 quadrant, measured 2026-08-16:
# walls 8-12 ft from ink where the raster simply has none). Chamfer on such samples measures
# starvation, not drift, so the audit reports the two separately.
AUDIT_COVER_FT = 6.0
EXEMPT_FT = 1.0          # InkBackedZoneEdgeExemptFt in the report options
WALL_BAND_FT = 1.5       # interior-containment wall-claim band
OFF_FRAME_DEG = 3.0
EPS = 1e-7

REPORT_CARD = ["LL06", "LL08", "ML05", "ML09", "Attic 00", "Attic 01", "Main 10"]
CARD_PREFIX = {"LL": "Lower Level", "ML": "Main Level", "UL": "Upper Level",
               "MAIN": "Main Level", "ATTIC": "Attic Level", "UPPER": "Upper Level",
               "LOWER": "Lower Level"}


# ---- grids -------------------------------------------------------------------

class Grid:
    """An INKP raster as a numpy bool array plus its registration."""

    def __init__(self, mask, minx, miny, cell):
        self.mask = mask                      # (h, w) bool, row 0 at miny
        self.h, self.w = mask.shape
        self.minx, self.miny, self.cell = minx, miny, cell
        self._dist = None

    @classmethod
    def load(cls, path):
        w, h, minx, miny, cell, bits = overlay.load_ink(path)
        flat = np.unpackbits(np.frombuffer(bits, dtype=np.uint8), bitorder="little")[: w * h]
        return cls(flat.reshape(h, w).astype(bool), minx, miny, cell)

    @classmethod
    def load_replay_seed_ink(cls, path):
        """Seed ink straight from a gzipped DetectSnapshot (replay_*.bin).

        This is the raster the C# promotion actually scored against. The separately
        persisted ink_*.bin can be STALE relative to it (verified 2026-08-16: Upper Level
        ink bin was missing 33% of replay seed cells, Attic 45%), so evidence metrics
        must come from the replay, never the ink bin. Parsing lives in overlay.py — one
        parser for every surface that claims to show solver input.
        """
        w, h, minx, miny, cell, bits = overlay.load_replay_seed_ink(path)
        flat = np.unpackbits(np.frombuffer(bits, dtype=np.uint8), bitorder="little")[: w * h]
        return cls(flat.reshape(h, w).astype(bool), minx, miny, cell)

    @classmethod
    def union(cls, a, b):
        assert (a.h, a.w, a.minx, a.miny, a.cell) == (b.h, b.w, b.minx, b.miny, b.cell)
        return cls(a.mask | b.mask, a.minx, a.miny, a.cell)

    def distance_ft(self, xs, ys):
        """Distance-to-nearest-true in model feet at the cells containing (xs, ys).

        Mirrors DetectSnapshot.DistanceOracle: floor-index the containing cell,
        out-of-bounds is +inf. EDT stands in for the C# 1/sqrt2 chamfer — identical at
        the <=1-cell hit threshold this suite uses.
        """
        if self._dist is None:
            self._dist = (np.full(self.mask.shape, np.inf)
                          if not self.mask.any()
                          else distance_transform_edt(~self.mask) * self.cell)
        cols = np.floor((np.asarray(xs) - self.minx) / self.cell).astype(int)
        rows = np.floor((np.asarray(ys) - self.miny) / self.cell).astype(int)
        ok = (cols >= 0) & (cols < self.w) & (rows >= 0) & (rows < self.h)
        out = np.full(cols.shape, np.inf)
        out[ok] = self._dist[rows[ok], cols[ok]]
        return out

    def ink_inside(self, geometry):
        """Square feet of true cells whose centers fall inside `geometry`."""
        if geometry.is_empty:
            return 0.0
        gminx, gminy, gmaxx, gmaxy = geometry.bounds
        c0 = max(0, int((gminx - self.minx) / self.cell) - 1)
        c1 = min(self.w, int((gmaxx - self.minx) / self.cell) + 2)
        r0 = max(0, int((gminy - self.miny) / self.cell) - 1)
        r1 = min(self.h, int((gmaxy - self.miny) / self.cell) + 2)
        if c0 >= c1 or r0 >= r1:
            return 0.0
        sub = self.mask[r0:r1, c0:c1]
        rr, cc = np.nonzero(sub)
        if rr.size == 0:
            return 0.0
        xs = self.minx + (cc + c0 + 0.5) * self.cell
        ys = self.miny + (rr + r0 + 0.5) * self.cell
        inside = shapely.contains_xy(geometry, xs, ys)
        return float(inside.sum()) * self.cell * self.cell


# ---- geometry helpers --------------------------------------------------------

def collapse_collinear(points):
    """Mirror of TakeoffEvidenceFidelity.CollapseCollinear (0.25 deg tolerance)."""
    pts = [tuple(p) for p in points]
    if len(pts) >= 2 and pts[0] == pts[-1]:
        pts = pts[:-1]
    tol = math.sin(0.25 * math.pi / 180)
    changed = True
    while changed and len(pts) >= 3:
        changed = False
        for i in range(len(pts)):
            px, py = pts[(i - 1) % len(pts)]
            cx, cy = pts[i]
            nx, ny = pts[(i + 1) % len(pts)]
            ax, ay = cx - px, cy - py
            bx, by = nx - cx, ny - cy
            cross = abs(ax * by - ay * bx)
            lengths = math.hypot(ax, ay) * math.hypot(bx, by)
            if ax * bx + ay * by > 0 and cross <= tol * lengths:
                del pts[i]
                changed = True
                break
    return pts


def _polygon_parts(geometry):
    if isinstance(geometry, Polygon):
        return [geometry]
    if isinstance(geometry, MultiPolygon):
        return list(geometry.geoms)
    return [g for g in getattr(geometry, "geoms", ()) if isinstance(g, Polygon)]


def edge_sample_points(geometry):
    """C#-mirrored boundary samples: per collapsed edge, max(2, ceil(len/step)+1) points
    including both endpoints (corners sampled once per adjacent edge)."""
    xs, ys = [], []
    for part in _polygon_parts(geometry):
        rings = [part.exterior.coords] + [r.coords for r in part.interiors]
        for ring in rings:
            pts = collapse_collinear(list(ring))
            for i in range(len(pts)):
                (x0, y0), (x1, y1) = pts[i], pts[(i + 1) % len(pts)]
                length = math.hypot(x1 - x0, y1 - y0)
                count = max(2, int(math.ceil(length / SAMPLE_STEP_FT)) + 1)
                t = np.linspace(0.0, 1.0, count)
                xs.append(x0 + t * (x1 - x0))
                ys.append(y0 + t * (y1 - y0))
    if not xs:
        return np.empty(0), np.empty(0)
    return np.concatenate(xs), np.concatenate(ys)


def backed_stats(geometry, grid, zone_boundary=None, exempt_ft=EXEMPT_FT):
    """(fraction backed, sampled count, exempt count) — fraction None if all exempt."""
    xs, ys = edge_sample_points(geometry)
    if xs.size == 0:
        return None, 0, 0
    keep = np.ones(xs.size, dtype=bool)
    if zone_boundary is not None and not zone_boundary.is_empty:
        dist = shapely.distance(shapely.points(np.column_stack([xs, ys])), zone_boundary)
        keep = dist > exempt_ft + EPS
    exempt = int((~keep).sum())
    if not keep.any():
        return None, 0, exempt
    hits = grid.distance_ft(xs[keep], ys[keep]) <= HIT_FT + EPS
    return float(hits.mean()), int(keep.sum()), exempt


def zone_geometry(loops):
    """Even-odd composition of zone loops (mirrors ZoneScope.ContainsEvenOdd)."""
    geometry = GeometryCollection()
    for loop in loops:
        poly = overlay._valid_polygonal(Polygon([(p[0], p[1]) for p in loop]))
        geometry = geometry.symmetric_difference(poly)
    return geometry


def frame_angle_deg(loops):
    """Zone's dominant frame in degrees mod 90, length-weighted (angle-doubling x4)."""
    sx = sy = 0.0
    for loop in loops:
        pts = [tuple(p) for p in loop]
        for i in range(len(pts)):
            (x0, y0), (x1, y1) = pts[i], pts[(i + 1) % len(pts)]
            length = math.hypot(x1 - x0, y1 - y0)
            if length < EPS:
                continue
            theta = math.atan2(y1 - y0, x1 - x0)
            sx += length * math.cos(4 * theta)
            sy += length * math.sin(4 * theta)
    if abs(sx) < EPS and abs(sy) < EPS:
        return 0.0
    return (math.degrees(math.atan2(sy, sx) / 4)) % 90


def ortho_stats(geometry, frame_deg):
    """Vertex count, ortho-normalized vertex count, off-frame edges, on-frame length
    fraction, and a scalar edit cost, against an axis frame at `frame_deg`."""
    verts = 0
    norm_verts = 0
    off_edges = 0
    on_len = 0.0
    total_len = 0.0
    for part in _polygon_parts(geometry):
        for ring in [part.exterior.coords] + [r.coords for r in part.interiors]:
            pts = collapse_collinear(list(ring))
            if len(pts) < 3:
                continue
            verts += len(pts)
            classes = []
            lengths = []
            for i in range(len(pts)):
                (x0, y0), (x1, y1) = pts[i], pts[(i + 1) % len(pts)]
                length = math.hypot(x1 - x0, y1 - y0)
                angle = (math.degrees(math.atan2(y1 - y0, x1 - x0)) - frame_deg) % 90
                off_axis = min(angle, 90 - angle)  # deviation from nearest frame axis
                mod180 = (math.degrees(math.atan2(y1 - y0, x1 - x0)) - frame_deg) % 180
                if off_axis <= OFF_FRAME_DEG:
                    cls = "H" if min(mod180, 180 - mod180) <= 45 else "V"
                    on_len += length
                else:
                    cls = "O"
                    off_edges += 1
                classes.append(cls)
                lengths.append(length)
                total_len += length
            # normalized vertex count = number of cyclic runs of edge classes; an ortho
            # rectangle (H V H V) has 4 runs = 4 vertices.
            runs = sum(1 for i in range(len(classes)) if classes[i] != classes[i - 1])
            norm_verts += max(runs, 1)
    on_frame_fraction = (on_len / total_len) if total_len > EPS else 0.0
    edit_cost = norm_verts + 2 * off_edges
    return dict(verts=verts, normVerts=norm_verts, offFrameEdges=off_edges,
                onFrameLenFraction=round(on_frame_fraction, 4), editCost=edit_cost)


def boundary_samples(coords, step=SAMPLE_STEP_FT):
    xs, ys = [], []
    pts = list(coords)
    for i in range(len(pts) - 1):
        (x0, y0), (x1, y1) = pts[i][:2], pts[i + 1][:2]
        length = math.hypot(x1 - x0, y1 - y0)
        count = max(2, int(math.ceil(length / step)) + 1)
        t = np.linspace(0.0, 1.0, count)
        xs.append(x0 + t * (x1 - x0))
        ys.append(y0 + t * (y1 - y0))
    if not xs:
        return np.empty(0), np.empty(0)
    return np.concatenate(xs), np.concatenate(ys)


def symmetric_boundary_distance(a, b):
    """(mean, max) symmetric boundary distance in ft between two polygonal geometries."""
    means, maxes = [], []
    for src, dst in ((a, b), (b, a)):
        pts = []
        for part in _polygon_parts(src):
            for ring in [part.exterior.coords] + [r.coords for r in part.interiors]:
                xs, ys = boundary_samples(ring)
                pts.append(np.column_stack([xs, ys]))
        if not pts:
            return None, None
        points = shapely.points(np.concatenate(pts))
        dist = shapely.distance(points, dst.boundary)
        means.append(float(dist.mean()))
        maxes.append(float(dist.max()))
    return (means[0] + means[1]) / 2, max(maxes)


def representative_point(geometry):
    return geometry.representative_point()


def interior_swallow(geometry, ink, band_ft=WALL_BAND_FT):
    """Square feet of ink strictly interior to the polygon, outside a wall-claim band."""
    core = geometry.buffer(-band_ft)
    if core.is_empty:
        return 0.0
    return ink.ink_inside(core)


# ---- report loading ----------------------------------------------------------

def load_report(path):
    with open(path, encoding="utf-8") as f:
        report = json.load(f)
    return report, os.path.dirname(os.path.abspath(path))


def load_levels(report, base):
    """token -> dict of Grids (ink, seals, close, evidence=ink|seals) for each level."""
    levels = {}
    for zone in report["Zones"]:
        token, _ = LEVELS[zone["Level"]]
        if token in levels:
            continue
        ink_path = os.path.join(base, zone["Ink"])
        if not os.path.isfile(ink_path):
            continue
        # The C# scored against the replay snapshot's seed ink; the persisted ink_*.bin
        # can be stale relative to it, so prefer the replay whenever it sits alongside.
        replay_path = os.path.join(base, os.path.dirname(zone["Ink"]),
                                   f"replay_{token}.bin")
        ink = (Grid.load_replay_seed_ink(replay_path) if os.path.isfile(replay_path)
               else Grid.load(ink_path))
        seals = Grid.load(os.path.join(base, zone["Seals"]))
        close = Grid.load(os.path.join(base, zone["Close"]))
        levels[token] = dict(ink=ink, seals=seals, close=close,
                             evidence=Grid.union(ink, seals))
    return levels


def load_zone_polygons(tsv_path):
    """(accepted {id: geometry}, held {id: geometry}) from a disposition TSV."""
    accepted, held = {}, {}
    if not os.path.isfile(tsv_path):
        return accepted, held
    rooms, polys, residues = overlay.load_disposition_tsv(tsv_path)
    for room_id in rooms:
        geometry = overlay._geometry(polys.get(room_id, []))
        if not geometry.is_empty:
            accepted[room_id] = geometry
    for residue in residues:
        if residue["reason"] != "rejected":
            continue
        geometry = overlay._residue_geometry(residue)
        if not geometry.is_empty:
            held[residue["id"]] = geometry
    return accepted, held


def load_oracle():
    with open(os.path.join(FIXTURES, "oracle-geometry.json"), encoding="utf-8") as f:
        return json.load(f)


def oracle_rooms_by_floor(oracle):
    rooms = {}
    for number, room in oracle["rooms"].items():
        polygon = room.get("polygonModelFt")
        if not polygon or len(polygon) < 3:
            continue
        geometry = overlay._valid_polygonal(Polygon(polygon))
        if geometry.is_empty:
            continue
        rooms.setdefault(room["floor"], []).append(dict(
            number=number, name=room["name"], confidence=room["confidence"],
            areaSf=room.get("oracleAreaSf"), geometry=geometry,
            point=representative_point(geometry)))
    return rooms


# ---- score -------------------------------------------------------------------

def score_report(report_path):
    report, base = load_report(report_path)
    levels = load_levels(report, base)
    oracle_rooms = oracle_rooms_by_floor(load_oracle())

    zones_out = []
    room_status = {}   # oracle room number -> (status, quality) for board rollup
    for zone in report["Zones"]:
        token, floor = LEVELS[zone["Level"]]
        grids = levels.get(token)
        zgeom = zone_geometry(zone["ZoneLoops"])
        zboundary = zgeom.boundary
        frame = frame_angle_deg(zone["ZoneLoops"])
        accepted, held = load_zone_polygons(os.path.join(base, zone["Tsv"]))

        polys_out = []
        agg = {"accepted": [0, 0], "held": [0, 0]}          # evidence-rail hits/samples
        agg_no_exempt = [0, 0]                              # accepted, no exemption (C# mirror)
        agg_no_exempt_ink = [0, 0]
        for disposition, table in (("accepted", accepted), ("held", held)):
            for pid, geometry in sorted(table.items()):
                row = dict(zone=zone["Zone"], id=pid, disposition=disposition,
                           sqft=round(geometry.area, 1))
                if grids:
                    frac, sampled, exempt = backed_stats(geometry, grids["evidence"], zboundary)
                    frac_ink, _, _ = backed_stats(geometry, grids["ink"], zboundary)
                    row.update(edgeOnInk=None if frac is None else round(frac, 4),
                               edgeOnInkInkOnly=None if frac_ink is None else round(frac_ink, 4),
                               sampled=sampled, exemptSamples=exempt)
                    if frac is not None:
                        agg[disposition][0] += frac * sampled
                        agg[disposition][1] += sampled
                    if disposition == "accepted":
                        xs, ys = edge_sample_points(geometry)
                        hits = grids["evidence"].distance_ft(xs, ys) <= HIT_FT + EPS
                        agg_no_exempt[0] += int(hits.sum()); agg_no_exempt[1] += hits.size
                        hits_ink = grids["ink"].distance_ft(xs, ys) <= HIT_FT + EPS
                        agg_no_exempt_ink[0] += int(hits_ink.sum()); agg_no_exempt_ink[1] += hits_ink.size
                    swallow = interior_swallow(geometry, grids["ink"])
                    row.update(swallowSf=round(swallow, 1),
                               swallowFraction=round(swallow / geometry.area, 4)
                               if geometry.area > EPS else 0.0)
                row.update(ortho_stats(geometry, frame))
                polys_out.append(row)

        # room recall against oracle rooms whose representative point is in this zone
        zone_oracle = [r for r in oracle_rooms.get(floor, []) if zgeom.contains(r["point"])]
        recalled = held_count = 0
        oracle_rows = []
        for room in zone_oracle:
            status, quality, match = "missing", 0.0, None
            for pid, geometry in accepted.items():
                if geometry.contains(room["point"]):
                    status, match = "accepted", pid
                    break
            if status == "missing":
                for pid, geometry in held.items():
                    if geometry.contains(room["point"]):
                        status, match = "held", pid
                        break
            row_for = next((p for p in polys_out if p["id"] == match
                            and p["disposition"] == status), None) if match else None
            if row_for is not None:
                edge = row_for.get("edgeOnInk") or 0.0
                quality = 0.7 * edge + 0.3 * row_for["onFrameLenFraction"]
            if status == "accepted":
                recalled += 1
            elif status == "held":
                held_count += 1
            contribution = quality if status == "accepted" else (
                0.25 * quality if status == "held" else 0.0)
            oracle_rows.append(dict(number=room["number"], name=room["name"],
                                    confidence=room["confidence"], status=status,
                                    matchedId=match, quality=round(quality, 4)))
            previous = room_status.get(room["number"])
            if previous is None or contribution > previous[1]:
                room_status[room["number"]] = (status, contribution)

        # oracle boundary distance, confidence=high only, matched by max overlap
        distance_rows = []
        for pid, geometry in sorted(accepted.items()):
            best, best_area = None, 0.0
            for room in zone_oracle:
                if room["confidence"] != "high":
                    continue
                area = geometry.intersection(room["geometry"]).area
                if area > best_area:
                    best, best_area = room, area
            if best is None or best_area < 0.25 * min(geometry.area, best["geometry"].area):
                continue
            mean, worst = symmetric_boundary_distance(geometry, best["geometry"])
            bucket = ("as-is" if mean < 0.5 else "nudge" if mean < 2.0 else "redraw")
            distance_rows.append(dict(id=pid, oracle=best["number"], name=best["name"],
                                      meanFt=round(mean, 2), maxFt=round(worst, 2),
                                      bucket=bucket))

        def fraction(pair):
            return round(pair[0] / pair[1], 4) if pair[1] else None

        contributions = []
        for room in zone_oracle:
            status = next(r["status"] for r in oracle_rows if r["number"] == room["number"])
            quality = next(r["quality"] for r in oracle_rows if r["number"] == room["number"])
            contributions.append(quality if status == "accepted"
                                 else 0.25 * quality if status == "held" else 0.0)
        zones_out.append(dict(
            zone=zone["Zone"], level=zone["Level"], verdict=zone["triage"]["verdict"],
            zoneSqft=zone["ZoneSqft"], frameDeg=round(frame, 2),
            oracleRooms=len(zone_oracle), recallAccepted=recalled, recallHeld=held_count,
            missing=len(zone_oracle) - recalled - held_count,
            roomRecall=round(recalled / len(zone_oracle), 4) if zone_oracle else None,
            heldRecall=round(held_count / len(zone_oracle), 4) if zone_oracle else None,
            edgeOnInkAccepted=fraction(agg["accepted"]),
            edgeOnInkHeld=fraction(agg["held"]),
            edgeOnInkAcceptedNoExempt=fraction(agg_no_exempt),
            edgeOnInkAcceptedNoExemptInkOnly=fraction(agg_no_exempt_ink),
            reportedInkBackedEdgeFraction=zone["InkBackedEdgeFraction"],
            swallowSf=round(sum(p.get("swallowSf", 0.0) for p in polys_out
                                if p["disposition"] == "accepted"), 1),
            meanEditCostAccepted=round(np.mean([p["editCost"] for p in polys_out
                                                if p["disposition"] == "accepted"]), 2)
            if any(p["disposition"] == "accepted" for p in polys_out) else None,
            savedWork=round(float(np.mean(contributions)), 4) if contributions else None,
            polygons=polys_out, oracleRoomStatus=oracle_rows,
            oracleBoundaryDistance=distance_rows))

    total = len(room_status)
    accepted_total = sum(1 for s, _ in room_status.values() if s == "accepted")
    held_total = sum(1 for s, _ in room_status.values() if s == "held")
    # Oracle rooms no zone ever claimed (representative point outside every zone on their floor).
    # They are excluded from recall by construction — but silently shrinking the oracle is how a
    # board lies, so they are named here. (2026-08-16 audit: Powder 004 + AV Equipment 025, both
    # in the theatre/entry area outside the Lower zoning plan.)
    unzoned = [dict(number=r["number"], name=r["name"], floor=floor_key)
               for floor_key, floor_rooms in oracle_rooms.items()
               for r in floor_rooms if r["number"] not in room_status]
    all_polys = [p for z in zones_out for p in z["polygons"]]
    all_dist = [d for z in zones_out for d in z["oracleBoundaryDistance"]]
    board = dict(
        oracleRoomsInZones=total,
        roomRecall=round(accepted_total / total, 4) if total else None,
        heldRecall=round(held_total / total, 4) if total else None,
        missing=total - accepted_total - held_total,
        savedWork=round(sum(q for _, q in room_status.values()) / total, 4) if total else None,
        edgeOnInkAccepted=_weighted_edge(all_polys, "accepted"),
        edgeOnInkHeld=_weighted_edge(all_polys, "held"),
        swallowSf=round(sum(p.get("swallowSf", 0.0) for p in all_polys
                            if p["disposition"] == "accepted"), 1),
        meanEditCostAccepted=round(np.mean([p["editCost"] for p in all_polys
                                            if p["disposition"] == "accepted"]), 2)
        if any(p["disposition"] == "accepted" for p in all_polys) else None,
        distanceBuckets={b: sum(1 for d in all_dist if d["bucket"] == b)
                         for b in ("as-is", "nudge", "redraw")},
        unzonedOracleRooms=unzoned)
    return dict(report=os.path.abspath(report_path),
                generatedUtc=report.get("GeneratedUtc"), board=board, zones=zones_out)


def _weighted_edge(polys, disposition):
    num = den = 0.0
    for p in polys:
        if p["disposition"] != disposition or p.get("edgeOnInk") is None:
            continue
        num += p["edgeOnInk"] * p["sampled"]
        den += p["sampled"]
    return round(num / den, 4) if den else None


def cmd_score(args):
    scores = score_report(args.report)
    board = scores["board"]
    print(f"report: {scores['report']}  generated {scores['generatedUtc']}")
    print(f"board: oracleRooms={board['oracleRoomsInZones']} "
          f"recall={board['roomRecall']} held={board['heldRecall']} "
          f"missing={board['missing']} savedWork={board['savedWork']}")
    print(f"       edgeOnInk acc={board['edgeOnInkAccepted']} held={board['edgeOnInkHeld']} "
          f"swallowSf={board['swallowSf']} editCost={board['meanEditCostAccepted']} "
          f"buckets={board['distanceBuckets']}")
    if board.get("unzonedOracleRooms"):
        names = ", ".join(f"{r['name']} (floor {r['floor']})"
                          for r in board["unzonedOracleRooms"])
        print(f"       unzoned oracle rooms (in no zone, excluded from recall): {names}")
    header = (f"{'zone':<18}{'orc':>4}{'acc':>4}{'held':>5}{'miss':>5}{'recall':>8}"
              f"{'edgeAcc':>9}{'edgeHeld':>9}{'C#ibef':>8}{'agree':>8}{'swallow':>9}"
              f"{'edit':>6}{'saved':>7}")
    print(header)
    for z in scores["zones"]:
        if z["oracleRooms"] == 0 and not z["polygons"]:
            continue
        mine = z["edgeOnInkAcceptedNoExempt"]
        theirs = z["reportedInkBackedEdgeFraction"]
        agree = "" if mine is None else f"{mine - theirs:+.3f}"
        print(f"{z['zone']:<18}{z['oracleRooms']:>4}{z['recallAccepted']:>4}"
              f"{z['recallHeld']:>5}{z['missing']:>5}"
              f"{_fmt(z['roomRecall']):>8}{_fmt(z['edgeOnInkAccepted']):>9}"
              f"{_fmt(z['edgeOnInkHeld']):>9}{theirs:>8.3f}{agree:>8}"
              f"{z['swallowSf']:>9}{_fmt(z['meanEditCostAccepted']):>6}"
              f"{_fmt(z['savedWork']):>7}")
    if args.out:
        with open(args.out, "w", encoding="utf-8") as f:
            json.dump(scores, f, indent=1)
        print(f"wrote {os.path.abspath(args.out)}")
    return scores


def _fmt(value):
    return "-" if value is None else (f"{value:.3f}" if isinstance(value, float) else str(value))


# ---- audit-registration ------------------------------------------------------

def cmd_audit(args):
    report, base = load_report(args.report)
    levels = load_levels(report, base)
    oracle = load_oracle()
    rooms = oracle_rooms_by_floor(oracle)
    walls_by_floor = {}
    for wall in oracle["walls"]:
        walls_by_floor.setdefault(wall["floor"], []).append(wall["pointsModelFt"])

    print("registration audit: chamfer distance (ft) from oracle geometry to raw evidence ink")
    print("thresholds: registered = wall median<=0.5 & p90<=2.0 (2 cells; within wall half-")
    print("thickness + rasterization); drifted = median<=1.5; untrusted otherwise.")
    print(f"covered = samples with ink within {AUDIT_COVER_FT} ft; a starved sample has no ink to")
    print("register against, so raw chamfer there measures detector ink starvation, not drift.\n")

    tokens = list(levels)
    floors = sorted(set(f for _, (t, f) in LEVELS.items() if t in tokens))
    matrix = {}
    covered_matrix = {}   # (token, floor) -> (covered median, starved fraction)
    verdicts = {}
    for level_name, (token, floor) in LEVELS.items():
        if token not in levels:
            continue
        ink = levels[token]["ink"]
        for probe_floor in floors:
            xs, ys = [], []
            for segment in walls_by_floor.get(probe_floor, []):
                sx, sy = boundary_samples(segment)
                xs.append(sx); ys.append(sy)
            if not xs:
                continue
            dist = ink.distance_ft(np.concatenate(xs), np.concatenate(ys))
            dist = dist[np.isfinite(dist)]
            matrix[(token, probe_floor)] = (float(np.median(dist)),
                                            float(np.percentile(dist, 90)))
            covered = dist[dist <= AUDIT_COVER_FT]
            covered_matrix[(token, probe_floor)] = (
                float(np.median(covered)) if covered.size else math.inf,
                1.0 - covered.size / dist.size if dist.size else 1.0)
        wall_median, wall_p90 = matrix.get((token, floor), (math.inf, math.inf))
        cov_median, starved = covered_matrix.get((token, floor), (math.inf, 1.0))

        xs, ys = [], []
        for room in rooms.get(floor, []):
            for part in _polygon_parts(room["geometry"]):
                sx, sy = boundary_samples(part.exterior.coords)
                xs.append(sx); ys.append(sy)
        room_median = room_p90 = math.inf
        if xs:
            dist = ink.distance_ft(np.concatenate(xs), np.concatenate(ys))
            dist = dist[np.isfinite(dist)]
            room_median, room_p90 = float(np.median(dist)), float(np.percentile(dist, 90))

        verdict = ("registered" if wall_median <= 0.5 and wall_p90 <= 2.0
                   else "drifted" if wall_median <= 1.5 else "untrusted")
        if starved >= 0.10 and verdict != "registered":
            verdict += f" ({starved:.0%} ink-starved; covered drift median {cov_median:.2f})"
        verdicts[level_name] = verdict
        print(f"{level_name:<14} walls: median {wall_median:5.2f}  p90 {wall_p90:5.2f}   "
              f"rooms: median {room_median:5.2f}  p90 {room_p90:5.2f}   -> {verdict}")

        png = os.path.join(base, f"registration_{token}.png")
        _render_registration(ink, walls_by_floor.get(floor, []), rooms.get(floor, []),
                             png, f"{level_name} — {verdict}")
        print(f"{'':<14} overlay: {png}")

    # Cross-check on COVERED medians only (starved samples say nothing about assignment), and
    # stacking-aware: floors of one building stack their walls, so "another floor's walls chamfer
    # better" is only evidence of misassignment when those wall sets are NOT vertically coincident.
    # 2026-08-16 audit: Lower's old "BEST IS FLOOR 1" flag was exactly this artifact — floor 0/1
    # walls stack within ~1 ft while Lower's ink is starved in the bar quadrant.
    print("\nfloor-assignment cross-check (covered wall median ft, rows=ink level, cols=oracle floor):")
    print(f"{'':<24}" + "".join(f"floor {f:>2}  " for f in floors))
    for level_name, (token, floor) in LEVELS.items():
        if token not in levels:
            continue
        cells = "".join(
            f"{covered_matrix.get((token, f), (math.nan, 0))[0]:>8.2f}  " for f in floors)
        best = min(floors, key=lambda f: covered_matrix.get((token, f), (math.inf, 1.0))[0])
        flag = ""
        if best != floor:
            margin = (covered_matrix.get((token, floor), (math.inf, 1.0))[0]
                      - covered_matrix.get((token, best), (math.inf, 1.0))[0])
            stack = _wall_stacking(walls_by_floor, floor, best)
            if margin <= 0.25:
                flag = f"  (floor {best} better by {margin:.2f} ft: within noise)"
            elif stack <= 1.0:
                flag = (f"  (floor {best} better by {margin:.2f} ft, but floors stack: "
                        f"wall-to-wall median {stack:.2f} ft — uninformative)")
            else:
                flag = f"  <-- BEST IS FLOOR {best} by {margin:.2f} ft, MAPPING SUSPECT"
        print(f"{level_name:<24}{cells}{flag}")
    return verdicts


def _wall_stacking(walls_by_floor, floor_a, floor_b):
    """Median distance (ft) from floor_b wall samples to floor_a wall polylines — oracle-only
    geometry, so it measures whether two floors' declared walls vertically coincide."""
    lines_a = [LineString(w) for w in walls_by_floor.get(floor_a, []) if len(w) >= 2]
    if not lines_a:
        return math.inf
    target = shapely.union_all(lines_a)
    dists = []
    for wall in walls_by_floor.get(floor_b, []):
        xs, ys = boundary_samples(wall)
        dists.extend(target.distance(Point(x, y)) for x, y in zip(xs, ys))
    return float(np.median(dists)) if dists else math.inf


def _render_registration(ink, walls, rooms, out_path, caption):
    from PIL import Image, ImageDraw
    scale = 1
    image = Image.new("RGB", (ink.w * scale, ink.h * scale), "white")
    mask = Image.fromarray((ink.mask[::-1] * 255).astype(np.uint8), mode="L").point(
        lambda v: 255 if v else 0, mode="1")
    image.paste((184, 184, 184), mask=mask)
    draw = ImageDraw.Draw(image)

    def to_pixel(x, y):
        return ((x - ink.minx) / ink.cell * scale,
                (ink.h - (y - ink.miny) / ink.cell) * scale)

    for room in rooms:
        for part in _polygon_parts(room["geometry"]):
            draw.line([to_pixel(x, y) for x, y in part.exterior.coords],
                      fill=(60, 120, 230), width=2)
    for segment in walls:
        draw.line([to_pixel(x, y) for x, y in segment], fill=(205, 45, 45), width=2)
    draw.text((12, 12), caption + "  (red=oracle walls, blue=oracle rooms, gray=ink)",
              fill=(35, 35, 35), font=overlay._font(24))
    image.save(out_path)


# ---- compare -----------------------------------------------------------------

def _card_zone_names(zone_names):
    """Map report-card codes to actual zone names by substring; returns list of
    (code, matched zone name or None)."""
    matches = []
    for code in REPORT_CARD:
        text = code.replace(" ", "")
        alpha = "".join(c for c in text if c.isalpha()).upper()
        digits = "".join(c for c in text if c.isdigit())
        prefix = CARD_PREFIX.get(alpha, alpha)
        needle = f"{prefix}#{int(digits):02d}" if digits else prefix
        found = next((name for name in zone_names if needle in name), None)
        matches.append((code, found))
    return matches


COMPARE_KEYS = ["roomRecall", "heldRecall", "edgeOnInkAccepted", "edgeOnInkHeld",
                "swallowSf", "meanEditCostAccepted", "savedWork"]


def cmd_compare(args):
    a = score_report(args.report_a)
    b = score_report(args.report_b)
    za = {z["zone"]: z for z in a["zones"]}
    zb = {z["zone"]: z for z in b["zones"]}
    matches = _card_zone_names(list(za))
    print(f"A: {a['report']} ({a['generatedUtc']})")
    print(f"B: {b['report']} ({b['generatedUtc']})")
    print("report-card zones: " + ", ".join(
        f"{code}->{name or 'NO MATCH'}" for code, name in matches))
    header = f"{'zone':<20}{'metric':<24}{'A':>10}{'B':>10}{'delta':>10}"
    print(header)

    def emit(label, ra, rb):
        for key in COMPARE_KEYS:
            va, vb = ra.get(key), rb.get(key)
            if va is None and vb is None:
                continue
            delta = ("" if va is None or vb is None else f"{vb - va:+.3f}")
            print(f"{label:<20}{key:<24}{_fmt(va):>10}{_fmt(vb):>10}{delta:>10}")
            label = ""

    for code, name in matches:
        if name is None or name not in zb:
            continue
        emit(f"{code} {name}", za[name], zb[name])
    emit("BOARD", a["board"], b["board"])


# ---- entry -------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    p = sub.add_parser("score", help="per-zone + board metrics")
    p.add_argument("report")
    p.add_argument("--out", default=None)
    p.set_defaults(func=cmd_score)
    p = sub.add_parser("audit-registration", help="oracle-to-ink chamfer audit per level")
    p.add_argument("report")
    p.set_defaults(func=cmd_audit)
    p = sub.add_parser("compare", help="delta table between two reports")
    p.add_argument("report_a")
    p.add_argument("report_b")
    p.set_defaults(func=cmd_compare)
    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
