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
#   - backing evidence = replay seed ink OR INKC class 2 (door-head) cells. Gap-close (1),
#     wall-run (3), and oversize door-head fringe (4) are closure only and never back an edge.
#     Current classes_<token>.bin attribution is required; lossy merged seals_*.bin is not truth.
#     The ink-only rail remains a separate diagnostic.
#   - sampling: collinear-collapsed edges (0.25 deg), step 0.25 ft, endpoints included,
#     hit when grid distance-to-evidence <= 0.25 ft, zone-edge samples exempt within
#     InkBackedZoneEdgeExemptFt (1.0 ft) of the zone boundary. The C#-emitted zone-level
#     InkBackedEdgeFraction uses accepted rooms with NO exemption; we mirror that exactly
#     for the agreement check.
#
# Historical saved-work diagnostic v1 (never adoption authority):
#   per oracle room r in the zoned area:
#     contribution(r) = quality(P)        if rep-point lands in an accepted polygon P
#                     = 0.25 * quality(P) if it lands only in a held polygon P
#                     = 0                 if missing
#     quality(P) = 0.7 * edgeOnInk(P) + 0.3 * onFrameLenFraction(P)
#   savedWork(zone|board) = mean contribution over its oracle rooms.
#   Rationale: an accepted room saves the full trace if its edges stand on evidence and
#   need no ortho cleanup; a held room saves ~a quarter (it must be reviewed and promoted);
#   a missing room saves nothing.
#
# Historical diagnostic v1.1 — oracle hygiene (R3b, landed 2026-08-17):
#   R3b proved 25/118 oracle rooms are phantoms/duplicates: rooms whose sourcePdf names the
#   Guest House (a separate building misregistered onto the main model), and same-floor
#   duplicate pairs from overlapping enlarged-plan pages (floor-2 pages 12/13 overlap
#   95-100%; a "Great Room West" sits 91% atop Her Bath). clean_oracle() drops the
#   guest-house-sourced rooms and dedupes same-floor pairs overlapping >40% of the smaller,
#   keeping the copy whose boundary registers better (lower median boundary-sample distance)
#   on THIS model's replay seed ink.
#   TRANSITION RULE (kaitpw-approved): `score` prints BOTH board lines — v1.1 (cleaned)
#   first and labeled, then v1 (raw oracle) — while the currencies coexist; per-zone tables
#   and `compare` use v1.1.
#   FALSIFIER: a dropped room later accepted cleanly at its exact footprint means the
#   dedupe kept the wrong copy — reopen the hygiene rules, don't patch the solver.
import argparse
import hashlib
import json
import math
import os
import sys

import numpy as np
import shapely
from scipy.ndimage import distance_transform_edt, label
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
INTERIOR_WALL_MIN_FT = 3.0
INTERIOR_WALL_SPAN_FRACTION = 0.5
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


def worst_unbacked_run(geometry, grid, zone_boundary=None, exempt_ft=EXEMPT_FT):
    """Longest per-segment run of lawful-evidence misses, with its review address."""
    worst = None
    for part_index, part in enumerate(_polygon_parts(geometry)):
        rings = [("outer", part.exterior.coords)] + [
            (f"hole:{i}", ring.coords) for i, ring in enumerate(part.interiors)]
        for ring_name, ring in rings:
            pts = collapse_collinear(list(ring))
            for i in range(len(pts)):
                (x0, y0), (x1, y1) = pts[i], pts[(i + 1) % len(pts)]
                length = math.hypot(x1 - x0, y1 - y0)
                if length < 2 * SAMPLE_STEP_FT:
                    continue
                count = max(2, int(length / SAMPLE_STEP_FT) + 1)
                t = np.linspace(0.0, 1.0, count)
                xs, ys = x0 + t * (x1 - x0), y0 + t * (y1 - y0)
                keep = np.ones(count, dtype=bool)
                if zone_boundary is not None and not zone_boundary.is_empty:
                    dist = shapely.distance(
                        shapely.points(np.column_stack([xs, ys])), zone_boundary)
                    keep = dist > exempt_ft + EPS
                hits = grid.distance_ft(xs, ys) <= HIT_FT + EPS
                run_start = None
                for sample_index, (eligible, hit) in enumerate(zip(keep, hits)):
                    if eligible and not hit:
                        if run_start is None:
                            run_start = sample_index
                        sample_count = sample_index - run_start + 1
                        if worst is None or sample_count > worst["sampleCount"]:
                            worst = dict(
                                lengthFt=round(sample_count * SAMPLE_STEP_FT, 4),
                                sampleCount=sample_count,
                                part=part_index,
                                ring=ring_name,
                                edgeIndex=i,
                                edge={"from": _point(x0, y0), "to": _point(x1, y1)},
                                run={"from": _point(xs[run_start], ys[run_start]),
                                     "to": _point(xs[sample_index], ys[sample_index])})
                    else:
                        run_start = None
    return worst


def worst_unbacked_run_ft(geometry, grid, zone_boundary=None, exempt_ft=EXEMPT_FT):
    detail = worst_unbacked_run(geometry, grid, zone_boundary, exempt_ft)
    return detail["lengthFt"] if detail else 0.0


def _point(x, y):
    return [round(float(x), 4), round(float(y), 4)]


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
    non_orthogonal_edges = 0
    on_len = 0.0
    regular_grid_len = 0.0
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
                grid_deviation = min(off_axis, abs(45 - off_axis))
                mod180 = (math.degrees(math.atan2(y1 - y0, x1 - x0)) - frame_deg) % 180
                if off_axis <= OFF_FRAME_DEG:
                    cls = "H" if min(mod180, 180 - mod180) <= 45 else "V"
                    on_len += length
                else:
                    cls = "O"
                    off_edges += 1
                if grid_deviation <= OFF_FRAME_DEG:
                    regular_grid_len += length
                else:
                    non_orthogonal_edges += 1
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
                onFrameLenFraction=round(on_frame_fraction, 4), editCost=edit_cost,
                nonOrthogonalEdges=non_orthogonal_edges,
                nonOrthogonalFt=round(total_len - regular_grid_len, 1))


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


def interior_swallow(geometry, ink, zone_boundary=None, band_ft=WALL_BAND_FT):
    """Square feet of ink strictly interior to the polygon, outside a wall-claim band.

    Rim-exemption artifact (R3c, 2026-08-16): the room-rim band (buffer(-band_ft))
    assumes ink near the room's own edge is that edge's wall claim. When a boundary
    honestly RETREATS off a wall (the R3c snap guard stops edges crossing ink), the
    wall's ink that the rim band used to hide now sits deeper than band_ft inside the
    polygon and starts counting as swallow — the metric punishes the honest move.
    Fix: ink within band_ft of the ZONE boundary is excluded. The zone line is declared
    wall authority (zone clip+snap law), so ink hugging it is the zone's own perimeter
    wall, never a swallowed interior partition — mirroring the edge-on-ink zone-edge
    exemption. This removes the artifact only where the retreat is toward a zone wall;
    a retreat off an INTERIOR wall still counts as swallow, which is correct: two room
    edges disputing one interior wall band is the round-4 parallel-on-ink problem, and
    hiding it here would silence that signal."""
    core = geometry.buffer(-band_ft)
    if core.is_empty:
        return 0.0
    if zone_boundary is not None and not zone_boundary.is_empty:
        core = core.difference(zone_boundary.buffer(band_ft))
        if core.is_empty:
            return 0.0
    return ink.ink_inside(core)


def interior_wall_run_ft(geometry, ink, zone_boundary=None, band_ft=WALL_BAND_FT):
    """Total span of connected seed-ink runs that read as interior walls."""
    core = geometry.buffer(-band_ft)
    if zone_boundary is not None and not zone_boundary.is_empty:
        core = core.difference(zone_boundary.buffer(band_ft))
    if core.is_empty:
        return 0.0
    minx, miny, maxx, maxy = geometry.bounds
    required = max(INTERIOR_WALL_MIN_FT,
                   INTERIOR_WALL_SPAN_FRACTION * min(maxx - minx, maxy - miny))
    rr, cc = np.nonzero(ink.mask)
    xs = ink.minx + (cc + 0.5) * ink.cell
    ys = ink.miny + (rr + 0.5) * ink.cell
    keep = shapely.contains_xy(core, xs, ys)
    interior = np.zeros_like(ink.mask)
    interior[rr[keep], cc[keep]] = True
    components, count = label(interior, structure=np.ones((3, 3), dtype=int))
    total = 0.0
    for component in range(1, count + 1):
        rows, cols = np.nonzero(components == component)
        span = max(np.ptp(rows) + 1, np.ptp(cols) + 1) * ink.cell
        if span + EPS >= required:
            total += span
    return round(float(total), 1)


def _line_parts(geometry):
    if isinstance(geometry, LineString):
        return [geometry]
    return [part for part in getattr(geometry, "geoms", ())
            if isinstance(part, LineString)]


def sibling_shared_edge_stats(polygons, ink):
    """Length of exact sibling boundaries, and the part unsupported by seed ink."""
    shared = unbacked = 0.0
    details = []
    ordered = sorted(polygons, key=lambda item: (item[0], item[1]))
    for index, (disposition_a, id_a, geometry_a) in enumerate(ordered):
        for disposition_b, id_b, geometry_b in ordered[index + 1:]:
            for line in _line_parts(geometry_a.boundary.intersection(geometry_b.boundary)):
                length = line.length
                if length <= EPS:
                    continue
                count = max(2, int(math.ceil(length / SAMPLE_STEP_FT)) + 1)
                distances = np.linspace(0.0, length, count)
                points = [line.interpolate(float(distance)) for distance in distances]
                hits = ink.distance_ft(
                    [point.x for point in points], [point.y for point in points]) <= HIT_FT + EPS
                unsupported = length * float((~hits).mean())
                shared += length
                unbacked += unsupported
                details.append(dict(room=id_a, disposition=disposition_a,
                                    siblingRoom=id_b, siblingDisposition=disposition_b,
                                    sharedFt=round(length, 1),
                                    unbackedFt=round(unsupported, 1)))
    return dict(sharedFt=round(shared, 1), unbackedFt=round(unbacked, 1), details=details)


def oracle_existence_stats(polygons, oracle_rooms):
    """Oracle-only cross-checks. These may rank runs, never select one."""
    split_details = []
    ordered = sorted(polygons, key=lambda item: (item[0], item[1]))
    for index, (disposition_a, id_a, geometry_a) in enumerate(ordered):
        for disposition_b, id_b, geometry_b in ordered[index + 1:]:
            shared = geometry_a.boundary.intersection(geometry_b.boundary)
            shared_ft = sum(line.length for line in _line_parts(shared))
            if shared_ft <= EPS:
                continue
            split_ft = max((shared.intersection(room["geometry"].buffer(-WALL_BAND_FT)).length
                            for room in oracle_rooms), default=0.0)
            split_details.append(dict(
                room=id_a, disposition=disposition_a,
                siblingRoom=id_b, siblingDisposition=disposition_b,
                sharedFt=round(shared_ft, 1), oracleSplitFt=round(split_ft, 1)))
    merged = []
    for disposition, candidate_id, geometry in ordered:
        matches = [room["number"] for room in oracle_rooms
                   if geometry.contains(room["point"])]
        merged.append(dict(disposition=disposition, room=candidate_id,
                           matchedOracleRooms=len(matches),
                           excessOracleRooms=max(0, len(matches) - 1)))
    return dict(splitDetails=split_details, mergedCandidates=merged)


def ratio_measure(value, denominator_value, denominator, tier):
    return dict(tier=tier, kind="ratio",
                pct=round(100 * value / denominator_value, 2) if denominator_value else None,
                value=value, denominator=denominator)


def absolute_measure(value, unit, tier):
    return dict(tier=tier, kind="absolute", value=value, unit=unit)


def unavailable_measure(tier, reason):
    return dict(tier=tier, kind="unavailable", unavailable=reason)


# ---- addressed shape and wall-rail diagnostics ------------------------------

MICRO_EDGE_MAX_FT = 1.0
MICRO_RUN_MIN_EDGES = 3
JOG_STEP_MAX_FT = 2.25
SHAPE_ANGLE_TOL_DEG = 0.25
PAIR_TOL_DEG = 3.0
PAIR_NOISE_FT = 0.06
PAIR_INK_TOL_FT = 0.3
PAIR_STEP_FT = 0.25
PAIR_MIN_LEN_FT = 1.0


def _rings(geometry):
    for part_index, part in enumerate(_polygon_parts(geometry)):
        yield part_index, "outer", collapse_collinear(list(part.exterior.coords))
        for ring_index, ring in enumerate(part.interiors):
            yield part_index, f"hole:{ring_index}", collapse_collinear(list(ring.coords))


def _edge(pts, index):
    a, b = pts[index], pts[(index + 1) % len(pts)]
    return a, b, math.hypot(b[0] - a[0], b[1] - a[1])


def _angle_difference_degrees(a, b):
    delta = abs(a - b) % math.pi
    return math.degrees(min(delta, math.pi - delta))


def shape_details(geometry):
    """Census severe MicroStepRun chains separately from single DeJog-shaped steps."""
    stairsteps, jogs = [], []
    for part_index, ring_name, pts in _rings(geometry):
        if len(pts) < 3:
            continue
        edges = [_edge(pts, i) for i in range(len(pts))]
        short = [edge[2] <= MICRO_EDGE_MAX_FT + EPS for edge in edges]
        runs = []
        if all(short):
            runs.append(list(range(len(edges))))
        else:
            for start in range(len(edges)):
                if not short[start] or short[(start - 1) % len(edges)]:
                    continue
                indices = []
                while len(indices) < len(edges) and short[(start + len(indices)) % len(edges)]:
                    indices.append((start + len(indices)) % len(edges))
                if len(indices) >= MICRO_RUN_MIN_EDGES:
                    runs.append(indices)
        severe_edges = {index for run in runs for index in run}
        for indices in runs:
            first, last = edges[indices[0]], edges[indices[-1]]
            stairsteps.append(dict(
                part=part_index, ring=ring_name, edgeIndexes=indices,
                edgeCount=len(indices), spanFt=round(sum(edges[i][2] for i in indices), 4),
                **{"from": _point(*first[0]), "to": _point(*last[1])}))

        for index, (a, b, step) in enumerate(edges):
            if index in severe_edges or step > JOG_STEP_MAX_FT + EPS:
                continue
            previous = edges[(index - 1) % len(edges)]
            following = edges[(index + 1) % len(edges)]
            prev_angle = math.atan2(previous[1][1] - previous[0][1],
                                    previous[1][0] - previous[0][0])
            step_angle = math.atan2(b[1] - a[1], b[0] - a[0])
            next_angle = math.atan2(following[1][1] - following[0][1],
                                    following[1][0] - following[0][0])
            same_direction = (math.cos(prev_angle) * math.cos(next_angle)
                              + math.sin(prev_angle) * math.sin(next_angle)) > 0
            if (not same_direction
                    or _angle_difference_degrees(prev_angle, next_angle) > SHAPE_ANGLE_TOL_DEG
                    or abs(_angle_difference_degrees(prev_angle, step_angle) - 90)
                    > SHAPE_ANGLE_TOL_DEG):
                continue
            jogs.append(dict(part=part_index, ring=ring_name, edgeIndex=index,
                             stepFt=round(step, 4),
                             **{"from": _point(*a), "to": _point(*b)}))
    return dict(
        stairstepRunCount=len(stairsteps),
        stairstepEdges=sum(run["edgeCount"] for run in stairsteps),
        maxStairstepSpanFt=max((run["spanFt"] for run in stairsteps), default=0.0),
        stairstepRuns=stairsteps,
        microJogCount=len(jogs),
        microJogs=jogs)


def zone_loop_segments(loops):
    segments = []
    for loop in loops:
        pts = [tuple(p[:2]) for p in loop]
        if len(pts) >= 2 and pts[0] == pts[-1]:
            pts = pts[:-1]
        for i in range(len(pts)):
            a, b = pts[i], pts[(i + 1) % len(pts)]
            if math.hypot(b[0] - a[0], b[1] - a[1]) > EPS:
                segments.append((a, b))
    return segments


def geometry_segments(geometry):
    return [(a, b) for _, _, pts in _rings(geometry)
            for i in range(len(pts)) for a, b, length in [_edge(pts, i)] if length > EPS]


def double_line_pairs(geometry, segments, ink, band_ft=WALL_BAND_FT):
    """Room edges offset from another authority while both occupy one seed-ink wall band."""
    pairs = []
    for part_index, ring_name, pts in _rings(geometry):
        for edge_index in range(len(pts)):
            (x0, y0), (x1, y1), edge_len = _edge(pts, edge_index)
            if edge_len <= EPS:
                continue
            edge_angle = math.atan2(y1 - y0, x1 - x0)
            for segment_index, (sa, sb) in enumerate(segments):
                ux, uy = sb[0] - sa[0], sb[1] - sa[1]
                segment_len = math.hypot(ux, uy)
                ux, uy = ux / segment_len, uy / segment_len
                if _angle_difference_degrees(
                        edge_angle, math.atan2(sb[1] - sa[1], sb[0] - sa[0])) > PAIR_TOL_DEG:
                    continue

                def offset_of(px, py):
                    return (px - sa[0]) * -uy + (py - sa[1]) * ux

                def along_of(px, py):
                    return (px - sa[0]) * ux + (py - sa[1]) * uy

                o0, o1 = offset_of(x0, y0), offset_of(x1, y1)
                if max(abs(o0), abs(o1)) <= PAIR_NOISE_FT:
                    continue
                if min(abs(o0), abs(o1)) > band_ft:
                    continue
                t0, t1 = along_of(x0, y0), along_of(x1, y1)
                if max(t0, t1) < 0 or min(t0, t1) > segment_len:
                    continue
                count = max(2, int(math.ceil(edge_len / PAIR_STEP_FT)) + 1)
                qualifying = []
                for edge_t in np.linspace(0.0, 1.0, count):
                    px, py = x0 + (x1 - x0) * edge_t, y0 + (y1 - y0) * edge_t
                    offset = o0 + (o1 - o0) * edge_t
                    along = t0 + (t1 - t0) * edge_t
                    if (along < -EPS or along > segment_len + EPS
                            or abs(offset) <= PAIR_NOISE_FT or abs(offset) > band_ft):
                        continue
                    xs = [px - sweep * offset * -uy for sweep in (0, 0.25, 0.5, 0.75, 1.0)]
                    ys = [py - sweep * offset * ux for sweep in (0, 0.25, 0.5, 0.75, 1.0)]
                    if bool(np.all(ink.distance_ft(xs, ys) <= PAIR_INK_TOL_FT + EPS)):
                        qualifying.append(abs(offset))
                length = len(qualifying) * edge_len / (count - 1)
                if length >= PAIR_MIN_LEN_FT:
                    pairs.append(dict(
                        part=part_index, ring=ring_name, edgeIndex=edge_index,
                        **{"from": _point(x0, y0), "to": _point(x1, y1)},
                        lengthFt=round(length, 1),
                        meanOffsetFt=round(float(np.mean(qualifying)), 2),
                        targetSegmentIndex=segment_index))
                    break
    return pairs


def sibling_double_line_pairs(polygons, ink):
    """Each unordered candidate pair is measured once; exact shared edges are excluded."""
    details = []
    ordered = sorted(polygons, key=lambda item: (item[0], item[1]))
    for index, (disposition_a, id_a, geometry_a) in enumerate(ordered):
        for disposition_b, id_b, geometry_b in ordered[index + 1:]:
            for pair in double_line_pairs(geometry_a, geometry_segments(geometry_b), ink):
                pair.update(room=id_a, disposition=disposition_a,
                            siblingRoom=id_b, siblingDisposition=disposition_b)
                details.append(pair)
    return details


def _sibling_pair_groups(pairs):
    groups = {key: {"pairs": 0, "feet": 0.0}
              for key in ("accepted-accepted", "accepted-held", "held-held")}
    for pair in pairs:
        key = "-".join(sorted((pair["disposition"], pair["siblingDisposition"])))
        groups[key]["pairs"] += 1
        groups[key]["feet"] += pair["lengthFt"]
    for group in groups.values():
        group["feet"] = round(group["feet"], 1)
    return groups


def _merge_group_totals(group_sets):
    result = {key: {"pairs": 0, "feet": 0.0}
              for key in ("accepted-accepted", "accepted-held", "held-held")}
    for groups in group_sets:
        for key, values in groups.items():
            result[key]["pairs"] += values["pairs"]
            result[key]["feet"] += values["feet"]
    for group in result.values():
        group["feet"] = round(group["feet"], 1)
    return result


def _shape_by_disposition(polygons):
    result = {}
    for disposition in ("accepted", "held"):
        selected = [p for p in polygons if p["disposition"] == disposition]
        result[disposition] = dict(
            stairstepRuns=sum(p["stairstepRunCount"] for p in selected),
            stairstepEdges=sum(p["stairstepEdges"] for p in selected),
            maxStairstepSpanFt=max(
                (p["maxStairstepSpanFt"] for p in selected), default=0.0),
            microJogCount=sum(p["microJogCount"] for p in selected))
    return result


# ---- report loading ----------------------------------------------------------

def load_report(path):
    with open(path, encoding="utf-8") as f:
        report = json.load(f)
    return report, os.path.dirname(os.path.abspath(path))


RECAPTURE_RUNBOOK = ("docs/features/takeoffs/manual-e2e-runbook.md "
                     "(Capture step writes replay_<level>.bin)")


def load_levels(report, base):
    """token -> ink-only and C#-lawful evidence Grids for each level.

    Seed ink comes from the replay snapshot ONLY. The stale ink_*.bin fallback lane was
    deleted 2026-08-17 (Attic bin was missing 51% of replay seed cells); a missing replay
    is a hard error. Current INKC attribution is also required; merged seals are lossy."""
    levels = {}
    for zone in report["Zones"]:
        token, _ = LEVELS[zone["Level"]]
        if token in levels:
            continue
        # zone["Ink"] is report schema (C#-owned); eval only uses it to locate the replay
        # snapshot that sits alongside — the ink bin itself is never read.
        replay_path = os.path.join(base, os.path.dirname(zone["Ink"]),
                                   f"replay_{token}.bin")
        if not os.path.isfile(replay_path):
            raise SystemExit(
                f"missing replay seed ink: {replay_path}\n"
                f"replay_<level>.bin is the only evidence source (stale ink_*.bin lane "
                f"deleted). Recapture: {RECAPTURE_RUNBOOK}")
        ink = Grid.load_replay_seed_ink(replay_path)
        seals_path = os.path.join(base, zone["Seals"])
        classes_path = os.path.join(os.path.dirname(seals_path),
                                    os.path.basename(seals_path).replace("seals_", "classes_", 1))
        if not os.path.isfile(classes_path):
            levels[token] = dict(
                ink=ink, evidence=None,
                evidenceUnavailable=f"missing INKC seal attribution: {classes_path}")
            continue
        w, h, minx, miny, cell, data = overlay.load_classes(classes_path)
        classes = np.frombuffer(data, dtype=np.uint8)
        if classes.size != w * h:
            raise SystemExit(f"truncated INKC seal attribution: {classes_path}")
        door_heads = Grid((classes == 2).reshape(h, w), minx, miny, cell)
        if (ink.h, ink.w, ink.minx, ink.miny, ink.cell) \
                != (door_heads.h, door_heads.w, door_heads.minx, door_heads.miny, door_heads.cell):
            raise SystemExit(f"INKC seal attribution disagrees with replay grid: {classes_path}")
        levels[token] = dict(ink=ink, evidence=Grid.union(ink, door_heads),
                             evidenceUnavailable=None)
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


# ---- oracle hygiene (currency v1.1) ------------------------------------------

GUEST_HOUSE_MARK = "Guest House"
DEDUPE_OVERLAP_FRACTION = 0.40


def _boundary_median_ink_ft(geometry, grid):
    """Median boundary-sample distance (ft) to seed ink — the dedupe registration key."""
    xs, ys = edge_sample_points(geometry)
    if xs.size == 0:
        return math.inf
    dist = grid.distance_ft(xs, ys)
    dist = dist[np.isfinite(dist)]
    return float(np.median(dist)) if dist.size else math.inf


def clean_oracle(oracle, floor_grids):
    """Currency v1.1 oracle hygiene (R3b). Returns (cleaned oracle, {number: reason}).

    R1 cross-building: drop rooms whose sourcePdf names the Guest House — a separate
       building's takeoff pages misregistered onto the main model's floors.
    R2 duplicate claims: same-floor pairs overlapping > DEDUPE_OVERLAP_FRACTION of the
       smaller polygon are contradictions (real rooms tile). Keep the copy whose boundary
       registers better on THIS model's replay seed ink (lower median boundary-sample
       distance); drop the other.

    FALSIFIER: a dropped room later accepted cleanly at its exact footprint means the
    dedupe kept the wrong copy."""
    rooms = oracle["rooms"]
    dropped = {}

    for number, room in rooms.items():
        if GUEST_HOUSE_MARK in room.get("sourcePdf", ""):
            dropped[number] = "guest-house source"

    by_floor = {}
    for number, room in rooms.items():
        if number in dropped:
            continue
        polygon = room.get("polygonModelFt")
        if not polygon or len(polygon) < 3:
            continue
        geometry = overlay._valid_polygonal(Polygon(polygon))
        if geometry.is_empty:
            continue
        by_floor.setdefault(room["floor"], []).append((number, geometry))

    for floor, entries in by_floor.items():
        grid = floor_grids.get(floor)
        registration = {number: (_boundary_median_ink_ft(geometry, grid)
                                 if grid is not None else 0.0)
                        for number, geometry in entries}
        for i in range(len(entries)):
            for j in range(i + 1, len(entries)):
                number_a, geometry_a = entries[i]
                number_b, geometry_b = entries[j]
                if number_a in dropped or number_b in dropped:
                    continue
                smaller = min(geometry_a.area, geometry_b.area)
                if smaller <= EPS:
                    continue
                inter = geometry_a.intersection(geometry_b).area
                if inter <= DEDUPE_OVERLAP_FRACTION * smaller:
                    continue
                loser, winner = ((number_a, number_b)
                                 if registration[number_a] > registration[number_b]
                                 else (number_b, number_a))
                dropped[loser] = (
                    f"duplicate of #{winner} (overlap {inter / smaller:.0%}, ink-reg "
                    f"{registration[loser]:.2f} vs {registration[winner]:.2f} ft)")

    cleaned = dict(oracle)
    cleaned["rooms"] = {number: room for number, room in rooms.items()
                        if number not in dropped}
    return cleaned, dropped


def _floor_grids(levels):
    """floor -> seed-ink Grid, for hygiene registration scoring."""
    return {floor: levels[token]["ink"]
            for _, (token, floor) in LEVELS.items() if token in levels}


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

def score_report(report_path, clean=True):
    """clean=True uses the v1.1 hygiene-cleaned oracle; clean=False keeps raw v1.
    Both savedWork variants are historical diagnostics, never adoption authority."""
    report, base = load_report(report_path)
    levels = load_levels(report, base)
    oracle = load_oracle()
    hygiene = None
    if clean:
        oracle, dropped = clean_oracle(oracle, _floor_grids(levels))
        hygiene = dict(
            droppedRooms=dropped,
            droppedGuestHouse=sum(1 for r in dropped.values()
                                  if r.startswith("guest-house")),
            droppedDuplicates=sum(1 for r in dropped.values()
                                  if r.startswith("duplicate")),
            rawOracleRooms=len(dropped) + len(oracle["rooms"]))
    oracle_rooms = oracle_rooms_by_floor(oracle)

    zones_out = []
    room_status = {}   # oracle room number -> (status, quality) for board rollup
    for zone in report["Zones"]:
        token, floor = LEVELS[zone["Level"]]
        grids = levels.get(token)
        zgeom = zone_geometry(zone["ZoneLoops"])
        zboundary = zgeom.boundary
        frame = frame_angle_deg(zone["ZoneLoops"])
        accepted, held = load_zone_polygons(os.path.join(base, zone["Tsv"]))
        zone_segments = zone_loop_segments(zone["ZoneLoops"])

        polys_out = []
        agg = {"accepted": [0, 0], "held": [0, 0]}          # evidence-rail hits/samples
        agg_no_exempt = [0, 0]                              # accepted, no exemption (C# mirror)
        agg_no_exempt_ink = [0, 0]
        for disposition, table in (("accepted", accepted), ("held", held)):
            for pid, geometry in sorted(table.items()):
                segments = geometry_segments(geometry)
                row = dict(zone=zone["Zone"], id=pid, disposition=disposition,
                           sqft=round(geometry.area, 1),
                           boundaryFt=round(sum(LineString(segment).length
                                                for segment in segments), 1),
                           boundaryEdges=len(segments),
                           leakSf=round(geometry.difference(zgeom).area, 1))
                if grids:
                    frac_ink, _, _ = backed_stats(geometry, grids["ink"], zboundary)
                    row["edgeOnInkInkOnly"] = (None if frac_ink is None
                                                else round(frac_ink, 4))
                    if grids["evidence"] is not None:
                        frac, sampled, exempt = backed_stats(
                            geometry, grids["evidence"], zboundary)
                        unbacked = worst_unbacked_run(
                            geometry, grids["evidence"], zboundary)
                        row.update(edgeOnInk=None if frac is None else round(frac, 4),
                                   sampled=sampled, exemptSamples=exempt,
                                   backedSamples=(int(round(frac * sampled))
                                                  if frac is not None else 0),
                                   worstUnbackedRunFt=unbacked["lengthFt"] if unbacked else 0.0,
                                   worstUnbackedRun=unbacked)
                        if frac is not None:
                            agg[disposition][0] += frac * sampled
                            agg[disposition][1] += sampled
                    else:
                        row["evidenceUnavailable"] = grids["evidenceUnavailable"]
                    if disposition == "accepted" and grids["evidence"] is not None:
                        xs, ys = edge_sample_points(geometry)
                        hits = grids["evidence"].distance_ft(xs, ys) <= HIT_FT + EPS
                        agg_no_exempt[0] += int(hits.sum()); agg_no_exempt[1] += hits.size
                        hits_ink = grids["ink"].distance_ft(xs, ys) <= HIT_FT + EPS
                        agg_no_exempt_ink[0] += int(hits_ink.sum()); agg_no_exempt_ink[1] += hits_ink.size
                    swallow = interior_swallow(geometry, grids["ink"], zboundary)
                    row.update(swallowSf=round(swallow, 1),
                               swallowFraction=round(swallow / geometry.area, 4)
                               if geometry.area > EPS else 0.0,
                               interiorWallRunFt=interior_wall_run_ft(
                                   geometry, grids["ink"], zboundary))
                    pairs = double_line_pairs(geometry, zone_segments, grids["ink"])
                    row.update(doubleLinePairs=len(pairs),
                               doubleLineFt=round(sum(p["lengthFt"] for p in pairs), 1),
                               doubleLineDetails=pairs)
                row.update(shape_details(geometry))
                row.update(ortho_stats(geometry, frame))
                polys_out.append(row)

        sibling_pairs = (sibling_double_line_pairs(
            [(disposition, pid, geometry)
             for disposition, table in (("accepted", accepted), ("held", held))
             for pid, geometry in table.items()], grids["ink"])
            if grids else [])
        shared_edges = (sibling_shared_edge_stats(
            [(disposition, pid, geometry)
             for disposition, table in (("accepted", accepted), ("held", held))
             for pid, geometry in table.items()], grids["ink"])
            if grids else dict(sharedFt=0.0, unbackedFt=0.0, details=[]))
        stairstep_details = [dict(zone=zone["Zone"], room=p["id"],
                                  disposition=p["disposition"], **detail)
                             for p in polys_out for detail in p["stairstepRuns"]]
        micro_jog_details = [dict(zone=zone["Zone"], room=p["id"],
                                  disposition=p["disposition"], **detail)
                             for p in polys_out for detail in p["microJogs"]]

        # room recall against oracle rooms whose representative point is in this zone
        zone_oracle = [r for r in oracle_rooms.get(floor, []) if zgeom.contains(r["point"])]
        oracle_existence = oracle_existence_stats(
            [(disposition, pid, geometry)
             for disposition, table in (("accepted", accepted), ("held", held))
             for pid, geometry in table.items()], zone_oracle)
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
                edge = row_for.get("edgeOnInk")
                quality = (None if row_for.get("evidenceUnavailable") else
                           0.7 * (edge or 0.0) + 0.3 * row_for["onFrameLenFraction"])
            if status == "accepted":
                recalled += 1
            elif status == "held":
                held_count += 1
            contribution = (quality if status == "accepted" else
                            0.25 * quality if status == "held" and quality is not None else
                            0.0 if status == "missing" else None)
            oracle_rows.append(dict(number=room["number"], name=room["name"],
                                    confidence=room["confidence"], status=status,
                                    matchedId=match,
                                    quality=None if quality is None else round(quality, 4)))
            previous = room_status.get(room["number"])
            if (previous is None or
                    (contribution is not None
                     and (previous[1] is None or contribution > previous[1]))):
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
                                 else 0.25 * quality
                                 if status == "held" and quality is not None
                                 else 0.0 if status == "missing" else None)
        zones_out.append(dict(
            zone=zone["Zone"], level=zone["Level"], verdict=zone["triage"]["verdict"],
            zoneGeometryHash=_zone_geometry_hash(zone),
            zoneSqft=zone["ZoneSqft"], frameDeg=round(frame, 2),
            evidenceUnavailable=grids.get("evidenceUnavailable") if grids else None,
            StrictlyEditable=zone.get("StrictlyEditable"), Contained=zone.get("Contained"),
            ClosureErrorSqft=zone.get("ClosureErrorSqft"), GapSqft=zone.get("GapSqft"),
            OverlapSqft=zone.get("OverlapSqft"),
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
            medianWorstUnbackedRunAccepted=_median_worst_run(polys_out, "accepted"),
            medianWorstUnbackedRunHeld=_median_worst_run(polys_out, "held"),
            maxUnbackedRun=_max_unbacked_run(polys_out, zone["Zone"]),
            doubleLinePairs=sum(p.get("doubleLinePairs", 0) for p in polys_out),
            doubleLineFt=round(sum(p.get("doubleLineFt", 0.0) for p in polys_out), 1),
            doubleLinePairsAccepted=sum(p.get("doubleLinePairs", 0) for p in polys_out
                                        if p["disposition"] == "accepted"),
            doubleLineFtAccepted=round(sum(p.get("doubleLineFt", 0.0) for p in polys_out
                                           if p["disposition"] == "accepted"), 1),
            doubleLinePairsHeld=sum(p.get("doubleLinePairs", 0) for p in polys_out
                                    if p["disposition"] == "held"),
            doubleLineFtHeld=round(sum(p.get("doubleLineFt", 0.0) for p in polys_out
                                       if p["disposition"] == "held"), 1),
            siblingDoubleLinePairs=len(sibling_pairs),
            siblingDoubleLineFt=round(sum(p["lengthFt"] for p in sibling_pairs), 1),
            siblingDoubleLineByDisposition=_sibling_pair_groups(sibling_pairs),
            siblingDoubleLineDetails=sibling_pairs,
            siblingSharedEdges=shared_edges,
            oracleExistence=oracle_existence,
            stairstepRuns=len(stairstep_details),
            stairstepEdges=sum(detail["edgeCount"] for detail in stairstep_details),
            maxStairstepSpanFt=max(
                (detail["spanFt"] for detail in stairstep_details), default=0.0),
            stairstepDetails=stairstep_details,
            microJogCount=len(micro_jog_details), microJogDetails=micro_jog_details,
            shapeByDisposition=_shape_by_disposition(polys_out),
            savedWork=(round(float(np.mean(contributions)), 4)
                       if contributions and all(v is not None for v in contributions) else None),
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
        savedWork=(round(sum(q for _, q in room_status.values()) / total, 4)
                   if total and all(q is not None for _, q in room_status.values()) else None),
        edgeOnInkAccepted=_weighted_edge(all_polys, "accepted"),
        edgeOnInkHeld=_weighted_edge(all_polys, "held"),
        swallowSf=round(sum(p.get("swallowSf", 0.0) for p in all_polys
                            if p["disposition"] == "accepted"), 1),
        meanEditCostAccepted=round(np.mean([p["editCost"] for p in all_polys
                                             if p["disposition"] == "accepted"]), 2)
        if any(p["disposition"] == "accepted" for p in all_polys) else None,
        medianWorstUnbackedRunAccepted=_median_worst_run(all_polys, "accepted"),
        medianWorstUnbackedRunHeld=_median_worst_run(all_polys, "held"),
        maxUnbackedRun=_max_unbacked_run(all_polys),
        doubleLinePairs=sum(z["doubleLinePairs"] for z in zones_out),
        doubleLineFt=round(sum(z["doubleLineFt"] for z in zones_out), 1),
        doubleLinePairsAccepted=sum(z["doubleLinePairsAccepted"] for z in zones_out),
        doubleLineFtAccepted=round(sum(z["doubleLineFtAccepted"] for z in zones_out), 1),
        doubleLinePairsHeld=sum(z["doubleLinePairsHeld"] for z in zones_out),
        doubleLineFtHeld=round(sum(z["doubleLineFtHeld"] for z in zones_out), 1),
        siblingDoubleLinePairs=sum(z["siblingDoubleLinePairs"] for z in zones_out),
        siblingDoubleLineFt=round(sum(z["siblingDoubleLineFt"] for z in zones_out), 1),
        siblingDoubleLineByDisposition=_merge_group_totals(
            [z["siblingDoubleLineByDisposition"] for z in zones_out]),
        stairstepRuns=sum(z["stairstepRuns"] for z in zones_out),
        stairstepEdges=sum(z["stairstepEdges"] for z in zones_out),
        maxStairstepSpanFt=max((z["maxStairstepSpanFt"] for z in zones_out), default=0.0),
        microJogCount=sum(z["microJogCount"] for z in zones_out),
        shapeByDisposition=_shape_by_disposition(all_polys),
        distanceBuckets={b: sum(1 for d in all_dist if d["bucket"] == b)
                         for b in ("as-is", "nudge", "redraw")},
        unzonedOracleRooms=unzoned)
    return dict(metricSchemaVersion=2,
                identity=_score_identity(report),
                currency="v1.1 (cleaned oracle; historical diagnostic)"
                if clean else "v1 (raw oracle; historical diagnostic)",
                savedWorkUse="historical-diagnostic-not-adoption",
                oracleHygiene=hygiene, board=board, zones=zones_out)


def _weighted_edge(polys, disposition):
    num = den = 0.0
    for p in polys:
        if p["disposition"] != disposition or p.get("edgeOnInk") is None:
            continue
        num += p["edgeOnInk"] * p["sampled"]
        den += p["sampled"]
    return round(num / den, 4) if den else None


def _median_worst_run(polys, disposition):
    values = [p["worstUnbackedRunFt"] for p in polys
              if p["disposition"] == disposition and "worstUnbackedRunFt" in p]
    return round(float(np.median(values)), 4) if values else None


def _max_unbacked_run(polys, zone=None):
    candidates = [(p, p.get("worstUnbackedRun")) for p in polys
                  if p.get("worstUnbackedRun")]
    if not candidates:
        return None
    polygon, detail = max(candidates, key=lambda item: item[1]["lengthFt"])
    return dict(zone=zone or polygon["zone"], room=polygon["id"],
                disposition=polygon["disposition"], **detail)


def _zone_geometry_hash(zone):
    payload = json.dumps(
        {"zone": zone["Zone"], "loops": zone["ZoneLoops"]},
        ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode("utf-8")
    return hashlib.sha256(payload).hexdigest()


def _score_identity(report):
    zone_hashes = [_zone_geometry_hash(zone) for zone in report["Zones"]]
    digest = hashlib.sha256("\n".join(zone_hashes).encode("ascii")).hexdigest()
    return dict(reportSchemaVersion=report.get("SchemaVersion"),
                optionsHash=report.get("optionsHash"),
                zoneFilter=report.get("zoneFilter"),
                zoneGeometryHash=digest)


def _ratio_by_disposition(zones, value_key, denominator_key, tier=1):
    result = {}
    for disposition in ("accepted", "held"):
        polys = [p for zone in zones for p in zone["polygons"]
                 if p["disposition"] == disposition]
        value = round(sum(p.get(value_key, 0.0) for p in polys), 1)
        denominator = round(sum(p.get(denominator_key, 0.0) for p in polys), 1)
        result[disposition] = ratio_measure(
            value, denominator, denominator_key, tier)
    return result


def _shared_edge_measures(zones, oracle=False):
    result = {}
    key = "oracleSplitFt" if oracle else "unbackedFt"
    details_key = "splitDetails" if oracle else "details"
    container = "oracleExistence" if oracle else "siblingSharedEdges"
    for disposition in ("accepted", "held"):
        details = [detail for zone in zones for detail in zone[container][details_key]
                   if disposition in (detail["disposition"], detail["siblingDisposition"])]
        result[disposition] = ratio_measure(
            round(sum(detail[key] for detail in details), 1),
            round(sum(detail["sharedFt"] for detail in details), 1),
            "siblingSharedEdgeFt", 2 if oracle else 1)
    return result


def _edge_on_ink_measures(zones):
    result = {}
    zone_reasons = sorted({zone["evidenceUnavailable"] for zone in zones
                           if zone.get("evidenceUnavailable")})
    for disposition in ("accepted", "held"):
        polys = [p for zone in zones for p in zone["polygons"]
                 if p["disposition"] == disposition]
        reasons = sorted(set(zone_reasons) | {p["evidenceUnavailable"] for p in polys
                                              if p.get("evidenceUnavailable")})
        if reasons:
            result[disposition] = unavailable_measure(1, "; ".join(reasons))
            continue
        denominator = sum(p.get("sampled") or 0 for p in polys)
        value = sum(p.get("backedSamples") or 0 for p in polys)
        result[disposition] = ratio_measure(
            value, denominator, "eligibleBoundarySamples", 1)
    return result


def _worst_run_measures(zones):
    result = {}
    zone_reasons = sorted({zone["evidenceUnavailable"] for zone in zones
                           if zone.get("evidenceUnavailable")})
    for disposition in ("accepted", "held"):
        polys = [p for zone in zones for p in zone["polygons"]
                 if p["disposition"] == disposition]
        reasons = sorted(set(zone_reasons) | {p["evidenceUnavailable"] for p in polys
                                              if p.get("evidenceUnavailable")})
        if reasons:
            result[disposition] = unavailable_measure(1, "; ".join(reasons))
            continue
        worst = max(polys, key=lambda p: p.get("worstUnbackedRunFt", 0.0), default=None)
        result[disposition] = ratio_measure(
            worst.get("worstUnbackedRunFt", 0.0) if worst else 0.0,
            worst.get("boundaryFt", 0.0) if worst else 0.0,
            "boundaryFtOfWorstCandidate", 1)
    return result


def _shape_measures(zones, key, denominator, tier=1):
    result = {}
    for disposition in ("accepted", "held"):
        polys = [p for zone in zones for p in zone["polygons"]
                 if p["disposition"] == disposition]
        result[disposition] = ratio_measure(
            sum(p.get(key, 0) for p in polys),
            sum(p.get(denominator, 0) for p in polys), denominator, tier)
    return result


def _max_shape_span_measures(zones):
    result = {}
    for disposition in ("accepted", "held"):
        polys = [p for zone in zones for p in zone["polygons"]
                 if p["disposition"] == disposition]
        worst = max(polys, key=lambda p: p.get("maxStairstepSpanFt", 0.0), default=None)
        result[disposition] = ratio_measure(
            worst.get("maxStairstepSpanFt", 0.0) if worst else 0.0,
            worst.get("boundaryFt", 0.0) if worst else 0.0,
            "boundaryFtOfWorstCandidate", 1)
    return result


def _oracle_merged_measures(zones):
    result = {}
    for disposition in ("accepted", "held"):
        rows = [row for zone in zones
                for row in zone["oracleExistence"]["mergedCandidates"]
                if row["disposition"] == disposition]
        result[disposition] = ratio_measure(
            sum(row["excessOracleRooms"] for row in rows),
            sum(row["matchedOracleRooms"] for row in rows),
            "matchedOracleRooms", 2)
    return result


def _measure_axes(zones):
    polys = [p for zone in zones for p in zone["polygons"]]
    oracle_rows = [row for zone in zones for row in zone["oracleRoomStatus"]]
    total_candidate_area = sum(p["sqft"] for p in polys)
    area_share = {
        disposition: ratio_measure(
            round(sum(p["sqft"] for p in polys if p["disposition"] == disposition), 1),
            round(total_candidate_area, 1), "candidateAreaSf", 1)
        for disposition in ("accepted", "held")}
    empty = {
        disposition: ratio_measure(
            sum(not any(p["disposition"] == disposition for p in zone["polygons"])
                for zone in zones), len(zones), "zones", 1)
        for disposition in ("accepted", "held")}
    matched = {
        disposition: absolute_measure(
            sum(row["status"] == disposition for row in oracle_rows), "rooms", 2)
        for disposition in ("accepted", "held")}
    honesty = {}
    for name, field in (("strictlyEditable", "StrictlyEditable"),
                        ("contained", "Contained")):
        honesty[name] = (unavailable_measure(1, f"report predates {field}")
                         if any(zone.get(field) is None for zone in zones) else
                         ratio_measure(sum(bool(zone[field]) for zone in zones),
                                       len(zones), "zones", 1))
    for name, field in (("closureError", "ClosureErrorSqft"),
                        ("gap", "GapSqft"), ("overlap", "OverlapSqft")):
        honesty[name] = (unavailable_measure(1, f"report predates {field}")
                         if any(zone.get(field) is None for zone in zones) else
                         ratio_measure(
                             round(sum(zone[field] for zone in zones), 4),
                             round(sum(zone["zoneSqft"] for zone in zones), 1),
                             "zoneAreaSf", 1))
    return {
        "A_existence": {
            "overSegmentationInk": _shared_edge_measures(zones),
            "underSegmentationInk": _ratio_by_disposition(
                zones, "interiorWallRunFt", "boundaryFt"),
            "overSegmentationOracleCrossCheck": _shared_edge_measures(zones, oracle=True),
            "underSegmentationOracleCrossCheck": _oracle_merged_measures(zones),
            "matched": matched,
            "missing": absolute_measure(
                sum(row["status"] == "missing" for row in oracle_rows), "rooms", 2)},
        "B_extent": {
            "swallow": _ratio_by_disposition(zones, "swallowSf", "sqft"),
            "leak": _ratio_by_disposition(zones, "leakSf", "sqft")},
        "C_boundary": {
            "edgeOnInk": _edge_on_ink_measures(zones),
            "worstUnbackedRun": _worst_run_measures(zones),
            "doubleLine": _ratio_by_disposition(zones, "doubleLineFt", "boundaryFt")},
        "D_regularity": {
            "nonOrthogonalLength": _ratio_by_disposition(
                zones, "nonOrthogonalFt", "boundaryFt"),
            "stairstepEdges": _shape_measures(zones, "stairstepEdges", "boundaryEdges"),
            "maxStairstepSpan": _max_shape_span_measures(zones),
            "microJogs": _shape_measures(zones, "microJogCount", "boundaryEdges")},
        "E_coverage": {"emptyZones": empty, "areaShare": area_share},
        "F_honesty": honesty}


def measure_vector(scores, scores_raw_oracle):
    return {
        "metricSchemaVersion": 4,
        "identity": scores["identity"],
        "thresholds": {
            "inkBackedDistanceFt": {"value": HIT_FT,
                                    "why": "same one-cell evidence tolerance as edgeOnInk"},
            "interiorBoundaryBandFt": {"value": WALL_BAND_FT,
                                       "why": "reuses interior_swallow wall-claim band"},
            "interiorWallMinFt": {"value": INTERIOR_WALL_MIN_FT,
                                  "why": "rejects isolated marks shorter than a doorway-scale wall"},
            "interiorWallMinCandidateSpanPct": {
                "value": 100 * INTERIOR_WALL_SPAN_FRACTION,
                "why": "requires the ink run to cross half the candidate short span"},
            "sampleStepFt": {"value": SAMPLE_STEP_FT,
                             "why": "matches existing edge evidence sampling"}},
        "board": {"axes": _measure_axes(scores["zones"])},
        "zones": [{"zone": zone["zone"], "level": zone["level"],
                   "axes": _measure_axes([zone])} for zone in scores["zones"]],
        "historicalDiagnostics": {
            "savedWorkCleanedOracle": (
                unavailable_measure(2, "lawful edge evidence unavailable")
                if scores["board"]["savedWork"] is None else
                ratio_measure(
                    round(scores["board"]["savedWork"]
                          * scores["board"]["oracleRoomsInZones"], 2),
                    scores["board"]["oracleRoomsInZones"], "oracleRoomsInZones", 2)),
            "savedWorkRawOracle": (
                unavailable_measure(2, "lawful edge evidence unavailable")
                if scores_raw_oracle["board"]["savedWork"] is None else
                ratio_measure(
                    round(scores_raw_oracle["board"]["savedWork"]
                          * scores_raw_oracle["board"]["oracleRoomsInZones"], 2),
                    scores_raw_oracle["board"]["oracleRoomsInZones"],
                    "rawOracleRoomsInZones", 2))}}


def _print_measure_lines(node, path=""):
    if isinstance(node, dict) and "tier" in node and "kind" in node:
        if node["kind"] == "ratio":
            value = f"{node['pct']}% ({node['value']} / {node['denominator']})"
        elif node["kind"] == "absolute":
            value = f"{node['value']} {node['unit']} (absolute)"
        else:
            value = f"unavailable: {node['unavailable']}"
        print(f"[tier {node['tier']}] {path}: {value}")
        return
    if isinstance(node, dict):
        for key, value in node.items():
            _print_measure_lines(value, f"{path}.{key}" if path else key)


def _print_board(label, board):
    print(f"{label} oracleRooms={board['oracleRoomsInZones']} "
          f"recall={board['roomRecall']} held={board['heldRecall']} "
          f"missing={board['missing']} savedWork={board['savedWork']}")
    print(f"{' ' * len(label)} edgeOnInk acc={board['edgeOnInkAccepted']} "
          f"held={board['edgeOnInkHeld']} "
          f"swallowSf={board['swallowSf']} editCost={board['meanEditCostAccepted']} "
          f"buckets={board['distanceBuckets']}")
    print(f"{' ' * len(label)} worstUnbackedRun median acc="
          f"{board['medianWorstUnbackedRunAccepted']} "
          f"held={board['medianWorstUnbackedRunHeld']} max={board['maxUnbackedRun']}")
    print(f"{' ' * len(label)} doubleLine zone-room accepted="
          f"{board['doubleLinePairsAccepted']} pairs / {board['doubleLineFtAccepted']} ft "
          f"held={board['doubleLinePairsHeld']} pairs / {board['doubleLineFtHeld']} ft; "
          f"sibling geometric={board['siblingDoubleLinePairs']} pairs / "
          f"{board['siblingDoubleLineFt']} ft")
    print(f"{' ' * len(label)} shape stairsteps={board['stairstepRuns']} runs / "
          f"{board['stairstepEdges']} edges max={board['maxStairstepSpanFt']} ft "
          f"microJogs={board['microJogCount']} by disposition={board['shapeByDisposition']}")


def cmd_score(args):
    scores = score_report(args.report, clean=True)
    scores_v1 = score_report(args.report, clean=False)
    vector = measure_vector(scores, scores_v1)
    report, _ = load_report(args.report)
    print(f"report: {os.path.abspath(args.report)}  generated {report.get('GeneratedUtc')}")
    for name, threshold in vector["thresholds"].items():
        print(f"threshold {name}={threshold['value']}: {threshold['why']}")
    _print_measure_lines(vector["board"])
    _print_measure_lines(vector["historicalDiagnostics"], "historicalDiagnostics")
    if args.out:
        with open(args.out, "w", encoding="utf-8") as f:
            json.dump(vector, f, indent=1, sort_keys=True, allow_nan=False)
            f.write("\n")
        print(f"wrote {os.path.abspath(args.out)}")
    return vector


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
                "swallowSf", "meanEditCostAccepted", "medianWorstUnbackedRunAccepted",
                "medianWorstUnbackedRunHeld", "doubleLinePairs", "doubleLineFt",
                "siblingDoubleLinePairs", "siblingDoubleLineFt", "stairstepRuns",
                "stairstepEdges", "maxStairstepSpanFt", "microJogCount", "savedWork"]

HONESTY_TOL = 0.005  # kaitpw round-3 wording: "beyond ~0.005 noise"


def honesty_check(a, b, tol=HONESTY_TOL):
    """The per-room honesty bar (kaitpw, round-3 2026-08-16): no previously-accepted
    room's own edgeOnInk may fall beyond ~tol noise; zone/board averages are diagnostic
    only. Matched by room id + zone across two score dicts.

    Returns (violations, departed): violations = accepted-in-both rooms whose edgeOnInk
    fell more than tol; departed = rooms accepted in A but no longer accepted in B —
    a coverage change, judged separately (round-1 verdict: regressed acceptance can be
    valid when the room was never good), surfaced so it cannot pass silently."""
    violations, departed = [], []
    zones_b = {z["zone"]: z for z in b["zones"]}
    for zone_a in a["zones"]:
        zone_b = zones_b.get(zone_a["zone"])
        accepted_b = ({p["id"]: p for p in zone_b["polygons"]
                       if p["disposition"] == "accepted"} if zone_b else {})
        for poly_a in zone_a["polygons"]:
            if poly_a["disposition"] != "accepted" or poly_a.get("edgeOnInk") is None:
                continue
            poly_b = accepted_b.get(poly_a["id"])
            if poly_b is None:
                departed.append(dict(zone=zone_a["zone"], id=poly_a["id"],
                                     edgeOnInkWas=poly_a["edgeOnInk"]))
            elif (poly_b.get("edgeOnInk") is not None
                  and poly_a["edgeOnInk"] - poly_b["edgeOnInk"] > tol):
                violations.append(dict(zone=zone_a["zone"], id=poly_a["id"],
                                       edgeOnInkA=poly_a["edgeOnInk"],
                                       edgeOnInkB=poly_b["edgeOnInk"],
                                       fell=round(poly_a["edgeOnInk"]
                                                  - poly_b["edgeOnInk"], 4)))
    return violations, departed


def cmd_compare(args):
    a = score_report(args.report_a)
    b = score_report(args.report_b)
    # HONESTY comes FIRST: the bar every candidate must clear before any other number
    # is worth reading. Empty = pass.
    violations, departed = honesty_check(a, b)
    print(f"HONESTY (accepted rooms whose edgeOnInk fell >{HONESTY_TOL}; empty = pass)")
    if violations:
        for v in violations:
            print(f"  FALL {v['zone']:<20}{v['id']:<10}"
                  f"{v['edgeOnInkA']:.4f} -> {v['edgeOnInkB']:.4f}  (-{v['fell']})")
    else:
        print("  pass - no previously-accepted room got less honest")
    if departed:
        print(f"  note: {len(departed)} previously-accepted room(s) no longer accepted "
              f"(coverage change, judge separately): "
              + ", ".join(f"{d['zone']}/{d['id']}" for d in departed))
    print()
    za = {z["zone"]: z for z in a["zones"]}
    zb = {z["zone"]: z for z in b["zones"]}
    matches = _card_zone_names(list(za))
    report_a, _ = load_report(args.report_a)
    report_b, _ = load_report(args.report_b)
    print(f"A: {os.path.abspath(args.report_a)} ({report_a.get('GeneratedUtc')})")
    print(f"B: {os.path.abspath(args.report_b)} ({report_b.get('GeneratedUtc')})")
    print(f"currency: {a['currency']} both sides")
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
