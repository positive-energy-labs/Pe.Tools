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

            if (ports.Count == 1 && loops == 0) flows.AddRange(PassOne(ports[0].element, adj, nodeById, segById));
            issues.AddRange(groupIssues);
            groups.Add(new DuctGroup(gid, roots, classes.ToList(), systems.ToList(), terminals, ids.Count, loops,
                groupIssues.Select(x => x.Id).ToList()));
        }

        return new Analysis(
            nodes.Select(n => n with { GroupId = groupOf.TryGetValue(n.Id, out var g) ? g : null }).ToList(),
            segments.Select(s => s with { GroupId = groupOf.TryGetValue(s.Id, out var g) ? g : null }).ToList(),
            groups.OrderByDescending(g => g.ElementCount).ThenBy(g => g.Id, StringComparer.Ordinal).ToList(),
            flows,
            issues);

        double[]? Point(long id) => nodeById.TryGetValue(id, out var n) ? n.Point : segById.TryGetValue(id, out var s) ? Mid(s) : null;
    }

    /// <summary>Sum terminal design flow up a tree rooted at the element attached to the one equipment port.</summary>
    private static IEnumerable<DuctFlow> PassOne(
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
        return order.Where(segments.ContainsKey).Select(x => new DuctFlow(x, Math.Round(sum[x], 1), DuctProvenance.Derived));
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
