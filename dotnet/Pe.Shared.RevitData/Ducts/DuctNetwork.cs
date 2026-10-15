namespace Pe.Shared.RevitData.Ducts;

/// <summary>
///     The Revit-free half of `ducts.snapshot`: groups the collected elements by connector topology with equipment
///     cut out, finds each group's roots, loops and issues, and sums terminal flow up single-root trees (pass 1).
///     No pressure solve happens here.
/// </summary>
public static class DuctNetwork {
    /// <summary>Terminal design flow, CFM. The collector writes it; pass 1 reads it.</summary>
    public const string TerminalFlow = "flow";
    /// <summary>Equipment external static pressure, in-wg.</summary>
    public const string ExternalStatic = "externalStatic";
    /// <summary>Accessory pressure drop, in-wg.</summary>
    public const string PressureDrop = "pressureDrop";
    /// <summary>The advisory line for Revit-reported velocity, fpm.</summary>
    public const double HighVelocityFpm = 2000;

    // Fitting geometry. The collector writes CenterRadius; Analyze derives the rest (provenance geometry, Inlet derived).
    /// <summary>Elbow centerline radius, in: the instance parameter "Center Radius" of Revit's elbow families.</summary>
    public const string CenterRadius = "centerRadius";
    /// <summary>Round elbow: CenterRadius over the connector diameter (ASHRAE CD3-x).</summary>
    public const string ROverD = "rOverD";
    /// <summary>Transition: physical inlet of an explicit In/Out pair. Other parts retain a root-facing connector, not physical airflow.</summary>
    public const string Inlet = "inlet";
    /// <summary>Transition: outlet area over inlet area in the flow direction (ASHRAE SD4/SR4 Ao/A1).</summary>
    public const string AoOverA1 = "aoOverA1";
    /// <summary>1 when the fitting sits on a duct's curve connector: a takeoff (tap) on the side of a main.</summary>
    public const string Takeoff = "takeoff";
    /// <summary>Takeoff: the main duct's element id.</summary>
    public const string MainSegment = "mainSegment";
    /// <summary>Takeoff: the main's diameter, in (round mains only).</summary>
    public const string MainDiameter = "mainDiameter";
    /// <summary>Takeoff: the main's cross-section area, ft2.</summary>
    public const string MainArea = "mainArea";
    /// <summary>Takeoff: branch area over main area (ASHRAE SD5-x Ab/Ac).</summary>
    public const string AbOverAc = "abOverAc";

    /// <summary>The family's own loss coefficient, read through the FittingCoefficient slot (what the Pe loss server charges).</summary>
    public const string FamilyCoefficient = "familyCoefficient";

    /// <summary>Part types with more than one downstream leg: a leg without flow is an issue there, and Revit caches a slot per leg (pressure-drop ledger, 2026-10-08).</summary>
    public static readonly HashSet<string> JunctionPartTypes = new(StringComparer.Ordinal) {
        "Tee", "TapAdjustable", "TapPerpendicular", "Wye", "Cross", "LateralTee", "LateralCross", "Pants", "MultiPort"
    };

    public sealed record Analysis(
        IReadOnlyList<DuctNode> Nodes,
        IReadOnlyList<DuctSegment> Segments,
        IReadOnlyList<DuctGroup> Groups,
        IReadOnlyList<DuctFlow> Flows,
        IReadOnlyList<DuctIssue> Issues);

    private sealed record Part(long Id, bool Equipment, IReadOnlyList<DuctConnector> Connectors);

    public static Analysis Analyze(IReadOnlyList<DuctNode> nodes, IReadOnlyList<DuctSegment> segments) {
        var parts = nodes.Select(n => new Part(n.Id, n.Kind == DuctNodeKind.Equipment, n.Connectors))
            .Concat(segments.Select(s => new Part(s.Id, false, s.Connectors)))
            .ToDictionary(p => p.Id);
        var nodeById = nodes.ToDictionary(n => n.Id);
        var segById = segments.ToDictionary(s => s.Id);

        // Undirected edges between non-equipment parts; equipment ports become root attachments.
        var adj = parts.Values.Where(p => !p.Equipment).ToDictionary(p => p.Id, _ => new HashSet<long>());
        var attach = new HashSet<(long element, long equipment, int port)>();
        foreach (var part in parts.Values)
        foreach (var c in part.Connectors) {
            if (c.ConnectedTo is not { } to || !parts.TryGetValue(to.ElementId, out var other) || other.Id == part.Id) continue;
            if (part.Equipment && other.Equipment) continue;
            if (part.Equipment) attach.Add((other.Id, part.Id, c.Index));
            else if (other.Equipment) attach.Add((part.Id, other.Id, to.Connector));
            else {
                adj[part.Id].Add(other.Id);
                adj[other.Id].Add(part.Id);
            }
        }

        var groupOf = new Dictionary<long, string>();
        var members = new List<List<long>>();
        var loopClosers = new Dictionary<int, List<long>>();
        foreach (var start in adj.Keys.OrderBy(k => k)) {
            if (groupOf.ContainsKey(start)) continue;
            var ids = new List<long>();
            var closers = new List<long>();
            var parent = new Dictionary<long, long> { [start] = start };
            var stack = new Stack<long>();
            stack.Push(start);
            var seenEdges = new HashSet<(long, long)>();
            while (stack.Count > 0) {
                var x = stack.Pop();
                if (groupOf.ContainsKey(x)) continue;
                groupOf[x] = "";
                ids.Add(x);
                foreach (var y in adj[x]) {
                    if (!seenEdges.Add((Math.Min(x, y), Math.Max(x, y)))) continue;
                    if (groupOf.ContainsKey(y) || parent.ContainsKey(y)) closers.Add(y);
                    else {
                        parent[y] = x;
                        stack.Push(y);
                    }
                }
            }
            var id = "g" + ids.Min();
            foreach (var m in ids) groupOf[m] = id;
            loopClosers[members.Count] = closers;
            members.Add(ids);
        }

        var groups = new List<DuctGroup>();
        var parentOf = new Dictionary<long, long>();
        var flows = new List<DuctFlow>();
        var issues = new List<DuctIssue>();
        for (var i = 0; i < members.Count; i++) {
            var ids = members[i];
            var gid = groupOf[ids[0]];
            var set = new HashSet<long>(ids);
            var ports = attach.Where(a => set.Contains(a.element)).ToList();
            var roots = ports.Select(a => a.equipment).Distinct().OrderBy(x => x).ToList();
            var edges = ids.Sum(x => adj[x].Count) / 2;
            var loops = edges - ids.Count + 1;
            var groupIssues = new List<DuctIssue>();
            void Add(DuctIssueKind kind, long? element, double[]? point, string note, int? connector = null) =>
                groupIssues.Add(new DuctIssue(
                    $"{Slug(kind)}:{gid}{(element is { } e ? ":" + e : "")}{(connector is { } c ? ":" + c : "")}",
                    kind, element, point, gid, note));

            var classes = new SortedSet<string>(StringComparer.Ordinal);
            var systems = new SortedSet<string>(StringComparer.Ordinal);
            var terminals = 0;
            foreach (var x in ids) {
                nodeById.TryGetValue(x, out var node);
                segById.TryGetValue(x, out var seg);
                var cls = node?.Classification ?? seg?.Classification;
                var sys = node?.SystemName ?? seg?.SystemName;
                if (!string.IsNullOrEmpty(cls)) classes.Add(cls!);
                if (!string.IsNullOrEmpty(sys)) systems.Add(sys!);
                if (node?.Kind != DuctNodeKind.Cap)
                    foreach (var c in parts[x].Connectors.Where(c => c.ConnectedTo is null))
                        Add(DuctIssueKind.OpenEnd, x, c.Point,
                            node?.Kind == DuctNodeKind.Terminal ? "terminal not connected" : "nothing attached", c.Index);
                if (node?.Kind == DuctNodeKind.Terminal) {
                    terminals++;
                    if (!(Fact(node, TerminalFlow) > 0)) Add(DuctIssueKind.NoTerminalFlow, x, node.Point, "no design flow");
                }
                if (node?.Kind == DuctNodeKind.Accessory && !(Fact(node, PressureDrop) > 0))
                    Add(DuctIssueKind.NoComponentDrop, x, node.Point, $"{node.Family} states no pressure drop");
                if (seg is null) continue;
                if (seg.Kind == DuctSegmentKind.Duct && seg.LengthFt < 0.25)
                    Add(DuctIssueKind.Stub, x, Mid(seg), $"{seg.LengthFt * 12:0.##} in long");
                if (seg.Revit.VelocityFpm >= HighVelocityFpm)
                    Add(DuctIssueKind.HighVelocity, x, Mid(seg), $"{seg.Revit.VelocityFpm:0} fpm (Revit)");
                if (Implausible(seg)) Add(DuctIssueKind.ImplausibleSize, x, Mid(seg), seg.Size);
                if (seg.Kind == DuctSegmentKind.Flex && seg.Roughness.Provenance == DuctProvenance.RevitDefault)
                    Add(DuctIssueKind.DefaultFlexRoughness, x, Mid(seg), $"type {seg.Type} roughness {seg.Roughness.ValueFt} ft is the rigid default");
            }
            foreach (var x in loopClosers[i].Distinct())
                Add(DuctIssueKind.Loop, x, Point(x), "closes a loop");
            if (classes.Count > 1) Add(DuctIssueKind.MixedClassification, null, null, string.Join(", ", classes));
            if (ports.Count == 0) Add(DuctIssueKind.NoRoot, null, null, terminals > 0 ? "terminals but no equipment port" : "no equipment port and no terminal");
            if (ports.Count > 1) Add(DuctIssueKind.MultiRoot, null, null, $"{ports.Count} equipment ports on {roots.Count} equipment");
            foreach (var r in roots)
                if (!(Fact(nodeById[r], ExternalStatic) > 0))
                    Add(DuctIssueKind.NoFanStatic, r, nodeById[r].Point, $"{nodeById[r].Family} states no external static");

            if (ports.Count == 1 && loops == 0) {
                var (groupFlows, parent) = PassOne(ports[0].element, adj, nodeById, segById);
                flows.AddRange(groupFlows);
                foreach (var kv in parent) parentOf[kv.Key] = kv.Value == kv.Key ? ports[0].equipment : kv.Value;
                var flowOf = groupFlows.ToDictionary(f => f.SegmentId, f => f.Cfm);
                foreach (var x in ids) {
                    if (!nodeById.TryGetValue(x, out var node) || node.Kind != DuctNodeKind.Fitting || !JunctionPartTypes.Contains(node.PartType ?? "")) continue;
                    foreach (var c in node.Connectors)
                        if (c.ConnectedTo is { } to && flowOf.TryGetValue(to.ElementId, out var cfm) && cfm <= 0)
                            Add(DuctIssueKind.NoFlowLeg, x, c.Point, $"{node.PartType} leg {c.Index} carries no flow", c.Index);
                }
            }
            issues.AddRange(groupIssues);
            groups.Add(new DuctGroup(gid, roots, classes.ToList(), systems.ToList(), terminals, ids.Count, loops,
                groupIssues.Select(x => x.Id).ToList()));
        }

        return new Analysis(
            nodes.Select(n => n with {
                GroupId = groupOf.TryGetValue(n.Id, out var g) ? g : null,
                Facts = n.Kind is DuctNodeKind.Fitting or DuctNodeKind.Accessory
                    ? n.Facts.Concat(Geometry(n, parentOf.TryGetValue(n.Id, out var up) ? up : null, segById)).ToList()
                    : n.Facts
            }).ToList(),
            segments.Select(s => s with { GroupId = groupOf.TryGetValue(s.Id, out var g) ? g : null }).ToList(),
            groups.OrderByDescending(g => g.ElementCount).ThenBy(g => g.Id, StringComparer.Ordinal).ToList(),
            flows,
            issues);

        double[]? Point(long id) => nodeById.TryGetValue(id, out var n) ? n.Point : segById.TryGetValue(id, out var s) ? Mid(s) : null;
    }

    /// <summary>Ratios a coefficient table is looked up by. Transitions use explicit physical direction, never the root walk.</summary>
    private static IEnumerable<DuctFact> Geometry(DuctNode n, long? parent, Dictionary<long, DuctSegment> segments) {
        DuctFact F(string key, double value, string unit, DuctProvenance p = DuctProvenance.Geometry) =>
            new(key, Math.Round(value, 4), null, unit, p);
        var ports = n.Connectors;
        if (Fact(n, CenterRadius) is { } r && ports.FirstOrDefault()?.DiameterIn is { } d && d > 0)
            yield return F(ROverD, r / d, "");
        var inlet = n.PartType == "Transition"
            ? TwoPortFlow(ports, c => c.Direction)?.In
            : parent is { } up ? ports.FirstOrDefault(c => c.ConnectedTo?.ElementId == up) : null;
        if (inlet is not null) {
            yield return F(Inlet, inlet.Index, "", DuctProvenance.Derived);
            if (n.PartType == "Transition" && ports.Count == 2
                && Area(inlet.Shape, inlet.DiameterIn, inlet.WidthIn, inlet.HeightIn) is { } a1 && a1 > 0
                && ports.First(c => c != inlet) is { } outlet
                && Area(outlet.Shape, outlet.DiameterIn, outlet.WidthIn, outlet.HeightIn) is { } ao)
                yield return new DuctFact(AoOverA1, ao / a1, null, "", DuctProvenance.Geometry);
        }
        foreach (var c in ports) {
            if (c.ConnectedTo is not { } to || !segments.TryGetValue(to.ElementId, out var main)) continue;
            if (main.Connectors.FirstOrDefault(m => m.Index == to.Connector)?.Kind != "curve") continue;
            yield return F(Takeoff, 1, "");
            yield return F(MainSegment, main.Id, "");
            if (main.Shape == DuctShape.Round && main.DiameterIn is { } md) yield return F(MainDiameter, md, "in");
            var ac = Area(main.Shape, main.DiameterIn, main.WidthIn, main.HeightIn);
            if (ac is not { } mainArea || mainArea <= 0) yield break;
            yield return F(MainArea, mainArea, "ft2");
            if (Area(ports.FirstOrDefault(o => o != c) ?? c) is { } ab) yield return F(AbOverAc, ab / mainArea, "");
            yield break;
        }
    }

    // Traversal toward a root does not establish physical airflow (return paths run the other way).
    internal static (T In, T Out)? TwoPortFlow<T>(IReadOnlyList<T> ports, Func<T, string> direction) where T : class {
        if (ports.Count != 2) return null;
        if (direction(ports[0]) == "in" && direction(ports[1]) == "out") return (ports[0], ports[1]);
        if (direction(ports[1]) == "in" && direction(ports[0]) == "out") return (ports[1], ports[0]);
        return null;
    }

    /// <summary>Cross-section area, ft2; flat oval is a rectangle with two half-round ends (W major, H minor).</summary>
    public static double? Area(DuctShape shape, double? diameterIn, double? widthIn, double? heightIn) => shape switch {
        DuctShape.Round when diameterIn is { } d => Math.PI / 4 * d * d / 144,
        DuctShape.Rectangular when widthIn is { } w && heightIn is { } h => w * h / 144,
        DuctShape.Oval when widthIn is { } w && heightIn is { } h =>
            (Math.PI / 4 * Math.Min(w, h) * Math.Min(w, h) + Math.Min(w, h) * Math.Abs(w - h)) / 144,
        _ => null
    };

    private static double? Area(DuctConnector c) => c.AreaFt2 ?? Area(c.Shape, c.DiameterIn, c.WidthIn, c.HeightIn);

    /// <summary>Sum terminal design flow up a tree rooted at the element attached to the one equipment port.</summary>
    private static (IEnumerable<DuctFlow> Flows, Dictionary<long, long> Parent) PassOne(
        long root,
        Dictionary<long, HashSet<long>> adj,
        Dictionary<long, DuctNode> nodes,
        Dictionary<long, DuctSegment> segments
    ) {
        var order = new List<long>();
        var parent = new Dictionary<long, long> { [root] = root };
        var stack = new Stack<long>();
        stack.Push(root);
        while (stack.Count > 0) {
            var x = stack.Pop();
            order.Add(x);
            foreach (var y in adj[x].Where(y => !parent.ContainsKey(y))) {
                parent[y] = x;
                stack.Push(y);
            }
        }
        var sum = order.ToDictionary(x => x, x => nodes.TryGetValue(x, out var n) && n.Kind == DuctNodeKind.Terminal ? Fact(n, TerminalFlow) ?? 0 : 0);
        for (var i = order.Count - 1; i > 0; i--) sum[parent[order[i]]] += sum[order[i]];
        return (order.Where(segments.ContainsKey).Select(x => new DuctFlow(x, Math.Round(sum[x], 1), DuctProvenance.Derived)).ToList(), parent);
    }

    public static double? Fact(DuctNode node, string key) => node.Facts.FirstOrDefault(f => f.Key == key)?.Value;

    private static bool Implausible(DuctSegment s) =>
        s.Shape == DuctShape.Round
            ? s.DiameterIn is < 3 or > 36
            : s is { WidthIn: { } w, HeightIn: { } h } && (Math.Min(w, h) < 2.5 || Math.Max(w, h) / Math.Max(0.1, Math.Min(w, h)) > 8);

    private static double[]? Mid(DuctSegment s) {
        if (s.Polyline.Count == 0) return null;
        var a = s.Polyline[0];
        var b = s.Polyline[s.Polyline.Count - 1];
        return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
    }

    private static string Slug(DuctIssueKind kind) =>
        typeof(DuctIssueKind).GetField(kind.ToString())!
            .GetCustomAttributes(typeof(System.Runtime.Serialization.EnumMemberAttribute), false)
            .Cast<System.Runtime.Serialization.EnumMemberAttribute>().Single().Value!;
}
