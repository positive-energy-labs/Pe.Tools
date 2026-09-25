using NetTopologySuite.Geometries;
using NetTopologySuite.Index.Strtree;
using NetTopologySuite.Operation.OverlayNG;
using NetTopologySuite.Operation.Polygonize;
using Pe.Revit.Space;

namespace Pe.Revit.Partition;

/// <summary>Wall is a rail axis, Zone a zone edge, Closed a bridged gap of a wall's thickness scale; the rest are openings.</summary>
public enum SegKind { Wall, Zone, Closed, Door, Headed, Cased }

/// <summary>Out is set on an envelope rail's outer face: the unit normal pointing at the zone edge.</summary>
public sealed record RailSegment(double[] A, double[] B, SegKind Kind, double[]? Out = null);

/// <summary>
///     A gap in the rail network. Door (door ink in the gap) separates rooms; Headed (wall ink over the
///     gap in the header band, door unknown) and Cased (neither) join them, kept apart for the census. Closed is a gap that knee
///     wall ink fills though no rail was extracted there: a wall, not an opening, counted for the census.
///     WidthFt is face to face.
/// </summary>
public sealed record Opening(double[] A, double[] B, double WidthFt, SegKind Kind, int DoorPieces, double HeaderFraction, double WallFraction);

/// <summary>
///     Door ink (DWG A_DOOR* layers, Doors category), header-band wall ink, and knee wall ink, as slice pieces.
///     Leaves are the Doors category's knee elements whole, each one flat x,y point list: a panel read by its footprint.
/// </summary>
public sealed record OpeningEvidence(IReadOnlyList<double[]> Doors, IReadOnlyList<double[]> Headers, IReadOnlyList<double[]> Walls, IReadOnlyList<double[]> Leaves) {
    public static readonly OpeningEvidence None = new([], [], [], []);

    public static OpeningEvidence From(PartitionInput input) => new(
        input.Knee.Elements.Concat(input.Header.Elements)
            .Where(e => e.Handle.Category == "Doors" || (e.Handle.Kind == PrimKind.Curve2D
                && e.Handle.Layer?.StartsWith("A_DOOR", StringComparison.OrdinalIgnoreCase) == true))
            .SelectMany(e => e.Pieces).ToList(),
        // DWG ribbons run the full storey, so only modeled walls count as a header.
        input.Header.Elements.Where(e => e.Handle.Kind != PrimKind.Curve2D && e.Handle.Category == "Walls")
            .SelectMany(e => e.Pieces).ToList(),
        input.Knee.Elements.Where(e => e.Handle.Kind == PrimKind.Curve2D
                ? e.Handle.Layer is { } l && (l.StartsWith("A_WALL", StringComparison.OrdinalIgnoreCase) || l.StartsWith("A_GLAZ", StringComparison.OrdinalIgnoreCase))
                : e.Handle.Category is "Walls" or "Structural Framing")
            .SelectMany(e => e.Pieces).ToList(),
        input.Knee.Elements.Where(e => e.Handle.Category == "Doors").Select(e => e.Pieces.SelectMany(p => p).ToArray()).ToList());
}

public sealed record RailNetwork(IReadOnlyList<RailSegment> Segments, IReadOnlyList<Opening> Openings, double[][] ZoneLoops);

/// <summary>Rooms tile the zone with Bands: the strips between an envelope rail's outer face and the zone edge.</summary>
public sealed record RailFaces(IReadOnlyList<Polygon> Rooms, IReadOnlyList<Polygon> Bands);

public static partial class Rails {
    // FOOTGUN: junction reach, face to face. Brief: "gap up to about 1 ft, the wall thickness scale";
    // the synthetic 1 ft gap closes and the 3 ft gap does not.
    private const double CloseFt = 1.0;

    // FOOTGUN: widest gap read as an opening. A cased opening or double door is under 10 ft; a longer
    // gap is open plan and stays a dangle.
    private const double MaxOpeningFt = 10.0;

    // FOOTGUN: collinear-end tolerance for an opening, and the band past the wall face searched for door ink.
    private const double ParallelDeg = 3.0, DoorBandFt = 0.5;

    // FOOTGUN: reach from a gap's axis, past its wall thickness, to a door leaf that spans the gap. IFC panels sit off
    // the wall plane: Duryee Level 1 door 1310394 lies 1.24 ft from its 0.58 ft wall's axis, 0.95 ft clear of the face.
    private const double LeafFt = 1.0;

    // FOOTGUN: fraction of a gap that header wall ink must cover to call it headed.
    private const double HeaderMin = 0.8;

    // FOOTGUN: fraction of a gap's middle 80 percent that knee wall ink must cover to call it wall.
    // project-a stud rows and DWG wall lines leave rail-less wall runs that otherwise read as cased openings.
    private const double WallInkMin = 0.6;

    // FOOTGUN: faces narrower than this are wall thickness or zone-edge strips, absorbed by a neighbour.
    public const double MinFaceWidthFt = 1.0;

    // FOOTGUN: a rail whose axis, where inside the zone, lies within half its thickness plus this of the zone edge is envelope.
    // It stays a rail but faces meet its outer face; the band from there to the zone edge is wall, not room.
    private const double EnvelopeFt = 1.5;

    // FOOTGUN: widest envelope band (outer face to zone edge) counted as excluded wall. Duryee Level 1's thirteen
    // bands measure 0.23 to 1.26 ft (the 6693266 west bay is 1.0 ft); project-a live's widest is 1.46 ft. A wider
    // band means the person drew the zone off the wall, and it is held with its width.
    public const double BandHoldFt = 2.5;

    // How far behind an envelope outer face a band may reach: the envelope reach plus the hold width. A face on the
    // outer side mostly beyond this is a room the probe leaked into, not a band.
    private const double ShadowFt = EnvelopeFt + BandHoldFt;

    // Snap-rounding grid for noding. Extended rail ends land on a target axis only to rounding error.
    private static readonly PrecisionModel Grid = new(1e4);
    private static readonly GeometryFactory Gf = new NetTopologySuite.NtsGeometryServices(GeometryOverlay.NG).CreateGeometryFactory();

    public static RailNetwork Network(IReadOnlyList<Rail> rails, double[][] zoneLoops, OpeningEvidence evidence) {
        var zone = Solve.GeometryOf(zoneLoops);
        var env = zone.EnvelopeInternal.Copy();
        env.ExpandBy(MaxOpeningFt);
        // Envelope rails get Out, the unit normal toward the zone edge. Only the part of a rail inside the zone is
        // judged, so a wall running on past the zone still hugs its edge. A hugging rail with too little of itself in
        // the zone, or that runs across the edge rather than along it (a return stub), is dropped.
        var live = new List<Rail>();
        var outs = new List<double[]?>();
        // FOOTGUN: rail order is capture order, and the first-match choices below (Onto, facing-end pairs) follow it.
        // A geometric order keeps a rerun whose capture lists the same walls differently on the same network.
        foreach (var r in rails.Where(r => Len(r.A, r.B) > 1e-6 && env.Intersects(new Envelope(r.A[0], r.B[0], r.A[1], r.B[1])))
                     .OrderBy(r => r.A[0]).ThenBy(r => r.A[1]).ThenBy(r => r.B[0]).ThenBy(r => r.B[1]).ThenBy(r => r.ThicknessFt)) {
            var (t, n) = (r.ThicknessFt / 2, Math.Max(10, (int)Math.Ceiling(Len(r.A, r.B))));
            var all = Enumerable.Range(0, n + 1).Select(k => Gf.CreatePoint(new Coordinate(
                r.A[0] + ((r.B[0] - r.A[0]) * k / n), r.A[1] + ((r.B[1] - r.A[1]) * k / n)))).ToList();
            var inside = all.Where(zone.Contains).ToList();
            bool Hugs(IEnumerable<NetTopologySuite.Geometries.Point> pts) => pts.All(pt => zone.Boundary.Distance(pt) <= t + EnvelopeFt);
            if (inside.Count < 3 ? !Hugs(all) : !Hugs(inside)) {
                live.Add(r);
                outs.Add(null);
                continue;
            }
            if (inside.Count < 3) continue;
            // Summed over the samples so a corner or a bay near one sample does not decide the side.
            var (dx, dy) = ((r.B[0] - r.A[0]) / Len(r.A, r.B), (r.B[1] - r.A[1]) / Len(r.A, r.B));
            var (across, reach) = (0.0, 0.0);
            foreach (var pt in inside) {
                var q = NetTopologySuite.Operation.Distance.DistanceOp.NearestPoints(zone.Boundary, pt)[0];
                across += (-dy * (q.X - pt.X)) + (dx * (q.Y - pt.Y));
                reach += q.Distance(pt.Coordinate);
            }
            if (Math.Abs(across) < 0.5 * reach) continue;
            live.Add(r);
            outs.Add(across > 0 ? [-dy, dx] : [dy, -dx]);
        }
        var ends = new double[live.Count * 2][];
        for (var i = 0; i < live.Count; i++) { ends[2 * i] = live[i].A.ToArray(); ends[(2 * i) + 1] = live[i].B.ToArray(); }
        double[] P(int e) => e % 2 == 0 ? live[e / 2].A : live[e / 2].B;
        double[] U(int e) { var (p, q) = (P(e), P(e ^ 1)); var l = Len(p, q); return [(p[0] - q[0]) / l, (p[1] - q[1]) / l]; }
        double T(int e) => live[e / 2].ThicknessFt;
        var zoneEdges = zoneLoops.SelectMany(xy => Enumerable.Range(0, xy.Length / 2).Select(k =>
            (A: new[] { xy[2 * k], xy[(2 * k) + 1] }, B: new[] { xy[(2 * k + 2) % xy.Length], xy[(2 * k + 3) % xy.Length] }))).ToList();
        var doors = Index(evidence.Doors);
        var headers = Index(evidence.Headers);
        var walls = Index(evidence.Walls);
        var segs = new List<RailSegment>();
        var openings = new List<Opening>();
        var openingOf = new Dictionary<int, int>();
        var used = new bool[ends.Length];

        void Gap(double[] a, double[] b, double width, double t) {
            if (width <= CloseFt) { segs.Add(new RailSegment(a, b, SegKind.Closed)); return; }
            var line = Gf.CreateLineString([new Coordinate(a[0], a[1]), new Coordinate(b[0], b[1])]);
            var band = line.Buffer((t / 2) + DoorBandFt, new NetTopologySuite.Operation.Buffer.BufferParameters { EndCapStyle = NetTopologySuite.Operation.Buffer.EndCapStyle.Flat });
            var doorPieces = doors.Query(band.EnvelopeInternal).Count(g => g.Intersects(band));
            // A leaf beside the gap: its projection on the axis covers half its width and it lies within t + LeafFt of the axis.
            var (gl, u) = (Len(a, b), new[] { (b[0] - a[0]) / Len(a, b), (b[1] - a[1]) / Len(a, b) });
            doorPieces += evidence.Leaves.Count(xy => {
                var (lo, hi, near) = (double.MaxValue, double.MinValue, double.MaxValue);
                for (var k = 0; k < xy.Length / 2; k++) {
                    var (vx, vy) = (xy[2 * k] - a[0], xy[(2 * k) + 1] - a[1]);
                    var s = (vx * u[0]) + (vy * u[1]);
                    (lo, hi, near) = (Math.Min(lo, s), Math.Max(hi, s), Math.Min(near, Math.Abs((u[0] * vy) - (u[1] * vx))));
                }
                var (fa, fb) = Farthest(xy);
                return near <= t + LeafFt && Math.Min(hi, gl) - Math.Max(lo, 0) >= 0.5 * Len(fa, fb);
            });
            double Cover(STRtree<Geometry> ink, double lo, double hi) {
                var n = Math.Max(2, (int)(line.Length * (hi - lo) / 0.25));
                var covered = 0;
                for (var k = 0; k < n; k++) {
                    var f = lo + ((hi - lo) * (k + 0.5) / n);
                    var pt = Gf.CreatePoint(new Coordinate(a[0] + ((b[0] - a[0]) * f), a[1] + ((b[1] - a[1]) * f)));
                    var probe = pt.EnvelopeInternal.Copy();
                    probe.ExpandBy((t / 2) + 0.1);
                    if (ink.Query(probe).Any(g => g.Distance(pt) <= (t / 2) + 0.1)) covered++;
                }
                return (double)covered / n;
            }
            var header = Cover(headers, 0, 1);
            var wall = Cover(walls, 0.1, 0.9);
            var kind = wall >= WallInkMin ? SegKind.Closed : doorPieces > 0 ? SegKind.Door : header >= HeaderMin ? SegKind.Headed : SegKind.Cased;
            openingOf[segs.Count] = openings.Count;
            segs.Add(new RailSegment(a, b, kind));
            openings.Add(new Opening(a, b, Math.Round(width, 4), kind, doorPieces, Math.Round(header, 3), Math.Round(wall, 3)));
        }

        // Collinear facing ends: a closed gap or an opening, nearest first.
        var cos = Math.Cos(ParallelDeg * Math.PI / 180);
        var pairs = new List<(double Along, int E1, int E2)>();
        for (var e1 = 0; e1 < ends.Length; e1++)
            for (var e2 = e1 + 1; e2 < ends.Length; e2++) {
                if (e1 / 2 == e2 / 2) continue;
                var (u1, u2) = (U(e1), U(e2));
                if ((u1[0] * u2[0]) + (u1[1] * u2[1]) > -cos) continue;
                var v = new[] { P(e2)[0] - P(e1)[0], P(e2)[1] - P(e1)[1] };
                var along = (v[0] * u1[0]) + (v[1] * u1[1]);
                var tmax = Math.Max(T(e1), T(e2));
                if (Math.Abs((u1[0] * v[1]) - (u1[1] * v[0])) > (tmax / 2) + 0.05 || along < -tmax || along > MaxOpeningFt) continue;
                if (along > CloseFt && live.Where((r, k) => k != e1 / 2 && k != e2 / 2)
                        .Any(r => RaySeg(P(e1), u1, r.A, r.B) is { S: > 0, W: >= 0 and <= 1 } h && h.S < along)) continue;
                pairs.Add((along, e1, e2));
            }
        foreach (var (along, e1, e2) in pairs.OrderBy(p => p.Along)) {
            if (used[e1] || used[e2]) continue;
            used[e1] = used[e2] = true;
            Gap(P(e1), P(e2), Math.Max(0, along), Math.Max(T(e1), T(e2)));
        }

        // Every other end: extend to the axis it nearly reaches, or bridge an opening to it.
        for (var e = 0; e < ends.Length; e++) {
            if (used[e]) continue;
            var (p, u) = (P(e), U(e));
            var best = (S: double.MaxValue, T: 0.0, Q: (double[]?)null, OnExt: false);
            var joined = false;
            for (var j = 0; j < live.Count && !joined; j++) {
                if (j == e / 2) continue;
                var r = live[j];
                var d = new[] { (r.B[0] - r.A[0]) / Len(r.A, r.B), (r.B[1] - r.A[1]) / Len(r.A, r.B) };
                var a = new[] { r.A[0] - (d[0] * CloseFt), r.A[1] - (d[1] * CloseFt) };
                var b = new[] { r.B[0] + (d[0] * CloseFt), r.B[1] + (d[1] * CloseFt) };
                if (RaySeg(p, u, a, b) is not { } h || h.W < 0 || h.W > 1) continue;
                var onExt = h.W * Len(a, b) < CloseFt || (1 - h.W) * Len(a, b) < CloseFt;
                // The end already sits inside this wall past its axis: noding joins them.
                if (!onExt && h.S <= 1e-9 && h.S >= -((r.ThicknessFt / 2) + 0.05)) { joined = true; continue; }
                if (h.S <= 1e-9 || h.S >= best.S) continue;
                var gap = Math.Max(0, h.S - (r.ThicknessFt / 2));
                if (gap > (onExt ? CloseFt : MaxOpeningFt)) continue;
                best = (h.S, r.ThicknessFt, onExt ? (Len(r.A, Along(p, u, h.S)) < Len(r.B, Along(p, u, h.S)) ? r.A : r.B) : null, onExt);
            }
            if (joined) continue;
            foreach (var (a, b) in zoneEdges)
                if (RaySeg(p, u, a, b) is { S: > 1e-9, W: >= 0 and <= 1 } h && h.S < best.S && h.S <= MaxOpeningFt)
                    best = (h.S, 0.0, null, false);
            if (best.S == double.MaxValue) continue;
            var hit = Along(p, u, best.S);
            var width = Math.Max(0, best.S - (best.T / 2));
            if (width <= CloseFt) {
                ends[e] = hit;
                if (best.Q is { } q) segs.Add(new RailSegment(q, hit, SegKind.Closed));
            } else Gap(p, hit, width, T(e));
        }

        var first = segs.Count;
        for (var i = 0; i < live.Count; i++) segs.Add(new RailSegment(ends[2 * i], ends[(2 * i) + 1], SegKind.Wall));

        // Envelope rails bound faces at their outer face. Anything that ends inside one runs on to that face, and the
        // rail itself becomes its outer face capped at both ends. A bar in line with one stays on the axis and meets the cap.
        double[]? Onto(double[] p, double[] u, int self) {
            for (var j = 0; j < live.Count; j++) {
                if (j == self || outs[j] is not { } n) continue;
                var (a, t) = (live[j].A, live[j].ThicknessFt / 2);
                var l = Len(a, live[j].B);
                var d = new[] { (live[j].B[0] - a[0]) / l, (live[j].B[1] - a[1]) / l };
                var v = new[] { p[0] - a[0], p[1] - a[1] };
                var (off, along, c) = ((v[0] * n[0]) + (v[1] * n[1]), (v[0] * d[0]) + (v[1] * d[1]), (u[0] * n[0]) + (u[1] * n[1]));
                if (Math.Abs(off) > t + 0.05 || off >= t || along < -t - 0.05 || along > l + t + 0.05 || c < 0.1) continue;
                return Along(p, u, (t - off) / c);
            }
            return null;
        }
        for (var k = 0; k < segs.Count; k++) {
            var (sg, self) = (segs[k], k >= first ? k - first : -1);
            var l = Len(sg.A, sg.B);
            if (l < 1e-9) continue;
            var u = new[] { (sg.B[0] - sg.A[0]) / l, (sg.B[1] - sg.A[1]) / l };
            var (a, b) = (Onto(sg.A, [-u[0], -u[1]], self) ?? sg.A, Onto(sg.B, u, self) ?? sg.B);
            if (ReferenceEquals(a, sg.A) && ReferenceEquals(b, sg.B)) continue;
            segs[k] = sg with { A = a, B = b };
            if (openingOf.TryGetValue(k, out var o)) openings[o] = openings[o] with { A = a, B = b };
        }
        for (var i = 0; i < live.Count; i++) {
            if (outs[i] is not { } n) continue;
            var (sg, t) = (segs[first + i], live[i].ThicknessFt / 2);
            segs[first + i] = new RailSegment(Along(sg.A, n, t), Along(sg.B, n, t), SegKind.Wall, n);
            // Caps run from the inner face across the wall and on to the zone edge when it is within reach,
            // so the band behind the rail is closed at both ends and cannot leak into a room.
            foreach (var p in new[] { sg.A, sg.B }) {
                var reach = zoneEdges.Select(z => RaySeg(Along(p, n, t), n, z.A, z.B))
                    .Where(h => h is { S: >= 0, W: >= 0 and <= 1 }).Select(h => h!.Value.S).DefaultIfEmpty(double.MaxValue).Min();
                segs.Add(new RailSegment(Along(p, n, -t), Along(p, n, t + (reach <= ShadowFt ? reach : 0)), SegKind.Closed));
            }
        }
        segs.AddRange(zoneEdges.Select(z => new RailSegment(z.A, z.B, SegKind.Zone)));
        return new RailNetwork(segs, openings, zoneLoops);
    }

    /// <summary>
    ///     Polygonize the noded network inside the zone, set aside the bands outside envelope rails' outer faces,
    ///     merge the rest across cased openings, absorb faces thinner than <see cref="MinFaceWidthFt" />.
    ///     Rooms and bands tile the zone.
    /// </summary>
    public static RailFaces Faces(RailNetwork net) {
        var zone = Solve.GeometryOf(net.ZoneLoops);
        var lines = Gf.CreateMultiLineString(net.Segments.Where(s => Len(s.A, s.B) > 1e-9)
            .Select(s => Gf.CreateLineString([new Coordinate(s.A[0], s.A[1]), new Coordinate(s.B[0], s.B[1])])).ToArray());
        var noded = UnaryUnionNG.Union((Geometry)lines, Grid);
        var polygonizer = new Polygonizer();
        polygonizer.Add(noded);
        var faces = polygonizer.GetPolygons().Cast<Polygon>()
            .Where(f => zone.Contains(f.InteriorPoint))
            .SelectMany(f => Polys(OverlayNGRobust.Overlay(f, zone, NetTopologySuite.Operation.Overlay.SpatialFunction.Intersection))).ToList();
        faces.AddRange(Polys(OverlayNGRobust.Overlay(zone, OverlayNGRobust.Union(faces.Cast<Geometry>().ToList()), NetTopologySuite.Operation.Overlay.SpatialFunction.Difference)));

        // A band is the face just outside an envelope outer face that is not also just inside it.
        // It must also lie in the shadow behind the outer faces, or it is a room reached round a short rail's end.
        var band = new bool[faces.Count];
        var backs = net.Segments.Where(s => s.Out is not null && Len(s.A, s.B) > 1e-9).ToList();
        var shadow = OverlayNGRobust.Union(backs.Select(s => (Geometry)Gf.CreatePolygon([
            new Coordinate(s.A[0], s.A[1]), new Coordinate(s.B[0], s.B[1]),
            new Coordinate(s.B[0] + (s.Out![0] * ShadowFt), s.B[1] + (s.Out[1] * ShadowFt)),
            new Coordinate(s.A[0] + (s.Out[0] * ShadowFt), s.A[1] + (s.Out[1] * ShadowFt)), new Coordinate(s.A[0], s.A[1])]).Buffer(0)).ToList());
        int FaceAt(double x, double y) => faces.FindIndex(f => f.Contains(Gf.CreatePoint(new Coordinate(x, y))));
        foreach (var s in backs)
            for (var k = 1; k < 10; k++) {
                var (mx, my) = (s.A[0] + ((s.B[0] - s.A[0]) * k / 10), s.A[1] + ((s.B[1] - s.A[1]) * k / 10));
                var o = FaceAt(mx + (s.Out![0] * 0.02), my + (s.Out[1] * 0.02));
                if (o >= 0 && !band[o] && o != FaceAt(mx - (s.Out[0] * 0.02), my - (s.Out[1] * 0.02))
                    && OverlayNGRobust.Overlay(faces[o], shadow, NetTopologySuite.Operation.Overlay.SpatialFunction.Intersection).Area >= 0.9 * faces[o].Area)
                    band[o] = true;
            }

        var parent = Enumerable.Range(0, faces.Count).ToArray();
        int Find(int i) => parent[i] == i ? i : parent[i] = Find(parent[i]);
        // A cased or headed bar joins every pair of faces facing each other across it, probed along its whole length:
        // a bar's midpoint can land on a third face that meets the bar end-on.
        foreach (var o in net.Openings.Where(o => o.Kind is SegKind.Cased or SegKind.Headed)) {
            var l = Len(o.A, o.B);
            if (l < 1e-9) continue;
            var (nx, ny) = (-(o.B[1] - o.A[1]) / l * 0.02, (o.B[0] - o.A[0]) / l * 0.02);
            var n = Math.Max(1, (int)Math.Ceiling(l / 0.25));
            for (var k = 0; k < n; k++) {
                var f = (k + 0.5) / n;
                var (mx, my) = (o.A[0] + ((o.B[0] - o.A[0]) * f), o.A[1] + ((o.B[1] - o.A[1]) * f));
                var (i, j) = (FaceAt(mx + nx, my + ny), FaceAt(mx - nx, my - ny));
                if (i >= 0 && j >= 0 && i != j && !band[i] && !band[j]) parent[Find(i)] = Find(j);
            }
        }
        var live = faces.Select((f, i) => (f, r: Find(i))).Where(x => !band[x.r]).GroupBy(x => x.r)
            .SelectMany(g => Polys(OverlayNGRobust.Union(g.Select(x => (Geometry)x.f).ToList()))).ToList();

        var bands = faces.Where((_, i) => band[i]).Cast<Geometry>().ToList();
        for (var moved = true; moved;) {
            moved = false;
            for (var i = 0; i < live.Count && !moved; i++) {
                if (!live[i].Buffer(-MinFaceWidthFt / 2).IsEmpty) continue;
                // A scrap touching a band (a jamb between an axis bar and the zone edge) is wall.
                var b = bands.FindIndex(x => x.EnvelopeInternal.Intersects(live[i].EnvelopeInternal) && x.Boundary.Intersection(live[i].Boundary).Length > 1e-6);
                if (b >= 0) {
                    bands[b] = OverlayNGRobust.Union([bands[b], live[i]]);
                    live.RemoveAt(i);
                    moved = true;
                    continue;
                }
                var (best, len) = (-1, 1e-6);
                for (var j = 0; j < live.Count; j++) {
                    if (j == i || !live[i].EnvelopeInternal.Intersects(live[j].EnvelopeInternal)) continue;
                    var shared = live[i].Boundary.Intersection(live[j].Boundary).Length;
                    if (shared > len) (best, len) = (j, shared);
                }
                if (best < 0) continue;
                var merged = Polys(OverlayNGRobust.Union([live[i], live[best]]));
                live.RemoveAt(Math.Max(i, best));
                live.RemoveAt(Math.Min(i, best));
                live.AddRange(merged);
                moved = true;
            }
        }
        return new RailFaces(live, bands.Count == 0 ? [] : Polys(OverlayNGRobust.Union(bands)));
    }

    /// <summary>
    ///     Length of a face's boundary on no wall, closed gap, door bar, or zone edge: a floating edge.
    ///     A door bar counts as enclosure because it separates rooms; a cased or headed bar joins them and floats.
    ///     <paramref name="also" /> is further enclosure linework, such as locked rooms' edges.
    /// </summary>
    public static Func<Geometry, double> Floating(RailNetwork net, Geometry? also = null) {
        Geometry lines = Gf.CreateMultiLineString(net.Segments
            .Where(s => s.Kind is not (SegKind.Cased or SegKind.Headed) && Len(s.A, s.B) > 1e-9)
            .Select(s => Gf.CreateLineString([new Coordinate(s.A[0], s.A[1]), new Coordinate(s.B[0], s.B[1])])).ToArray());
        if (also is not null) lines = lines.Union(also);
        var enclosure = UnaryUnionNG.Union(lines, Grid).Buffer(1e-3);
        return g => OverlayNGRobust.Overlay(g.Boundary, enclosure, NetTopologySuite.Operation.Overlay.SpatialFunction.Difference).Length;
    }

    /// <summary>Widest place in a band: the maximum inscribed circle's diameter.</summary>
    public static double Width(Polygon band) =>
        2 * new NetTopologySuite.Algorithm.Construct.MaximumInscribedCircle(band, 0.005).GetRadiusLine().Length;

    private static STRtree<Geometry> Index(IReadOnlyList<double[]> pieces) {
        var tree = new STRtree<Geometry>();
        foreach (var xy in pieces) {
            var (a, b) = Farthest(xy);
            var g = Gf.CreateLineString([new Coordinate(a[0], a[1]), new Coordinate(b[0], b[1])]);
            tree.Insert(g.EnvelopeInternal, g);
        }
        tree.Build();
        return tree;
    }

    private static (double[] A, double[] B) Farthest(double[] xy) {
        var n = xy.Length / 2;
        var (bi, bj, best) = (0, 0, -1.0);
        for (var i = 0; i < n; i++)
            for (var j = i + 1; j < n; j++) {
                var d = D2([xy[2 * i], xy[(2 * i) + 1]], [xy[2 * j], xy[(2 * j) + 1]]);
                if (d > best) (bi, bj, best) = (i, j, d);
            }
        return ([xy[2 * bi], xy[(2 * bi) + 1]], [xy[2 * bj], xy[(2 * bj) + 1]]);
    }

    private static double D2(double[] a, double[] b) => ((a[0] - b[0]) * (a[0] - b[0])) + ((a[1] - b[1]) * (a[1] - b[1]));

    private static double Len(double[] a, double[] b) => Math.Sqrt(D2(a, b));

    /// <summary>p + s u = a + w (b - a). Null when parallel.</summary>
    private static (double S, double W)? RaySeg(double[] p, double[] u, double[] a, double[] b) {
        var d = new[] { b[0] - a[0], b[1] - a[1] };
        var den = (u[0] * d[1]) - (u[1] * d[0]);
        if (Math.Abs(den) < 1e-9 * Len(a, b)) return null;
        var q = new[] { a[0] - p[0], a[1] - p[1] };
        return (((q[0] * d[1]) - (q[1] * d[0])) / den, ((q[0] * u[1]) - (q[1] * u[0])) / den);
    }

    private static double[] Along(double[] p, double[] u, double s) => [p[0] + (u[0] * s), p[1] + (u[1] * s)];

    private static List<Polygon> Polys(Geometry g) =>
        NetTopologySuite.Geometries.Utilities.PolygonExtracter.GetPolygons(g).Cast<Polygon>().Where(p => !p.IsEmpty && p.Area > 1e-9).ToList();
}
