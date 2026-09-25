using NetTopologySuite.Geometries;
using Pe.Revit.Space;

namespace Pe.Revit.Partition;

/// <summary>
///     The pure core: slice pieces plus a zone loop in, a partition out. No Document, no Revit call,
///     same answer for the same input. The rail network decides the rooms; this class carries locked
///     proposals, dispositions, support and accounting.
/// </summary>
public static class Solve {
    // Constants, not knobs. Each names the line that measured it.
    // FOOTGUN: zone-edge exemption. Boundary within this of the zone loop is not the room's own
    // boundary and is exempt from the ink gate. SHAPE.md stage 8.
    private const double ZoneEdgeExemptFt = 1.0;

    // FOOTGUN: header-only runs longer than this are not counted as backing. The evidence line
    // measured a doorway at 4 ft; a longer header-only run is a soffit, not a door head.
    private const double HeaderOnlyRunFt = 4.0;

    // FOOTGUN: boundary sampling pitch for support and ink-backing. solve_lines.py SAMPLE_FT.
    private const double SampleFt = 0.25;

    // FOOTGUN: accounting closes here or the solve throws. Domain law, ledger.
    private const double AreaTolSqft = 1e-6;

    private const int BufferQuadSegs = 2;
    private const int CloseQuadSegs = 4;

    private static readonly GeometryFactory Gf = new NetTopologySuite.NtsGeometryServices(GeometryOverlay.NG).CreateGeometryFactory();

    // FOOTGUN: smallest rail-bounded face kept as a room. Duryee's closets are 11, 20 and 22 sf; under this is a
    // chase or a junction scrap even when every edge is on a rail.
    private const double MinRailRoomSqft = 6.0;

    /// <summary>
    ///     Rooms from the rail network; the partition verb's solver. Locked proposals (a person's room regions,
    ///     from Rooms.cs) are carried through whole, so they survive a rerun; the rail faces fill the rest of the zone.
    ///     Architect proposals are not honoured yet: the rails decide every unlocked room.
    /// </summary>
    public static PartitionAnswer RunRails(PartitionInput input, Func<double, double, ProbeAnswer> probe) {
        var sw = System.Diagnostics.Stopwatch.StartNew();
        var zone = GeometryOf(input.ZoneLoops);
        var locked = input.Proposals.Where(p => p.IsLocked)
            .Select(p => (Proposal: p, Geom: IntersectArea(GeometryOf(p.Loops), zone)))
            .Where(p => !p.Geom.IsEmpty && p.Geom.Area > AreaTolSqft).ToList();
        var overlaps = new List<Geometry>();
        for (var i = 0; i < locked.Count; i++)
            for (var j = i + 1; j < locked.Count; j++) {
                var overlap = IntersectArea(locked[i].Geom, locked[j].Geom);
                if (overlap.Area > AreaTolSqft) overlaps.Add(overlap);
            }
        var contested = UnionOf(overlaps);
        var taken = UnionOf(locked.Select(p => p.Geom).ToList());
        var net = Rails.Network(Rails.From(input).Concat(Rails.Studs(input)).ToList(), input.ZoneLoops, OpeningEvidence.From(input));
        var faces = Rails.Faces(net);
        var lockedParts = locked.SelectMany(p => Polys(p.Geom.Difference(contested)).Select(g => (Geom: (Geometry)g, p.Proposal))).ToList();
        List<Polygon> Free(IEnumerable<Polygon> parts) => taken.IsEmpty ? parts.ToList() : parts.SelectMany(f => Polys(f.Difference(taken))).ToList();
        // A rail room clipped by a locked room leaves scraps where the person's edge runs beside a rail. A clipped
        // piece thinner than a face goes to the locked room it borders longest, as Rails.Faces absorbs thin faces;
        // Rooms.cs never redraws a locked room, so the scrap is accounted and never drawn.
        var free = new List<Polygon>();
        foreach (var f in faces.Rooms) {
            var parts = Free([f]);
            if (parts.Count == 1 && Math.Abs(parts[0].Area - f.Area) <= AreaTolSqft) { free.Add(parts[0]); continue; }
            foreach (var part in parts) {
                var (best, len) = (-1, 1e-6);
                if (part.Buffer(-Rails.MinFaceWidthFt / 2).IsEmpty)
                    for (var k = 0; k < lockedParts.Count; k++) {
                        var shared = lockedParts[k].Geom.Boundary.Intersection(part.Boundary).Length;
                        if (shared > len) (best, len) = (k, shared);
                    }
                if (best < 0) free.Add(part);
                else lockedParts[best] = (UnionOf([lockedParts[best].Geom, part]), lockedParts[best].Proposal);
            }
        }
        var bands = Free(faces.Bands);
        // Locked rooms, rail rooms, bands too wide to be wall (held), locked overlaps (held), then envelope bands (excluded wall).
        var wide = bands.Select(b => (b, w: Rails.Width(b))).Where(x => x.w > Rails.BandHoldFt).ToList();
        var shapes = new List<Geometry>();
        var proposals = new List<RoomProposal?>();
        foreach (var (geom, proposal) in lockedParts)
            foreach (var part in Polys(geom)) { shapes.Add(part); proposals.Add(proposal); }
        var wideStart = shapes.Count + free.Count;
        foreach (var part in free.Concat(wide.Select(x => x.b))) { shapes.Add(part); proposals.Add(null); }
        var conflictStart = shapes.Count;
        foreach (var part in Polys(contested)) { shapes.Add(part); proposals.Add(null); }
        var roomCount = shapes.Count;
        foreach (var part in bands.Except(wide.Select(x => x.b))) { shapes.Add(part); proposals.Add(null); }
        AssertCoverage(shapes, zone, "rails partition", true);
        // A locked room's edge is a person's wall, as the zone edge is: it backs its neighbours and never floats.
        var knee = Buffered(input.Knee, input.Knobs.InkHalfWidthFt);
        if (!taken.IsEmpty) knee = UnionOf([knee, taken.Boundary.Buffer(input.Knobs.InkHalfWidthFt, BufferQuadSegs)]);
        var backing = Reach(knee, Buffered(input.Header, input.Knobs.InkHalfWidthFt), input.Knobs);
        var floating = Rails.Floating(net, taken.IsEmpty ? null : taken.Boundary);
        // A face bounded only by rails, bars and the zone edge is a room however small, down to a closet's floor.
        string? Small(Geometry g) => g.Area < MinRailRoomSqft ? Reasons.TooSmallTiny
            : g.Area < input.Knobs.MinRoomSqft && floating(g) > SampleFt ? Reasons.TooSmallFloating : null;
        var rooms = Shape(shapes, proposals, roomCount, conflictStart, probe, backing, zone, input.LevelZ, input.Knobs, Small).ToList();
        for (var k = 0; k < wide.Count; k++)
            rooms[wideStart + k] = rooms[wideStart + k] with { Disposition = Disposition.Held, Reason = $"envelope-band-{wide[k].w:0.0}ft" };
        var acc = new Accounting(zone.Area,
            rooms.Where(r => r.Disposition == Disposition.Accepted).Sum(r => r.AreaSqft),
            rooms.Where(r => r.Disposition == Disposition.Held).Sum(r => r.AreaSqft),
            rooms.Where(r => r.Disposition == Disposition.Void).Sum(r => r.AreaSqft),
            rooms.Where(r => r.Disposition == Disposition.Excluded).Sum(r => r.AreaSqft));
        if (Math.Abs(acc.ZoneSqft - acc.Accepted - acc.Held - acc.Void - acc.Excluded) > AreaTolSqft)
            throw new PartitionException("serialized partition accounting does not close");
        return new PartitionAnswer(input.Knee.Stamp, input.Knee.Searched, input.Knobs, rooms, acc, null,
            input.Resolved, input.EnclosureSource, Math.Round(sw.Elapsed.TotalMilliseconds, 3));
    }

    // ---------------------------------------------------------------- ink

    private static Geometry Buffered(SliceAnswer band, double half) {
        var parts = new List<Geometry>();
        foreach (var e in band.Elements)
            foreach (var ring in e.Pieces) {
                var g = Piece(ring);
                if (g is not null) parts.Add(g.Buffer(half, BufferQuadSegs));
            }

        return UnionOf(parts);
    }

    /// <summary>A slice piece is a convex x,y projection. Point projections are dropped.</summary>
    private static Geometry? Piece(double[] xy) {
        var n = xy.Length / 2;
        if (n < 2) return null;
        var cs = new Coordinate[n];
        for (var i = 0; i < n; i++) cs[i] = new Coordinate(xy[i * 2], xy[(i * 2) + 1]);
        var hull = Gf.CreateMultiPointFromCoords(cs).ConvexHull();
        return hull is NetTopologySuite.Geometries.Point ? null : hull;
    }

    // ---------------------------------------------------------------- stages 7 and 8

    private static IReadOnlyList<Room> Shape(
        List<Geometry> shapes,
        List<RoomProposal?> proposals,
        int roomCount,
        int conflictStart,
        Func<double, double, ProbeAnswer> probe,
        Backing backing,
        Geometry zone,
        double levelZ,
        Knobs knobs,
        Func<Geometry, string?> small
    ) {
        var zoneEdge = zone.Boundary.Buffer(ZoneEdgeExemptFt, CloseQuadSegs);
        var rooms = new List<Room>(shapes.Count);
        for (var i = 0; i < shapes.Count; i++) {
            var g = shapes[i];
            var shared = new List<SharedEdge>();
            for (var j = 0; j < shapes.Count; j++) {
                if (j == i) continue;
                var s = SharedLine(g, shapes[j]);
                if (s is null || s.Length <= SampleFt) continue;
                shared.Add(new SharedEdge(j, Math.Round(s.Length, 6),
                    Math.Round(Support(s, backing, knobs), 6)));
            }

            // The room's own boundary is what is not zone edge.
            var own = g.Boundary.Difference(zoneEdge);
            var backed = own.IsEmpty || own.Length <= SampleFt
                ? 0.0
                : Support(own, backing, knobs);

            var label = g.InteriorPoint;
            var hit = i < roomCount ? probe(label.X, label.Y) : null;
            var floor = hit?.Floor?.Z;
            var ceiling = hit?.Ceiling?.Z;
            string? reason = null;
            var d = Disposition.Accepted;
            if (i >= roomCount) { d = Disposition.Excluded; reason = Reasons.Wall; }
            else if (i >= conflictStart) { d = Disposition.Held; reason = "native-overlap"; }
            else if (proposals[i] is null && (own.IsEmpty || own.Length <= SampleFt)) { d = Disposition.Held; reason = Reasons.ZoneEdgeOnly; }
            else if (floor is not { } fz || Math.Abs(fz - levelZ) > knobs.FloorTolFt) { d = Disposition.Held; reason = Reasons.NoFloor; }
            else if (ceiling is null) { d = Disposition.Held; reason = Reasons.NoCeiling; }
            else if (ceiling is { } cz && cz - floor!.Value < knobs.MinHeadroomFt) { d = Disposition.Void; reason = Reasons.LowHeadroom; }
            else if (small(g) is { } why) { d = Disposition.Held; reason = why; }
            else if (g.Buffer(-knobs.MinFeatureWidthFt / 2.0, CloseQuadSegs).IsEmpty) { d = Disposition.Held; reason = Reasons.TooNarrow; }
            else if (proposals[i] is null && backed < knobs.InkBackedAcceptMin) { d = Disposition.Held; reason = Reasons.Unbacked; }

            rooms.Add(new Room(i, d, reason, Loop(g), Math.Round(g.Area, 9),
                label.X, label.Y, Math.Round(backed, 6), floor, ceiling, shared,
                Enumerable.Range(0, ((Polygon)g).NumInteriorRings)
                    .Select(h => ((Polygon)g).GetInteriorRingN(h))
                    // Overlay can leave collinear triangles that Revit rejects as boundaries.
                    .Where(h => Math.Round(Gf.CreatePolygon(h.Coordinates).Area, 9) > 0)
                    .Select(h => Flat(h.Coordinates)).ToArray(), proposals[i]));
        }

        return rooms;
    }

    // ---------------------------------------------------------------- support and audits

    /// <summary>
    ///     Fraction of a boundary within reach of raw ink. Knee ink backs a sample outright; header
    ///     ink backs it only along runs of <see cref="HeaderOnlyRunFt" /> or less, which is the
    ///     doorway width the evidence line measured — a longer header-only run is a soffit.
    /// </summary>
    private sealed class Backing {
        public NetTopologySuite.Geometries.Prepared.IPreparedGeometry? Knee;
        public NetTopologySuite.Geometries.Prepared.IPreparedGeometry? Header;
    }

    /// <summary>The two reach buffers, built once. FOOTGUN: building them per Support call cost
    /// 5.2 minutes on Main Level#09 against 5.2 seconds for the Python reference.</summary>
    private static Backing Reach(Geometry kneeRaw, Geometry headerRaw, Knobs knobs) {
        var r = knobs.InkHalfWidthFt + knobs.CloseFt;
        var pf = NetTopologySuite.Geometries.Prepared.PreparedGeometryFactory.Prepare;
        return new Backing {
            Knee = kneeRaw.IsEmpty ? null : pf(kneeRaw.Buffer(r, CloseQuadSegs)),
            Header = headerRaw.IsEmpty ? null : pf(headerRaw.Buffer(r, CloseQuadSegs)),
        };
    }

    private static double Support(Geometry line, Backing back, Knobs knobs) {
        var total = line.Length;
        if (total <= 0) return 0.0;
        var kneeBuf = back.Knee;
        var headBuf = back.Header;

        var n = Math.Max(2, (int)(total / SampleFt));
        var flags = new byte[n];   // 0 none, 1 knee, 2 header only
        var ind = new NetTopologySuite.LinearReferencing.LengthIndexedLine(line);
        for (var i = 0; i < n; i++) {
            var c = ind.ExtractPoint(total * (i + 0.5) / n);
            var p = Gf.CreatePoint(c);
            if (kneeBuf is not null && kneeBuf.Intersects(p)) flags[i] = 1;
            else if (headBuf is not null && headBuf.Intersects(p)) flags[i] = 2;
        }

        var step = total / n;
        var maxRun = (int)Math.Ceiling(HeaderOnlyRunFt / step);
        var backed = 0;
        var i0 = 0;
        while (i0 < n) {
            if (flags[i0] == 1) { backed++; i0++; continue; }
            if (flags[i0] == 0) { i0++; continue; }
            var j = i0;
            while (j < n && flags[j] == 2) j++;
            if (j - i0 <= maxRun) backed += j - i0;
            i0 = j;
        }

        return (double)backed / n;
    }

    /// <summary>The shared boundary of two faces, or null when they only touch at a point.</summary>
    private static Geometry? SharedLine(Geometry a, Geometry b) {
        if (!a.EnvelopeInternal.Intersects(b.EnvelopeInternal)) return null;
        var s = a.Boundary.Intersection(b.Boundary);

        if (s.IsEmpty || s.Length <= 0) return null;
        var lines = new List<Geometry>();
        for (var i = 0; i < s.NumGeometries; i++) {
            var g = s.GetGeometryN(i);
            if (g is LineString or MultiLineString && g.Length > 0) lines.Add(g);
        }

        return lines.Count == 0 ? null : Gf.BuildGeometry(lines);
    }

    /// <summary>Coverage validity: no sibling overlap, and the parts sum to the zone. Throws; never holds.</summary>
    private static void AssertCoverage(List<Geometry> parts, Geometry zone, string where, bool complete) {
        foreach (var part in parts)
            if (!part.IsValid) throw new PartitionException($"invalid polygon {where}");
        for (var i = 0; i < parts.Count; i++)
            for (var j = i + 1; j < parts.Count; j++)
                if (parts[i].Intersection(parts[j]).Area > AreaTolSqft)
                    throw new PartitionException($"sibling overlap between {i} and {j} {where}");
        var union = UnionOf(parts);
        if (union.Difference(zone).Area > AreaTolSqft)
            throw new PartitionException($"coverage spills the zone {where}");
        if (complete && zone.Difference(union).Area > AreaTolSqft)
            throw new PartitionException($"coverage leaves an unaccounted gap {where}");
    }

    // ---------------------------------------------------------------- small helpers

    /// <summary>Even-odd area of complete boundary loops; shared by capture, solve and Takeoff scope.</summary>
    public static Geometry GeometryOf(IReadOnlyList<double[]> loops) {
        Geometry result = Gf.CreatePolygon();
        foreach (var xy in loops) {
            if (xy.Length < 6 || xy.Length % 2 != 0 || xy.Any(v => double.IsNaN(v) || double.IsInfinity(v)))
                throw new PartitionException("invalid boundary coordinates");
            var points = Enumerable.Range(0, xy.Length / 2).Select(i => new Coordinate(xy[2*i], xy[2*i+1])).ToList();
            if (!points[0].Equals2D(points[^1])) points.Add(points[0].Copy());
            var ring = Gf.CreatePolygon(points.ToArray());
            if (!ring.IsValid) throw new PartitionException("invalid boundary ring");
            result = result.SymmetricDifference(ring);
        }
        if (result.IsEmpty || !result.IsValid) throw new PartitionException("boundary has no valid area");
        return result;
    }

    private static Geometry UnionOf(IReadOnlyList<Geometry> parts) {
        var live = parts.Where(p => p is { IsEmpty: false }).ToList();
        return live.Count switch {
            0 => Gf.CreatePolygon(),
            1 => live[0],
            _ => NetTopologySuite.Operation.OverlayNG.OverlayNGRobust.Union(live),
        };
    }

    // Area overlays can also contain isolated line/point contacts; those are not room area.
    private static Geometry IntersectArea(Geometry a, Geometry b) =>
        Area(a.Intersection(b));

    private static Geometry Area(Geometry g) => Gf.CreateMultiPolygon(Polys(g).ToArray());

    private static List<Polygon> Polys(Geometry g) =>
        NetTopologySuite.Geometries.Utilities.PolygonExtracter.GetPolygons(g)
            .Cast<Polygon>().Where(p => !p.IsEmpty).ToList();

    private static double[] Loop(Geometry g) => Flat(((Polygon)g).ExteriorRing.Coordinates);

    private static double[] Flat(Coordinate[] coordinates) => coordinates.Take(coordinates.Length - 1)
        .SelectMany(p => new[] { p.X, p.Y }).ToArray();
}
