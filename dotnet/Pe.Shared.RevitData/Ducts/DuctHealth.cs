namespace Pe.Shared.RevitData.Ducts;

/// <summary>
///     Model health, the one producer (ducts LEDGER 2026-10-29): what is true of the model whatever is calculated,
///     keyed by element and connector, never by group, for every `ducts.snapshot` selector. Revit-free: the collector
///     hands it the read's elements and, for a bounded read, the elements around its open ends (Context), which are
///     measured against but never reported on. Nothing here decides a join: the pricing engine (TypeScript) reads each
///     open end's <see cref="DuctNear" /> and applies its own rulings and stream rules (Pillar 6: TypeScript prices;
///     C# collects raw truth). The geometry below is the sheet walk's own (ts kernel/inferred-joins.ts and
///     sheet/walk.ts, retired 2026-10-29), measured the same way so the sheet's blockers do not move.
/// </summary>
public static class DuctHealth {
    /// <summary>An open end's neighbourhood, in either way of its connector. The sheet's and the `from` walk's default.</summary>
    public const double CandidateBoxIn = 36;
    /// <summary>
    ///     A vacant, opposed partner this close is a near miss, and the widest gap `ducts.heal` bridges: its spike PROVED
    ///     a 3 in union and a 2.8 in extend and FALSIFIED a 13.7 in extend (DuctHealer.JoinGapIn reads this).
    /// </summary>
    public const double AutoJoinGapIn = 3.0;
    /// <summary>Two outward axes with a cosine at or below minus this are opposed.</summary>
    public const double OpposedCos = 0.9;
    /// <summary>The most an aligned partner may sit off the end's axis, in.</summary>
    public const double AlignedLateralIn = 0.5;
    /// <summary>ponytail: tuned by one case (Project A 14122436 short of cap 14107111, 1.6 in of air to the cap face).</summary>
    public const double FaceTolIn = 2;
    /// <summary>ponytail: one measured cap (Project A 14107111's face sits 1.0 in outboard of the duct end); caps carry no size.</summary>
    public const double CapThicknessIn = 1;
    /// <summary>The farthest off a duct side a tap point is reported, in.</summary>
    public const double TapReachIn = 24;
    /// <summary>The least cosine between a landing connector's outward axis and the face's inward normal.</summary>
    private const double AxisCos = 0.7;
    private static readonly double AcrossCos = Math.Sqrt(1 - AxisCos * AxisCos);
    /// <summary>A duct shorter than this is a stub, ft (3 in).</summary>
    private const double StubFt = 0.25;

    public static DuctHealthTolerances Tolerances(DuctSnapshotSelector? selector) =>
        new(selector?.CandidateBoxIn ?? CandidateBoxIn, selector?.AutoJoinGapIn ?? AutoJoinGapIn);

    /// <summary>
    ///     Every health finding on <paramref name="nodes" /> and <paramref name="segments" />. Context elements are
    ///     neighbours and joint partners only. Loops are the read's own cycles: a bounded read cannot see one it cut.
    /// </summary>
    public static IReadOnlyList<DuctIssue> Assess(
        IReadOnlyList<DuctNode> nodes,
        IReadOnlyList<DuctSegment> segments,
        DuctHealthTolerances tolerances,
        IReadOnlyList<DuctNode>? contextNodes = null,
        IReadOnlyList<DuctSegment>? contextSegments = null
    ) {
        var own = nodes.Select(El.Of).Concat(segments.Select(El.Of)).ToList();
        var ownIds = new HashSet<long>(own.Select(e => e.Id));
        var all = own.Concat((contextNodes ?? []).Select(El.Of).Concat((contextSegments ?? []).Select(El.Of))
            .Where(e => !ownIds.Contains(e.Id))).ToList();
        var byId = new Dictionary<long, El>();
        foreach (var e in all)
            if (!byId.ContainsKey(e.Id)) byId[e.Id] = e;
        var box = tolerances.CandidateBoxIn / 12;
        var grid = new Grid(all, box);
        var issues = new List<DuctIssue>();
        void Add(DuctIssueKind kind, El e, int? connector, double[]? point, string note, DuctNear? near = null) =>
            issues.Add(new DuctIssue($"{Slug(kind)}:{e.Id}{(connector is { } c ? ":" + c : "")}", kind, e.Id, connector, point, note, near));

        foreach (var e in own) {
            if (!e.IsCap)
                foreach (var c in e.Connectors.Where(c => c.ConnectedTo is null)) {
                    var near = Near(e, c, grid.Around(c.Point, box).Select(i => all[i]).ToList(), tolerances);
                    Add(DuctIssueKind.OpenEnd, e, c.Index, c.Point,
                        e.Node?.Kind == DuctNodeKind.Terminal ? "terminal not connected" : "nothing attached", near);
                    if (near.Ports.FirstOrDefault(p => p.AutoJoin) is { } mate)
                        Add(DuctIssueKind.NearMiss, e, c.Index, c.Point,
                            $"vacant opposed {mate.ElementId}:{mate.Connector} is {mate.GapIn:0.###} in away (auto-join gap {tolerances.AutoJoinGapIn} in)");
                }
            foreach (var c in e.Connectors) {
                if (c.ConnectedTo is not { } to || !byId.TryGetValue(to.ElementId, out var peer)) continue;
                var other = peer.Connectors.FirstOrDefault(p => p.Index == to.Connector);
                if (ClassOf(c.Classification) is { } mine && ClassOf(other?.Classification) is { } theirs && mine != theirs)
                    Add(DuctIssueKind.AirTypeChange, e, c.Index, c.Point, $"{mine} meets {theirs} at {peer.Id}:{to.Connector}");
            }
            if (e.Node is { Kind: DuctNodeKind.Terminal } terminal && !(DuctNetwork.Fact(terminal, DuctNetwork.TerminalFlow) > 0))
                Add(DuctIssueKind.NoTerminalFlow, e, null, terminal.Point, "no design flow");
            if (e.Node is { Kind: DuctNodeKind.Accessory } accessory && !(DuctNetwork.Fact(accessory, DuctNetwork.PressureDrop) > 0))
                Add(DuctIssueKind.NoComponentDrop, e, null, accessory.Point, $"{accessory.Family} states no pressure drop");
            if (e.Segment is not { } seg) continue;
            if (seg.Kind == DuctSegmentKind.Duct && seg.LengthFt < StubFt)
                Add(DuctIssueKind.Stub, e, null, Mid(seg), $"{seg.LengthFt * 12:0.##} in long");
            if (seg.Revit?.VelocityFpm >= DuctNetwork.HighVelocityFpm)
                Add(DuctIssueKind.HighVelocity, e, null, Mid(seg), $"{seg.Revit!.VelocityFpm:0} fpm (Revit)");
            if (Implausible(seg)) Add(DuctIssueKind.ImplausibleSize, e, null, Mid(seg), seg.Size);
            if (seg.Kind == DuctSegmentKind.Flex && seg.Roughness?.Provenance == DuctProvenance.RevitDefault)
                Add(DuctIssueKind.DefaultFlexRoughness, e, null, Mid(seg), $"type {seg.Type} roughness {seg.Roughness.ValueFt} ft is the rigid default");
        }
        foreach (var x in LoopClosers(own))
            Add(DuctIssueKind.Loop, byId[x], null, byId[x].Point, "closes a loop");
        return issues;
    }

    /// <summary>The groups with IssueIds indexing the issues on their elements.</summary>
    public static IReadOnlyList<DuctGroup> Index(
        IReadOnlyList<DuctGroup> groups,
        IReadOnlyList<DuctNode> nodes,
        IReadOnlyList<DuctSegment> segments,
        IReadOnlyList<DuctIssue> issues
    ) {
        var groupOf = nodes.Where(n => n.GroupId is not null).Select(n => (n.Id, n.GroupId!))
            .Concat(segments.Where(s => s.GroupId is not null).Select(s => (s.Id, s.GroupId!)))
            .ToDictionary(x => x.Item1, x => x.Item2);
        var byGroup = issues.Where(i => groupOf.ContainsKey(i.ElementId))
            .GroupBy(i => groupOf[i.ElementId]).ToDictionary(g => g.Key, g => g.Select(i => i.Id).ToList());
        return groups.Select(g => g with { IssueIds = byGroup.TryGetValue(g.Id, out var ids) ? ids : [] }).ToList();
    }

    /// <summary>The air classification as connectors spell it (`SupplyAir`); null when none or undefined.</summary>
    public static string? ClassOf(string? value) {
        var c = value is null ? null : string.Concat(value.Where(ch => !char.IsWhiteSpace(ch)));
        return string.IsNullOrEmpty(c) || c.StartsWith("Undefined", StringComparison.Ordinal) ? null : c;
    }

    /// <summary>
    ///     What lies around one open end. Nearby is every other element with a connector within the box (Chebyshev) or,
    ///     for a duct, a centerline within the box plus half its largest side.
    /// </summary>
    private static DuctNear Near(El self, DuctConnector port, List<El> around, DuctHealthTolerances tolerances) {
        var box = tolerances.CandidateBoxIn / 12;
        var nearby = around.Where(e => e.Id != self.Id && IsNear(e, port.Point, box)).ToList();
        var axis = AxisOf(self, port);
        var ports = new List<DuctNearPort>();
        foreach (var e in nearby)
        foreach (var c in e.Connectors) {
            if (c.Point.Length != 3 || port.Point.Length != 3) continue;
            var gapIn = Dist(port.Point, c.Point) * 12;
            if (!(gapIn <= tolerances.CandidateBoxIn)) continue;
            var b = AxisOf(e, c);
            double? facing = axis is { } a1 && b is { } b1 ? Dot(a1, b1) : null;
            var aligned = false;
            if (axis is { } a && b is not null && facing <= -OpposedCos) {
                var displacement = Sub(c.Point, port.Point);
                var axial = Dot(displacement, a);
                var lateral = Norm(Add(displacement, a, -axial));
                aligned = axial >= -1e-6 && lateral * 12 <= AlignedLateralIn;
            }
            var auto = c.ConnectedTo is null && facing <= -OpposedCos && gapIn <= tolerances.AutoJoinGapIn;
            ports.Add(new DuctNearPort(e.Id, c.Index, gapIn, facing, facing <= -OpposedCos, aligned, auto));
        }

        var segments = nearby.Where(e => e.Segment is not null).ToList();
        var sides = Sides(segments);
        var faces = new List<DuctNearFace>();
        if (axis is { } axisOut) {
            var open = nearby.SelectMany(e => e.Connectors.Where(c => c.ConnectedTo is null && c.Point.Length == 3)
                .Select(c => new OpenPort(e, c, AxisOf(e, c)))).ToList();
            // An open port within the box is already a port candidate; its mouth is not landed on twice (ts `taken`).
            var taken = new HashSet<(long, int)>(open.Where(o => Dist(port.Point, o.Connector.Point) * 12 <= tolerances.CandidateBoxIn)
                .Select(o => (o.Element.Id, o.Connector.Index)));
            var faceTol = FaceTolIn / 12;
            foreach (var face in Faces(segments, nearby, open, sides)) {
                if (Land(face, port.Point, axisOut) is not { } hit) continue;
                if (!(face.Side is not null ? hit.D <= faceTol : Math.Abs(hit.D) <= faceTol)) continue;
                if (face.Port is { } q) {
                    if (taken.Contains((q.Element.Id, q.Connector.Index))) continue;
                    double? qd = q.Axis is { } qa ? Dot(axisOut, qa) : null;
                    faces.Add(new DuctNearFace("collar", q.Element.Id, q.Connector.Index, hit.D * 12, qd, qd <= -OpposedCos, null, null));
                    continue;
                }
                double? td = face.Side is not null ? null : Dot(axisOut, face.Normal!);
                faces.Add(new DuctNearFace("tap", hit.Segment!.Id, null, hit.D * 12, td, td <= -OpposedCos, hit.At, hit.Point));
            }
        }

        var bodies = new List<DuctNearBody>();
        foreach (var side in sides) {
            var seg = side.Segment;
            var v = Sub(port.Point, side.A);
            var t = Dot(v, side.U);
            var radial = Add(v, side.U, -t);
            var axialOff = Math.Max(Math.Max(-t, t - side.Len), 0);
            var across = side.Rect is { } r
                ? Hypot(Math.Max(0, Math.Abs(Dot(radial, r.X)) - r.W), Math.Max(0, Math.Abs(Dot(radial, r.Y)) - r.H))
                : Math.Max(0, Norm(radial) - side.Band!.Value.Outer);
            double? tapGap = null;
            double[]? tapPoint = null;
            // A tap lands inside the body, away from an end's mouth.
            var margin = Math.Max(Math.Max(seg.DiameterIn ?? 0, seg.WidthIn ?? 0), seg.HeightIn ?? 0) / 24;
            if (t > margin && t < side.Len - margin) {
                var center = Add(side.A, side.U, t);
                var off = Sub(port.Point, center);
                var surface = side.Rect is { } s
                    ? Add(Add(center, s.X, Math.Max(-s.W, Math.Min(s.W, Dot(off, s.X)))), s.Y, Math.Max(-s.H, Math.Min(s.H, Dot(off, s.Y))))
                    : Add(center, off, Math.Min(1, side.Band!.Value.Outer / (Norm(off) is var n && n != 0 ? n : 1)));
                var gap = Dist(port.Point, surface) * 12;
                if (gap <= Math.Min(TapReachIn, tolerances.CandidateBoxIn)) (tapGap, tapPoint) = (gap, surface);
            }
            bodies.Add(new DuctNearBody(seg.Id, Hypot(axialOff, across) * 12, tapGap, tapPoint));
        }
        return new DuctNear(ports, faces, bodies);
    }

    // ---- geometry: the walk's own (ts kernel/inferred-joins.ts), line for line ----------------------------------

    private sealed record El(long Id, DuctNode? Node, DuctSegment? Segment, IReadOnlyList<DuctConnector> Connectors, double[]? Point) {
        public bool IsCap => this.Node?.Kind == DuctNodeKind.Cap;
        public static El Of(DuctNode n) => new(n.Id, n, null, n.Connectors, n.Point);
        public static El Of(DuctSegment s) => new(s.Id, null, s, s.Connectors, Mid(s));
    }

    private readonly record struct Band(double Inner, double Outer);
    private sealed record RectSection(double W, double H, double[] X, double[] Y);
    private sealed record Side(DuctSegment Segment, double[] A, double[] U, double Len, double Run, RectSection? Rect, Band? Band);
    private sealed record OpenPort(El Element, DuctConnector Connector, double[]? Axis);
    private sealed record Face(Side? Side, DuctSegment? CapSegment, double[]? Origin, double[]? Normal, RectSection? Rect, Band? Band, double At, double[]? End, OpenPort? Port);
    private sealed record Hit(double D, DuctSegment? Segment, double At, double[]? Point);

    /// <summary>Chebyshev box test, the sheet walk's prefilter (sheet/walk.ts `near`).</summary>
    private static bool IsNear(El e, double[] p, double r) {
        double Cheb(double[] q) => Math.Max(Math.Max(Math.Abs(q[0] - p[0]), Math.Abs(q[1] - p[1])), Math.Abs(q[2] - p[2]));
        if (e.Connectors.Any(c => c.Point.Length == 3 && Cheb(c.Point) <= r)) return true;
        if (e.Segment is not { } s) return false;
        // A long duct body can pass the box with no vertex in it: test the closest point of each piece.
        var pad = Math.Max(Math.Max(s.DiameterIn ?? 0, s.WidthIn ?? 0), s.HeightIn ?? 0) / 24;
        for (var i = 1; i < s.Polyline.Count; i++) {
            var a = s.Polyline[i - 1];
            var ab = Sub(s.Polyline[i], a);
            var len2 = Dot(ab, ab);
            var t = len2 == 0 ? 0 : Math.Max(0, Math.Min(1, Dot(ab, Sub(p, a)) / len2));
            if (Cheb(Add(a, ab, t)) <= r + pad) return true;
        }
        return false;
    }

    /// <summary>An open connector's outward axis: the read's facing, else derived from geometry.</summary>
    private static double[]? AxisOf(El e, DuctConnector c) {
        if (c.Kind == "curve" && e.Segment is not null) return null;
        if (c.Facing is { Length: 3 } f && Unit(f) is { } facing) return facing;
        if (e.Segment is { } s) {
            var poly = s.Polyline;
            if (poly.Count < 2) return null;
            var first = Dist(c.Point, poly[0]) <= Dist(c.Point, poly[^1]);
            return first ? Unit(Sub(poly[0], poly[1])) : Unit(Sub(poly[^1], poly[^2]));
        }
        var outward = Sub(c.Point, e.Point!);
        if (Norm(outward) > 0.01) return Unit(outward);
        var others = e.Connectors.Where(o => !ReferenceEquals(o, c) && o.Point.Length == 3).ToList();
        if (others.Count == 0) return null;
        var mid = Enumerable.Range(0, c.Point.Length).Select(k => others.Sum(o => o.Point[k]) / others.Count).ToArray();
        return Unit(Sub(c.Point, mid));
    }

    /// <summary>A cross-section on axis u, ft: a rolled rectangle, else a band from the centerline.</summary>
    private static (RectSection? Rect, Band? Band)? SectionOf(DuctShape shape, double? diameterIn, double? widthIn, double? heightIn, double[] u, double[]? roll) {
        var (w, h) = ((widthIn ?? 0) / 24, (heightIn ?? 0) / 24);
        if (shape == DuctShape.Round || (w == 0 && h == 0)) {
            var r = (diameterIn ?? 0) / 24;
            return r > 0 ? (null, new Band(r, r)) : null;
        }
        if (w == 0 || h == 0) return null;
        var rolled = roll is { Length: 3 } ? Unit(Add(roll, u, -Dot(roll, u))) : null;
        var x = shape != DuctShape.Rectangular ? null : rolled ?? (Math.Abs(u[2]) < 0.99 ? Unit([-u[1], u[0], 0]) : null);
        if (x is null) return (null, new Band(Math.Min(w, h), Hypot(w, h)));
        double[] y = [u[1] * x[2] - u[2] * x[1], u[2] * x[0] - u[0] * x[2], u[0] * x[1] - u[1] * x[0]];
        return (new RectSection(w, h, x, y), null);
    }

    private static double[]? RollOf(DuctSegment s) => s.Connectors.FirstOrDefault(c => c.WidthAxis is { Length: 3 })?.WidthAxis;

    private static string? SegmentClass(DuctSegment s) =>
        s.Connectors.Select(c => ClassOf(c.Classification)).FirstOrDefault(c => c is not null) ?? ClassOf(s.Classification);

    /// <summary>Each segment's sides: one per polyline piece, swept by its section.</summary>
    private static List<Side> Sides(IEnumerable<El> segments) {
        var sides = new List<Side>();
        foreach (var s in segments.Select(e => e.Segment!)) {
            var run = 0.0;
            for (var i = 1; i < s.Polyline.Count; i++) {
                var a = s.Polyline[i - 1];
                var len = Dist(a, s.Polyline[i]);
                var u = Unit(Sub(s.Polyline[i], a));
                if (u is not null && SectionOf(s.Shape, s.DiameterIn, s.WidthIn, s.HeightIn, u, RollOf(s)) is { } section)
                    sides.Add(new Side(s, a, u, len, run, section.Rect, section.Band));
                run += len;
            }
        }
        return sides;
    }

    /// <summary>Every face nearby: duct sides, ends their caps close (cap and duct both nearby), and open connector mouths.</summary>
    private static List<Face> Faces(List<El> segments, List<El> nearby, List<OpenPort> open, List<Side> sides) {
        var faces = sides.Select(s => new Face(s, null, null, null, null, null, 0, null, null)).ToList();
        var byId = segments.ToDictionary(e => e.Id, e => e.Segment!);
        foreach (var cap in nearby.Where(e => e.IsCap))
        foreach (var c in cap.Connectors) {
            if (c.ConnectedTo is not { } to || !byId.TryGetValue(to.ElementId, out var s)) continue;
            var end = s.Connectors.FirstOrDefault(p => p.Index == to.Connector);
            var poly = s.Polyline;
            if (end is null || poly.Count < 2) continue;
            var first = Dist(end.Point, poly[0]) <= Dist(end.Point, poly[^1]);
            var (e, f) = first ? (poly[0], poly[1]) : (poly[^1], poly[^2]);
            if (Unit(Sub(e, f)) is not { } normal || SectionOf(s.Shape, s.DiameterIn, s.WidthIn, s.HeightIn, normal, RollOf(s)) is not { } section) continue;
            var at = first ? 0 : Enumerable.Range(1, poly.Count - 1).Sum(i => Dist(poly[i - 1], poly[i]));
            faces.Add(new Face(null, s, Add(e, normal, CapThicknessIn / 12), normal, section.Rect, section.Band, at, e, null));
        }
        foreach (var o in open) {
            var c = o.Connector;
            if (o.Axis is not { } axis || SectionOf(c.Shape, c.DiameterIn, c.WidthIn, c.HeightIn, axis, c.WidthAxis) is not { } section) continue;
            faces.Add(new Face(null, null, c.Point, axis, section.Rect, section.Band, 0, null, o));
        }
        return faces;
    }

    /// <summary>Where p sits against a side: t along, d out of its surface (negative inside), inward normal (null inside).</summary>
    private static (double T, double D, double[]? Normal)? Depth(Side face, double[] p) {
        var t = Dot(Sub(p, face.A), face.U);
        if (t < 0 || t > face.Len) return null;
        var r = Add(Sub(p, face.A), face.U, -t);
        if (face.Band is { } band) {
            var n = Norm(r);
            var d = n > band.Outer ? n - band.Outer : n < band.Inner ? n - band.Inner : 0;
            return (t, d, d < 0 ? null : r.Select(v => -v / n).ToArray());
        }
        var s = face.Rect!;
        var (x, y) = (Dot(r, s.X), Dot(r, s.Y));
        var (dx, dy) = (Math.Abs(x) - s.W, Math.Abs(y) - s.H);
        if (Math.Min(dx, dy) > 0) return null;
        var (dd, normal) = dx >= dy
            ? (dx, s.X.Select(v => -Math.Sign(x) * v).ToArray())
            : (dy, s.Y.Select(v => -Math.Sign(y) * v).ToArray());
        return (t, dd, dd < 0 ? null : normal);
    }

    /// <summary>How p (outward axis) lands on a face: signed distance out of it and where it joins.</summary>
    private static Hit? Land(Face face, double[] p, double[] axis) {
        if (face.Side is { } side) {
            if (Depth(side, p) is not { } at) return null;
            var along = Dot(axis, side.U);
            var outward = Math.Abs(along) >= AcrossCos && Math.Sign(along) != (at.T < side.Len / 2 ? 1 : -1);
            if (at.Normal is { } normal ? Dot(axis, normal) <= AxisCos : outward) return null;
            return new Hit(at.D, side.Segment, side.Run + at.T, Add(side.A, side.U, at.T));
        }
        if (Dot(axis, face.Normal!) >= -AxisCos) return null;
        var v = Sub(p, face.Origin!);
        var d = Dot(v, face.Normal!);
        var r = Add(v, face.Normal!, -d);
        var within = face.Band is { } band
            ? Norm(r) <= band.Outer
            : Math.Abs(Dot(r, face.Rect!.X)) <= face.Rect.W && Math.Abs(Dot(r, face.Rect.Y)) <= face.Rect.H;
        if (!within) return null;
        return face.Port is not null ? new Hit(d, null, 0, null) : new Hit(d, face.CapSegment, face.At, face.End);
    }

    /// <summary>Elements closing a cycle in the read's connector graph, equipment cut out (DuctNetwork's grouping walk).</summary>
    private static IEnumerable<long> LoopClosers(List<El> own) {
        var equipment = new HashSet<long>(own.Where(e => e.Node?.Kind == DuctNodeKind.Equipment).Select(e => e.Id));
        var adj = own.Where(e => !equipment.Contains(e.Id)).ToDictionary(e => e.Id, _ => new HashSet<long>());
        foreach (var e in own.Where(e => adj.ContainsKey(e.Id)))
        foreach (var c in e.Connectors)
            if (c.ConnectedTo is { } to && to.ElementId != e.Id && adj.ContainsKey(to.ElementId)) {
                adj[e.Id].Add(to.ElementId);
                adj[to.ElementId].Add(e.Id);
            }
        var seen = new HashSet<long>();
        var closers = new SortedSet<long>();
        foreach (var start in adj.Keys.OrderBy(k => k)) {
            if (seen.Contains(start)) continue;
            var parent = new Dictionary<long, long> { [start] = start };
            var stack = new Stack<long>();
            stack.Push(start);
            var seenEdges = new HashSet<(long, long)>();
            while (stack.Count > 0) {
                var x = stack.Pop();
                if (!seen.Add(x)) continue;
                foreach (var y in adj[x]) {
                    if (!seenEdges.Add((Math.Min(x, y), Math.Max(x, y)))) continue;
                    if (seen.Contains(y) || parent.ContainsKey(y)) closers.Add(y);
                    else {
                        parent[y] = x;
                        stack.Push(y);
                    }
                }
            }
        }
        return closers;
    }

    /// <summary>A uniform grid of element boxes (connector points and polyline vertices, padded by half the largest side).</summary>
    private sealed class Grid {
        private readonly Dictionary<(long, long, long), List<int>> _cells = new();
        private readonly double _size;

        public Grid(List<El> elements, double size) {
            this._size = Math.Max(size, 0.5);
            for (var i = 0; i < elements.Count; i++) {
                var e = elements[i];
                var points = e.Connectors.Where(c => c.Point.Length == 3).Select(c => c.Point)
                    .Concat(e.Segment?.Polyline.Where(p => p.Length == 3) ?? []).ToList();
                if (points.Count == 0) continue;
                var pad = e.Segment is { } s ? Math.Max(Math.Max(s.DiameterIn ?? 0, s.WidthIn ?? 0), s.HeightIn ?? 0) / 24 : 0;
                var lo = Enumerable.Range(0, 3).Select(k => this.Cell(points.Min(p => p[k]) - pad)).ToArray();
                var hi = Enumerable.Range(0, 3).Select(k => this.Cell(points.Max(p => p[k]) + pad)).ToArray();
                for (var x = lo[0]; x <= hi[0]; x++)
                for (var y = lo[1]; y <= hi[1]; y++)
                for (var z = lo[2]; z <= hi[2]; z++) {
                    if (!this._cells.TryGetValue((x, y, z), out var list)) this._cells[(x, y, z)] = list = [];
                    list.Add(i);
                }
            }
        }

        private long Cell(double v) => (long)Math.Floor(v / this._size);

        /// <summary>Indices of every element whose box meets the cube of half-size r around p, in element order.</summary>
        public IEnumerable<int> Around(double[] p, double r) {
            if (p.Length != 3) return [];
            var found = new SortedSet<int>();
            var lo = p.Select(v => this.Cell(v - r)).ToArray();
            var hi = p.Select(v => this.Cell(v + r)).ToArray();
            for (var x = lo[0]; x <= hi[0]; x++)
            for (var y = lo[1]; y <= hi[1]; y++)
            for (var z = lo[2]; z <= hi[2]; z++)
                if (this._cells.TryGetValue((x, y, z), out var list))
                    found.UnionWith(list);
            return found;
        }
    }

    private static bool Implausible(DuctSegment s) =>
        s.Shape == DuctShape.Round
            ? s.DiameterIn is < 3 or > 36
            : s is { WidthIn: { } w, HeightIn: { } h } && (Math.Min(w, h) < 2.5 || Math.Max(w, h) / Math.Max(0.1, Math.Min(w, h)) > 8);

    private static double[]? Mid(DuctSegment s) {
        if (s.Polyline.Count == 0) return null;
        var a = s.Polyline[0];
        var b = s.Polyline[^1];
        return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
    }

    private static string Slug(DuctIssueKind kind) =>
        typeof(DuctIssueKind).GetField(kind.ToString())!
            .GetCustomAttributes(typeof(System.Runtime.Serialization.EnumMemberAttribute), false)
            .Cast<System.Runtime.Serialization.EnumMemberAttribute>().Single().Value!;

    private static double[] Sub(double[] p, double[] q) => [p[0] - q[0], p[1] - q[1], p[2] - q[2]];
    private static double[] Add(double[] p, double[] q, double by = 1) => [p[0] + q[0] * by, p[1] + q[1] * by, p[2] + q[2] * by];
    private static double Dot(double[] p, double[] q) => p[0] * q[0] + p[1] * q[1] + p[2] * q[2];
    private static double Norm(double[] p) => Math.Sqrt(Dot(p, p));
    private static double Hypot(double a, double b) => Math.Sqrt(a * a + b * b);
    private static double Dist(double[] p, double[] q) => Norm(Sub(p, q));

    private static double[]? Unit(double[] p) {
        var n = Norm(p);
        return n < 1e-9 ? null : [p[0] / n, p[1] / n, p[2] / n];
    }
}
