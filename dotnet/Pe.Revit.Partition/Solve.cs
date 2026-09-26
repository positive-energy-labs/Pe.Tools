using NetTopologySuite.Geometries;
using Pe.Revit.Space;

namespace Pe.Revit.Partition;

/// <summary>
///     The pure core: slice pieces plus a zone loop in, a partition out. No Document, no Revit call,
///     same answer for the same input. The rail network decides the faces; this class carries locked
///     proposals, measurements and accounting, and <see cref="Judge" /> the dispositions.
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
    internal const double SampleFt = 0.25;

    // FOOTGUN: accounting closes here or the solve throws. Domain law, ledger.
    private const double AreaTolSqft = 1e-6;

    private const int BufferQuadSegs = 2;
    private const int CloseQuadSegs = 4;

    private static readonly GeometryFactory Gf = new NetTopologySuite.NtsGeometryServices(GeometryOverlay.NG).CreateGeometryFactory();

    /// <summary>
    ///     Rooms from the rail network; the partition verb's solver. Layer 1 (<see cref="Faces" />) partitions by
    ///     geometry, layer 2 (<see cref="Judge.Dispose" />) disposes each face; accounting closes or the solve throws.
    /// </summary>
    public static PartitionAnswer RunRails(PartitionInput input, Func<double, double, ProbeAnswer> probe) {
        var sw = System.Diagnostics.Stopwatch.StartNew();
        var layer1 = Faces(input, probe);
        var rejected = (input.Rejected ?? []).Select(r => GeometryOf([r])).ToList();
        var rooms = layer1.Facts.Select((f, i) => {
            var (d, reason) = Judge.Dispose(f, input.LevelZ, input.Knobs, rejected);
            return new Room(i, d, reason, Loop(f.Shape), Math.Round(f.Shape.Area, 9), f.LabelX, f.LabelY, Math.Round(f.Backed, 6),
                f.FloorZ, f.CeilingZ, f.Shared, Enumerable.Range(0, f.Shape.NumInteriorRings)
                    .Select(f.Shape.GetInteriorRingN)
                    // Overlay can leave collinear triangles that Revit rejects as boundaries.
                    .Where(h => Math.Round(Gf.CreatePolygon(h.Coordinates).Area, 9) > 0)
                    .Select(h => Flat(h.Coordinates)).ToArray(), f.Proposal);
        }).ToList();
        var acc = new Accounting(GeometryOf(input.ZoneLoops).Area,
            rooms.Where(r => r.Disposition == Disposition.Accepted).Sum(r => r.AreaSqft),
            rooms.Where(r => r.Disposition == Disposition.Held).Sum(r => r.AreaSqft),
            rooms.Where(r => r.Disposition == Disposition.Void).Sum(r => r.AreaSqft),
            rooms.Where(r => r.Disposition == Disposition.Excluded).Sum(r => r.AreaSqft));
        if (Math.Abs(acc.ZoneSqft - acc.Accepted - acc.Held - acc.Void - acc.Excluded) > AreaTolSqft)
            throw new PartitionException("serialized partition accounting does not close");
        var trace = new Trace(
            layer1.Rails.Select(r => new TraceRail(r.A, r.B, r.ThicknessFt, r.Source, r.Handle.ElementId, r.Handle.Category, r.Handle.Layer)).ToList(),
            layer1.Network.Segments.Select(s => new TraceSegment(s.A, s.B, s.Kind)).ToList(),
            layer1.Network.Openings,
            layer1.Facts.Select((f, i) => new TraceFace(i, f.Kind, f.BandWidthFt, f.OwnEdgeEmpty, f.FloatingFt, f.Narrow, Math.Round(f.Backed, 6))).ToList());
        return new PartitionAnswer(input.Knee.Stamp, input.Knee.Searched, input.Knobs, rooms, acc, null,
            input.Resolved, input.EnclosureSource, Math.Round(sw.Elapsed.TotalMilliseconds, 3), trace);
    }

    /// <summary>
    ///     Layer 1: the zone tiled by geometry alone, each face with its measurements and no judgment. Proposals are
    ///     carried through whole: a person's locked room regions (from Rooms.cs), so they survive a rerun, and architect
    ///     Rooms, adopted. The rail faces fill the rest of the zone. Order is the answer's Room.Index: proposed rooms,
    ///     rail rooms, bands too wide to be wall, proposal overlaps, then envelope bands. The rails and the network it
    ///     built come back beside the facts for the answer's <see cref="Trace" />.
    /// </summary>
    public static (IReadOnlyList<FaceFacts> Facts, IReadOnlyList<Rail> Rails, RailNetwork Network) Faces(
        PartitionInput input, Func<double, double, ProbeAnswer> probe) {
        var zone = GeometryOf(input.ZoneLoops);
        var proposed = input.Proposals
            .Select(p => (Proposal: p, Geom: IntersectArea(GeometryOf(p.Loops), zone)))
            .Where(p => !p.Geom.IsEmpty && p.Geom.Area > AreaTolSqft).ToList();
        var overlaps = new List<Geometry>();
        for (var i = 0; i < proposed.Count; i++)
            for (var j = i + 1; j < proposed.Count; j++) {
                var overlap = IntersectArea(proposed[i].Geom, proposed[j].Geom);
                if (overlap.Area > AreaTolSqft) overlaps.Add(overlap);
            }
        var contested = UnionOf(overlaps);
        var taken = UnionOf(proposed.Select(p => p.Geom).ToList());
        var rails = Rails.From(input);
        var net = Rails.Network(rails, input.ZoneLoops, OpeningEvidence.From(input));
        var faces = Rails.Faces(net);
        var proposedParts = proposed.SelectMany(p => Polys(p.Geom.Difference(contested)).Select(g => (Geom: (Geometry)g, p.Proposal))).ToList();
        List<Polygon> Free(IEnumerable<Polygon> parts) => taken.IsEmpty ? parts.ToList() : parts.SelectMany(f => Polys(f.Difference(taken))).ToList();
        // A rail room clipped by a locked room leaves scraps where the person's edge runs beside a rail. A clipped
        // piece thinner than a face goes to the locked room it borders longest, as Rails.Faces absorbs thin faces;
        // Rooms.cs never redraws a locked room, so the scrap is accounted and never drawn. An architect Room keeps
        // its own area: Riverbend's 92 sf corridor 111-E swallowed 70 sf of neighbouring scraps when it took them.
        var free = new List<Polygon>();
        foreach (var f in faces.Rooms) {
            var parts = Free([f]);
            if (parts.Count == 1 && Math.Abs(parts[0].Area - f.Area) <= AreaTolSqft) { free.Add(parts[0]); continue; }
            foreach (var part in parts) {
                var (best, len) = (-1, 1e-6);
                if (part.Buffer(-Rails.MinFaceWidthFt / 2).IsEmpty)
                    for (var k = 0; k < proposedParts.Count; k++) {
                        if (!proposedParts[k].Proposal.IsLocked) continue;
                        var shared = proposedParts[k].Geom.Boundary.Intersection(part.Boundary).Length;
                        if (shared > len) (best, len) = (k, shared);
                    }
                if (best < 0) free.Add(part);
                else proposedParts[best] = (UnionOf([proposedParts[best].Geom, part]), proposedParts[best].Proposal);
            }
        }
        var bands = Free(faces.Bands).Select(b => (Shape: b, Width: Rails.Width(b))).ToList();
        // ponytail: index order and the probe set still split bands at Judge.BandHoldFt, so Room.Index and probe calls
        // stay as they were; a pure layer 1 would order and probe every band alike.
        var wide = bands.Where(x => x.Width > Judge.BandHoldFt).ToList();
        var layout = new List<(Polygon Shape, RoomProposal? Proposal, FaceKind Kind, double? Width)>();
        foreach (var (geom, proposal) in proposedParts)
            foreach (var part in Polys(geom)) layout.Add((part, proposal, FaceKind.Room, null));
        foreach (var part in free) layout.Add((part, null, FaceKind.Room, null));
        foreach (var b in wide) layout.Add((b.Shape, null, FaceKind.Band, b.Width));
        foreach (var part in Polys(contested)) layout.Add((part, null, FaceKind.Contested, null));
        var probed = layout.Count;
        foreach (var b in bands.Except(wide)) layout.Add((b.Shape, null, FaceKind.Band, b.Width));
        var shapes = layout.Select(x => (Geometry)x.Shape).ToList();
        AssertCoverage(shapes, zone, "rails partition", true);
        // A proposed room's edge is a wall, as the zone edge is: it backs its neighbours and never floats.
        var knobs = input.Knobs;
        var knee = Buffered(input.Knee, knobs.InkHalfWidthFt);
        if (!taken.IsEmpty) knee = UnionOf([knee, taken.Boundary.Buffer(knobs.InkHalfWidthFt, BufferQuadSegs)]);
        var backing = Reach(knee, Buffered(input.Header, knobs.InkHalfWidthFt), knobs);
        var floating = Rails.Floating(net, taken.IsEmpty ? null : taken.Boundary);
        var zoneEdge = zone.Boundary.Buffer(ZoneEdgeExemptFt, CloseQuadSegs);
        var facts = new List<FaceFacts>(layout.Count);
        for (var i = 0; i < layout.Count; i++) {
            var (g, proposal, kind, width) = layout[i];
            var shared = new List<SharedEdge>();
            for (var j = 0; j < shapes.Count; j++) {
                if (j == i) continue;
                var s = SharedLine(g, shapes[j]);
                if (s is null || s.Length <= SampleFt) continue;
                shared.Add(new SharedEdge(j, Math.Round(s.Length, 6), Math.Round(Support(s, backing, knobs), 6)));
            }
            // The face's own boundary is what is not zone edge.
            var own = g.Boundary.Difference(zoneEdge);
            var ownEmpty = own.IsEmpty || own.Length <= SampleFt;
            var label = g.InteriorPoint;
            var hit = i < probed ? probe(label.X, label.Y) : null;
            facts.Add(new FaceFacts(g, proposal, kind, width, ownEmpty, hit?.Floor?.Z, hit?.Ceiling?.Z,
                kind == FaceKind.Room ? floating(g) : null, g.Buffer(-knobs.MinFeatureWidthFt / 2.0, CloseQuadSegs).IsEmpty,
                ownEmpty ? 0.0 : Support(own, backing, knobs), label.X, label.Y, shared));
        }
        return (facts, rails, net);
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

    private static double[] Loop(Polygon g) => Flat(g.ExteriorRing.Coordinates);

    private static double[] Flat(Coordinate[] coordinates) => coordinates.Take(coordinates.Length - 1)
        .SelectMany(p => new[] { p.X, p.Y }).ToArray();
}
