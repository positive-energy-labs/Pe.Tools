namespace Pe.Shared.RevitData.Ducts;

/// <summary>A bounded document index. Element payload and pressure exist only for Group; Context is opt-in geometry.</summary>
public sealed record DuctSnapshotReading(
    DuctDocument Document,
    IReadOnlyList<DuctLevel> Levels,
    IReadOnlyList<DuctLayer> Layers,
    IReadOnlyList<DuctGroupIndex> Groups) {
    public string? Group { get; init; }
    public long? AssumptionRevision { get; init; }
    public IReadOnlyList<DuctNode>? Nodes { get; init; }
    public IReadOnlyList<DuctSegment>? Segments { get; init; }
    public IReadOnlyList<DuctFlow>? Flows { get; init; }
    public IReadOnlyList<DuctIssue>? Issues { get; init; }
    public DuctPressureResult? Pressure { get; init; }
    public IReadOnlyList<DuctContextLevel>? Context { get; init; }
}

/// <summary>Counts and readiness evidence, without element records or issue handles. Root names correspond to RootIds.</summary>
public sealed record DuctGroupIndex(string Id, IReadOnlyList<long> RootIds, IReadOnlyList<string> RootNames,
    IReadOnlyList<string> Classifications, IReadOnlyList<string> SystemNames,
    int TerminalCount, int ElementCount, int SegmentCount, int Loops,
    double DesignCfm, DuctBounds? Bounds, IReadOnlyList<DuctIssueCount> IssueCounts);

/// <summary>Captured issue count and the count still unanswered by staged Work; the web taxonomy owns readiness labels.</summary>
public sealed record DuctIssueCount(DuctIssueKind Kind, int Count, int Open);
public sealed record DuctBounds(double[] Min, double[] Max);

/// <summary>Geometry only, grouped by level. Coordinates are model feet rounded to 0.01 ft; short stubs are omitted.</summary>
public sealed record DuctContextLevel(long? LevelId, IReadOnlyList<IReadOnlyList<double[]>> Polylines);

/// <summary>The single shaping path for native reads and deterministic saved-capture measurements.</summary>
public static class DuctSnapshotReader {
    public static DuctSnapshotReading Read(DuctSnapshotData snapshot, DuctSnapshotRequest request) {
        var selected = request.Group is null ? null : snapshot.Groups.FirstOrDefault(g => g.Id == request.Group)
            ?? throw new ArgumentException($"Unknown duct group '{request.Group}'; call without group to list groups.");
        // Validate the document's Work before narrowing, so valid assumptions for another group remain valid.
        var assumptions = DuctPressureAssessment.Map(snapshot, request.Assumptions);
        var nodes = snapshot.Nodes.ToDictionary(n => n.Id);
        var segments = snapshot.Segments.ToDictionary(s => s.Id);
        var nodesOf = snapshot.Nodes.Where(n => n.GroupId != null).ToLookup(n => n.GroupId!);
        var segmentsOf = snapshot.Segments.Where(s => s.GroupId != null).ToLookup(s => s.GroupId!);
        var issuesOf = snapshot.Issues.ToLookup(i => i.GroupId);
        OpenEndVerdict? Verdict(string key) => request.Assumptions?.Values.TryGetValue(key, out var value) == true
            ? value.Verdict : null;
        bool Answered(DuctIssue issue) => issue.Kind switch {
            DuctIssueKind.OpenEnd => Verdict(issue.Id) is OpenEndVerdict.Capped or OpenEndVerdict.Ignore,
            DuctIssueKind.NoTerminalFlow => Verdict(issue.Id) == OpenEndVerdict.Ignore,
            DuctIssueKind.NoFanStatic => issue.ElementId is { } fan && assumptions.FanExternalStatic.ContainsKey(fan),
            DuctIssueKind.NoComponentDrop => issue.ElementId is { } component && nodes.TryGetValue(component, out var node)
                && node.Family is { } family && assumptions.ComponentDropByFamily.ContainsKey(family),
            DuctIssueKind.DefaultFlexRoughness => Verdict(issue.Id) == OpenEndVerdict.Ignore
                || issue.ElementId is { } flex && segments.TryGetValue(flex, out var segment)
                && segment.Type is { } type && assumptions.FlexRoughnessByType.ContainsKey(type),
            _ => false
        };
        var index = snapshot.Groups.Select(g => {
            var ownNodes = nodesOf[g.Id].ToArray();
            var ownSegments = segmentsOf[g.Id].ToArray();
            var roots = g.RootIds.Select(id => nodes[id]).ToArray();
            return new DuctGroupIndex(g.Id, g.RootIds,
                roots.Select(n => string.Join(" / ", new[] { n.Family, n.Type }.Where(s => !string.IsNullOrEmpty(s)))).ToArray(),
                g.Classifications, g.SystemNames, g.TerminalCount, g.ElementCount, ownSegments.Length, g.Loops,
                ownNodes.Where(n => n.Kind == DuctNodeKind.Terminal).Sum(n => n.Facts.FirstOrDefault(f => f.Key == DuctNetwork.TerminalFlow)?.Value ?? 0),
                Bounds(ownNodes.Concat(roots).Select(n => n.Point).Concat(ownSegments.SelectMany(s => s.Polyline))),
                issuesOf[g.Id].GroupBy(i => i.Kind).Select(k => new DuctIssueCount(k.Key, k.Count(), k.Count(i => !Answered(i)))).ToArray());
        }).ToArray();
        var reading = new DuctSnapshotReading(snapshot.Document, snapshot.Levels, snapshot.Layers, index) {
            Group = selected?.Id, AssumptionRevision = request.Assumptions?.Revision,
            Context = request.Context ? snapshot.Segments.Where(s => (selected is null || s.GroupId != selected.Id) && s.LengthFt >= 2)
                .GroupBy(s => s.LevelId).Select(g => new DuctContextLevel(g.Key,
                    g.Select(s => Decimate(s.Polyline)).ToArray())).ToArray() : null
        };
        if (selected is null) return reading;
        DuctConnector Boundary(DuctConnector connector) {
            if (connector.ConnectedTo is not { } peer) return connector;
            nodes.TryGetValue(peer.ElementId, out var node);
            segments.TryGetValue(peer.ElementId, out var segment);
            var group = node?.GroupId ?? segment?.GroupId;
            var ports = node?.Connectors ?? segment?.Connectors;
            // Only an existing captured peer is a boundary. Broken references remain defects.
            return group != null && group != selected.Id && ports?.Any(p => p.Index == peer.Connector) == true
                ? connector with { OutsideGroup = group } : connector;
        }
        var own = snapshot with {
            Groups = [selected],
            Nodes = snapshot.Nodes.Where(n => n.GroupId == selected.Id || selected.RootIds.Contains(n.Id))
                .Select(n => n with { Connectors = n.Connectors.Select(Boundary).ToArray() }).ToArray(),
            Segments = segmentsOf[selected.Id].Select(s => s with { Connectors = s.Connectors.Select(Boundary).ToArray() }).ToArray(),
            Flows = snapshot.Flows.Where(f => segments[f.SegmentId].GroupId == selected.Id).ToArray(),
            Issues = issuesOf[selected.Id].ToArray(), Pressure = null
        };
        // Fan budgets depend on sibling supply/return groups. Solve the capture before bounding the response.
        var full = DuctPressureSolver.Solve(new DuctNetwork.Analysis(snapshot.Nodes, snapshot.Segments, snapshot.Groups, snapshot.Flows, snapshot.Issues), assumptions);
        var pressure = full with {
            Segments = full.Segments.Where(s => s.GroupId == selected.Id).ToArray(),
            Fittings = full.Fittings.Where(f => f.GroupId == selected.Id).ToArray(),
            Terminals = full.Terminals.Where(t => t.GroupId == selected.Id).ToArray(),
            Groups = full.Groups.Where(g => g.GroupId == selected.Id).ToArray(),
            Issues = full.Issues.Where(i => i.GroupId == selected.Id || i.GroupId == "" &&
                (own.Nodes.Any(n => n.Id == i.ElementId) || own.Segments.Any(s => s.Id == i.ElementId))).ToArray()
        };
        var used = new HashSet<string>(pressure.Segments.SelectMany(s => s.AssumptionsUsed)
            .Concat(pressure.Fittings.SelectMany(f => f.AssumptionsUsed))
            .Concat(pressure.Terminals.SelectMany(t => t.AssumptionsUsed))
            .Concat(pressure.Groups.SelectMany(g => g.AssumptionsUsed)));
        return reading with { Nodes = own.Nodes, Segments = own.Segments, Flows = own.Flows, Issues = own.Issues,
            Pressure = pressure with { AssumptionRevision = request.Assumptions?.Revision,
                AssumptionsUsed = full.AssumptionsUsed.Where(a => used.Contains(a.Id)).ToArray() } };
    }

    private static DuctBounds? Bounds(IEnumerable<double[]> points) {
        var all = points.ToArray();
        return all.Length == 0 ? null : new(
            Enumerable.Range(0, 3).Select(i => Math.Floor(all.Min(p => p[i]) * 100) / 100).ToArray(),
            Enumerable.Range(0, 3).Select(i => Math.Ceiling(all.Max(p => p[i]) * 100) / 100).ToArray());
    }

    private static IReadOnlyList<double[]> Decimate(IReadOnlyList<double[]> points) {
        // ponytail: at most eight points per faint curve; use geometric simplification if context fidelity needs it.
        var count = Math.Min(points.Count, 8);
        return Enumerable.Range(0, count).Select(i => points[count < 2 ? 0 : i * (points.Count - 1) / (count - 1)]
            .Select(v => Math.Round(v, 2)).ToArray()).ToArray();
    }
}
