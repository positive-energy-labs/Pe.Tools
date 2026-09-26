using System.Globalization;
using Newtonsoft.Json;

namespace Pe.Shared.RevitData.Ducts;

/// <summary>
/// Pressure assessment of captured or authored duct networks. No Revit runtime is used.
/// Only unique equipment-to-terminal paths are walked; cycle edges and ambiguous root connections remain issues.
/// Known demand in an incomplete subtree is reported as a partial calculation, never as a balanced network solution.
/// </summary>
public static class DuctPressureSolver {
    /// <summary>Read the unchanged ducts.snapshot JSON payload (not a host response envelope).</summary>
    public static DuctSnapshotData ReadSnapshot(string json) =>
        JsonConvert.DeserializeObject<DuctSnapshotData>(json)
        ?? throw new ArgumentException("Expected a ducts.snapshot payload.", nameof(json));

    /// <summary>Analyze a captured or authored snapshot and solve with the same API used by Pea scripts.</summary>
    public static DuctPressureResult Solve(DuctSnapshotData network, Assumptions assumptions) =>
        Solve(DuctNetwork.Analyze(network.Nodes, network.Segments), assumptions);

    /// <summary>Solve a pass-1 network. Flow is summed on each walkable subtree, including individual intervals of tapped ducts.</summary>
    public static DuctPressureResult Solve(DuctNetwork.Analysis network, Assumptions assumptions) => new Run(network, assumptions).Solve();

    private sealed record Part(long Id, IReadOnlyList<DuctConnector> Ports, DuctNode? Node, DuctSegment? Segment);
    private sealed record Contribution(double Loss, double Length, bool Complete, IReadOnlyList<string> Used);
    private sealed record Walk(long Root, string Group, List<long> Order, Dictionary<long, long> Parent,
        Dictionary<long, double> Flow, Dictionary<long, bool> Complete);

    private sealed class Run(DuctNetwork.Analysis network, Assumptions assumptions) {
        private readonly Dictionary<long, Part> parts = network.Nodes.Select(n => new Part(n.Id, n.Connectors, n, null))
            .Concat(network.Segments.Select(s => new Part(s.Id, s.Connectors, null, s))).ToDictionary(p => p.Id);
        private readonly Dictionary<string, UsedAssumption> used = new(StringComparer.Ordinal);
        private readonly List<PressureIssue> issues = [];
        private readonly List<SegmentPressure> segments = [];
        private readonly List<FittingPressure> fittings = [];
        private readonly List<TerminalPressure> terminals = [];
        private readonly Dictionary<long, List<long>> adjacency = [];
        private readonly Dictionary<(long, long), List<(DuctConnector A, DuctConnector B)>> links = [];
        private readonly Dictionary<long, string> groupOf = network.Nodes.Where(n => n.GroupId != null).ToDictionary(n => n.Id, n => n.GroupId!)
            .Concat(network.Segments.Where(s => s.GroupId != null).ToDictionary(s => s.Id, s => s.GroupId!)).ToDictionary(p => p.Key, p => p.Value);

        internal DuctPressureResult Solve() {
            ValidateAssumptions();
            BuildGraph();
            foreach (var walk in Walks()) Calculate(walk);
            var groups = Budgets();
            return new(segments, fittings, terminals, groups, issues.Distinct().ToList(), used.Values.OrderBy(a => a.Id, StringComparer.Ordinal).ToList());
        }

        private string Use<T>(string id, Assumption<T> value) {
            if (string.IsNullOrWhiteSpace(value.Reason) || !Enum.IsDefined(typeof(AssumptionSource), value.Source))
                throw new ArgumentException($"Assumption {id} needs a source and a reason (cite a source for defaults).");
            used[id] = new(id, value.Value is null ? "unknown" : Convert.ToString(value.Value, CultureInfo.InvariantCulture) ?? "unknown", value.Source, value.Reason);
            return id;
        }

        private void ValidateAssumptions() {
            void Nonnegative(double? x, string name) {
                if (x.HasValue && !DuctPressurePhysics.Nonnegative(x.Value)) throw new ArgumentException($"{name} must be finite and nonnegative.");
            }
            if (!DuctPressurePhysics.Positive(assumptions.AirDensityKgPerM3.Value) || !DuctPressurePhysics.Positive(assumptions.AirViscosityPaS.Value))
                throw new ArgumentException("Air density and viscosity must be positive and finite.");
            foreach (var a in assumptions.FanExternalStatic.Values.Concat(assumptions.ComponentDropByElement.Values).Concat(assumptions.ComponentDropByFamily.Values))
                Nonnegative(a.Value, "Static/component pressure");
            // Negative junction coefficients can represent static recovery; authored overrides retain their sign.
            foreach (var a in assumptions.FittingCoefficients.Values)
                if (double.IsNaN(a.Value) || double.IsInfinity(a.Value)) throw new ArgumentException("Fitting coefficients must be finite.");
            Nonnegative(assumptions.DefaultFanExternalStatic.Value, "Default fan static");
            Nonnegative(assumptions.DefaultComponentDrop.Value, "Default component drop");
            Nonnegative(assumptions.FlexRoughnessFt.Value, "Flex roughness");
            foreach (var value in assumptions.FlexRoughnessByType.Values) Nonnegative(value.Value, "Flex type roughness");
            Nonnegative(assumptions.UnmatchedFittingCoefficient.Value, "Unmatched coefficient");
            if (assumptions.FlexPressureMultiplier.Value is { } multiplier && (!DuctPressurePhysics.Positive(multiplier) || multiplier < 1))
                throw new ArgumentException("Flex compression multiplier must be finite and at least one.");
            if (!Enum.IsDefined(typeof(FlexCompression), assumptions.FlexCompression.Value)) throw new ArgumentException("Unknown flex compression class.");
            foreach (var v in assumptions.OpenEnds.Values)
                if (!Enum.IsDefined(typeof(OpenEndVerdict), v.Value)) throw new ArgumentException("Unknown open-end verdict.");
            foreach (var g in assumptions.FittingGeometry.Values)
                if (!DuctPressurePhysics.Nonnegative(g.Value.AngleDegrees) || g.Value.AngleDegrees > 180 || !DuctPressurePhysics.Positive(g.Value.RadiusOverDiameter))
                    throw new ArgumentException("Fitting geometry requires a finite angle from 0 to 180 and positive r/D.");
        }

        private void Issue(string code, string group, long? id, string reason) => issues.Add(new(code, group, id, reason));
        private static (long, long) Pair(long a, long b) => a < b ? (a, b) : (b, a);

        private void BuildGraph() {
            foreach (var p in parts.Values) adjacency[p.Id] = [];
            var seen = new HashSet<(long, int, long, int)>();
            foreach (var p in parts.Values)
            foreach (var c in p.Ports) {
                if (c.ConnectedTo is not { } to) continue;
                var gid = groupOf.TryGetValue(p.Id, out var g) ? g : "";
                if (!parts.TryGetValue(to.ElementId, out var other) || other.Ports.FirstOrDefault(x => x.Index == to.Connector) is not { } oc) {
                    Issue("missing-connector", gid, p.Id, $"Connector {c.Index} points to absent {to.ElementId}:{to.Connector}.");
                    continue;
                }
                if (p.Id == other.Id) { Issue("self-loop", gid, p.Id, "A part connects to itself."); continue; }
                var key = p.Id < other.Id ? (p.Id, c.Index, other.Id, oc.Index) : (other.Id, oc.Index, p.Id, c.Index);
                if (!seen.Add(key)) continue;
                var pair = Pair(p.Id, other.Id);
                if (!links.TryGetValue(pair, out var ports)) {
                    ports = [];
                    links[pair] = ports;
                    adjacency[p.Id].Add(other.Id);
                    adjacency[other.Id].Add(p.Id);
                }
                ports.Add(p.Id < other.Id ? (c, oc) : (oc, c));
            }
        }

        private DuctConnector Port(long id, long neighbor) {
            var link = links[Pair(id, neighbor)][0];
            return id < neighbor ? link.A : link.B;
        }

        // Iterative Tarjan bridge search: removing cycle edges retains only paths with a unique physical route.
        private HashSet<(long, long)> Bridges() {
            var bridges = new HashSet<(long, long)>();
            var discovery = new Dictionary<long, int>();
            var low = new Dictionary<long, int>();
            var parent = new Dictionary<long, long>();
            var clock = 0;
            foreach (var start in adjacency.Keys.Where(x => parts[x].Node?.Kind != DuctNodeKind.Equipment)) {
                if (discovery.ContainsKey(start)) continue;
                parent[start] = start;
                discovery[start] = low[start] = ++clock;
                var stack = new Stack<(long Id, int Next)>();
                stack.Push((start, 0));
                while (stack.Count > 0) {
                    var (id, next) = stack.Pop();
                    if (next == adjacency[id].Count) {
                        if (parent[id] == id) continue;
                        var p = parent[id];
                        low[p] = Math.Min(low[p], low[id]);
                        if (low[id] > discovery[p] && links[Pair(id, p)].Count == 1) bridges.Add(Pair(id, p));
                        continue;
                    }
                    stack.Push((id, next + 1));
                    var child = adjacency[id][next];
                    if (parts[child].Node?.Kind == DuctNodeKind.Equipment) continue;
                    if (child == parent[id] && links[Pair(id, child)].Count == 1) continue;
                    if (discovery.TryGetValue(child, out var d)) { low[id] = Math.Min(low[id], d); continue; }
                    parent[child] = id;
                    discovery[child] = low[child] = ++clock;
                    stack.Push((child, 0));
                }
            }
            return bridges;
        }

        private IEnumerable<Walk> Walks() {
            var bridges = Bridges();
            var visited = new HashSet<long>();
            foreach (var start in adjacency.Keys.Where(x => parts[x].Node?.Kind != DuctNodeKind.Equipment).OrderBy(x => x)) {
                if (!visited.Add(start)) continue;
                var component = new List<long>();
                var queue = new Queue<long>();
                queue.Enqueue(start);
                while (queue.Count > 0) {
                    var id = queue.Dequeue();
                    component.Add(id);
                    foreach (var child in adjacency[id].Where(x => bridges.Contains(Pair(id, x))))
                        if (visited.Add(child)) queue.Enqueue(child);
                }
                var gid = groupOf.TryGetValue(start, out var g) ? g : "g" + component.Min();
                var attachments = component.SelectMany(id => adjacency[id].Where(x => parts[x].Node?.Kind == DuctNodeKind.Equipment)
                    .SelectMany(root => links[Pair(id, root)].Select(_ => (Id: id, Root: root)))).ToList();
                if (attachments.Count != 1) {
                    Issue(attachments.Count == 0 ? "no-unique-root-path" : "multiple-root-ports", gid, start,
                        $"This acyclic component has {attachments.Count} equipment attachments; no unique root flow can be assigned.");
                    continue;
                }
                var entry = attachments[0];
                var order = new List<long>();
                var parent = new Dictionary<long, long> { [entry.Id] = entry.Root };
                queue.Enqueue(entry.Id);
                while (queue.Count > 0) {
                    var id = queue.Dequeue();
                    order.Add(id);
                    foreach (var child in adjacency[id].Where(x => bridges.Contains(Pair(id, x)) && !parent.ContainsKey(x))) {
                        parent[child] = id;
                        queue.Enqueue(child);
                    }
                }
                var flow = new Dictionary<long, double>();
                var complete = new Dictionary<long, bool>();
                foreach (var id in order) {
                    var p = parts[id];
                    complete[id] = true;
                    flow[id] = 0;
                    if (p.Node?.Kind == DuctNodeKind.Terminal) {
                        var demand = DuctNetwork.Fact(p.Node, DuctNetwork.TerminalFlow);
                        if (DuctPressurePhysics.Positive(demand)) flow[id] = demand!.Value;
                        else { complete[id] = false; Issue("unknown-demand", gid, id, "Terminal demand is missing, nonpositive or nonfinite; only other known demand is included."); }
                    }
                    if (adjacency[id].Any(x => parts[x].Node?.Kind != DuctNodeKind.Equipment && !bridges.Contains(Pair(id, x)))) {
                        complete[id] = false;
                        Issue("cycle-boundary", gid, id, "The unique subtree ends at a cycle; demand through that boundary is unknown.");
                    }
                    foreach (var c in p.Ports.Where(c => c.ConnectedTo == null && p.Node?.Kind != DuctNodeKind.Cap)) {
                        if (assumptions.OpenEnds.TryGetValue(new(id, c.Index), out var verdict)) {
                            Use($"open:{id}:{c.Index}", verdict);
                            if (verdict.Value != OpenEndVerdict.Connect) continue;
                        }
                        complete[id] = false;
                        Issue("unresolved-open-end", gid, id, $"Connector {c.Index} has unknown demand until capped, ignored or physically connected.");
                    }
                    if (issues.Any(i => i.ElementId == id && (i.Code == "missing-connector" || i.Code == "self-loop"))) complete[id] = false;
                }
                for (var i = order.Count - 1; i > 0; i--) {
                    var id = order[i];
                    flow[parent[id]] += flow[id];
                    complete[parent[id]] &= complete[id];
                }
                yield return new(entry.Root, gid, order, parent, flow, complete);
            }
        }

        private void Calculate(Walk walk) {
            var children = walk.Order.ToDictionary(x => x, _ => new List<long>());
            foreach (var id in walk.Order.Skip(1)) children[walk.Parent[id]].Add(id);
            var subtreeUsed = walk.Order.ToDictionary(x => x, x => parts[x].Ports
                .Where(p => assumptions.OpenEnds.ContainsKey(new(x, p.Index))).Select(p => $"open:{x}:{p.Index}").ToList());
            for (var i = walk.Order.Count - 1; i > 0; i--) subtreeUsed[walk.Parent[walk.Order[i]]].AddRange(subtreeUsed[walk.Order[i]]);
            var pathLoss = new Dictionary<long, double>();
            var pathLength = new Dictionary<long, double>();
            var pathComplete = new Dictionary<long, bool>();
            var pathUsed = new Dictionary<long, List<string>>();
            var componentLoss = new Dictionary<long, double?>();
            foreach (var id in walk.Order) {
                var parent = walk.Parent[id];
                if (parent == walk.Root) {
                    pathLoss[id] = pathLength[id] = 0;
                    pathComplete[id] = true;
                    pathUsed[id] = [];
                    componentLoss[id] = 0;
                }
                var p = parts[id];
                var dependencies = pathUsed[id];
                if (p.Node is { Kind: DuctNodeKind.Accessory or DuctNodeKind.Terminal } node)
                    componentLoss[id] += Component(node, dependencies, walk.Group);
                if (p.Node?.Kind == DuctNodeKind.Terminal) {
                    var path = new List<long> { id };
                    for (var previous = parent; previous != walk.Root; previous = walk.Parent[previous]) path.Add(previous);
                    path.Add(walk.Root);
                    path.Reverse();
                    terminals.Add(new(id, walk.Root, walk.Group, path, pathLoss[id], componentLoss[id],
                        pathLoss[id] + componentLoss[id], pathLength[id], pathComplete[id] && walk.Complete[id], dependencies.Distinct().ToList()));
                }
                var contributions = p.Segment is { } segment
                    ? Segment(segment, parent, children[id], walk, subtreeUsed[id])
                    : children[id].ToDictionary(x => x, x => p.Node?.Kind == DuctNodeKind.Fitting
                        ? Fitting(p.Node, parent, x, children[id], walk, subtreeUsed[id])
                        : new Contribution(0, 0, walk.Complete[id], subtreeUsed[id]));
                foreach (var child in children[id]) {
                    var contribution = contributions[child];
                    pathLoss[child] = pathLoss[id] + contribution.Loss;
                    pathLength[child] = pathLength[id] + contribution.Length;
                    pathComplete[child] = pathComplete[id] && contribution.Complete;
                    pathUsed[child] = dependencies.Concat(contribution.Used).Distinct().ToList();
                    componentLoss[child] = componentLoss[id];
                }
            }
        }

        private Dictionary<long, Contribution> Segment(DuctSegment segment, long parent, List<long> children, Walk walk, List<string> demandUsed) {
            var deps = new List<string>(demandUsed) {
                Use("air:density", assumptions.AirDensityKgPerM3), Use("air:viscosity", assumptions.AirViscosityPaS)
            };
            var complete = walk.Complete[segment.Id];
            var roughness = segment.Roughness.ValueFt;
            var multiplier = 1.0;
            if (segment.Kind == DuctSegmentKind.Flex) {
                if (segment.Type != null && assumptions.FlexRoughnessByType.TryGetValue(segment.Type, out var typeRoughness)) {
                    roughness = typeRoughness.Value;
                    deps.Add(Use($"flex:type:{segment.Type}", typeRoughness));
                } else {
                    roughness = assumptions.FlexRoughnessFt.Value;
                    deps.Add(Use("flex:roughness", assumptions.FlexRoughnessFt));
                }
                deps.Add(Use("flex:compression", assumptions.FlexCompression));
                if (assumptions.FlexCompression.Value != FlexCompression.FullyExtended) {
                    deps.Add(Use("flex:multiplier", assumptions.FlexPressureMultiplier));
                    if (assumptions.FlexPressureMultiplier.Value is { } m) multiplier = m;
                    else { complete = false; Issue("unknown-flex-compression", walk.Group, segment.Id, "Only fully extended friction is computable until a compression multiplier is supplied."); }
                }
            }
            var result = children.ToDictionary(x => x, _ => new Contribution(0, 0, false, deps));
            var shape = DuctPressurePhysics.Section(segment.Shape, segment.DiameterIn, segment.WidthIn, segment.HeightIn);
            if (shape == null || !DuctPressurePhysics.Nonnegative(segment.LengthFt) || !DuctPressurePhysics.Nonnegative(roughness) || roughness >= shape.Value.DiameterFt) {
                Issue("invalid-segment", walk.Group, segment.Id, "Cannot compute friction from these dimensions, length or roughness.");
                return result;
            }
            var positions = new Dictionary<long, double>();
            foreach (var neighbor in children.Concat(new[] { parent })) {
                var position = Position(segment, Port(segment.Id, neighbor));
                if (position == null) {
                    Issue("unknown-tap-position", walk.Group, segment.Id, "Connector location cannot be projected onto the segment polyline.");
                    return result;
                }
                positions[neighbor] = position.Value;
            }
            var entry = positions[parent];
            var cuts = positions.Values.Concat(new[] { 0.0, segment.LengthFt }).Distinct().OrderBy(x => x).ToList();
            var rows = new List<SegmentPressure>();
            for (var i = 1; i < cuts.Count; i++) {
                var lo = cuts[i - 1];
                var hi = cuts[i];
                if (hi <= lo) continue;
                var midpoint = (lo + hi) / 2;
                var outlets = children.Where(x => midpoint > Math.Min(entry, positions[x]) && midpoint < Math.Max(entry, positions[x])).ToList();
                var flow = outlets.Sum(x => walk.Flow[x]);
                var f = DuctPressurePhysics.Straight(segment.Shape, segment.DiameterIn, segment.WidthIn, segment.HeightIn,
                    hi - lo, flow, roughness, assumptions.AirDensityKgPerM3.Value, assumptions.AirViscosityPaS.Value);
                f = f with { PressureDropInWg = f.PressureDropInWg * multiplier, FrictionInWgPer100Ft = f.FrictionInWgPer100Ft * multiplier };
                if (segment.Shape != DuctShape.Round && f.ReynoldsNumber is > 0 and < 2300) {
                    deps.Add(Use("physics:noncircular-laminar", new Assumption<string>("64/Re with hydraulic diameter", AssumptionSource.Default,
                        Assumptions.Ashrae + " Noncircular Ducts: Dh is approximate in laminar flow; no exact noncircular Poiseuille solution is claimed")));
                    Issue("noncircular-laminar", walk.Group, segment.Id, "Hydraulic-diameter laminar approximation; no 1% accuracy claim.");
                }
                if (f.ReynoldsNumber is >= 2300 and < 4000) {
                    var id = "physics:transition";
                    deps.Add(Use(id, new Assumption<string>("linear interpolation 2300-4000", AssumptionSource.Default,
                        Assumptions.Ashrae + " transition is unstable; interpolation is a screening assumption, not a 1% accuracy claim")));
                    Issue("transitional-flow", walk.Group, segment.Id, "2300 <= Re < 4000: friction is an explicit transition interpolation.");
                }
                rows.Add(new(segment.Id, walk.Group, lo, hi, flow, f, complete && outlets.All(x => walk.Complete[x]), deps.Distinct().ToList()));
            }
            segments.AddRange(rows);
            foreach (var child in children) {
                var lo = Math.Min(entry, positions[child]);
                var hi = Math.Max(entry, positions[child]);
                var path = rows.Where(r => r.StartFt >= lo && r.EndFt <= hi).ToList();
                result[child] = new(path.Sum(r => r.Friction.PressureDropInWg), hi - lo,
                    complete && path.All(r => r.IsComplete), deps.Distinct().ToList());
            }
            return result;
        }

        private static double? Position(DuctSegment segment, DuctConnector port) {
            if (segment.LengthFt == 0) return 0;
            if (port.Point.Length != 3 || port.Point.Any(x => double.IsNaN(x) || double.IsInfinity(x))) return null;
            double traveled = 0, nearest = double.PositiveInfinity, position = 0;
            for (var i = 1; i < segment.Polyline.Count; i++) {
                var a = segment.Polyline[i - 1];
                var b = segment.Polyline[i];
                if (a.Length != 3 || b.Length != 3 || a.Concat(b).Any(x => double.IsNaN(x) || double.IsInfinity(x))) return null;
                var delta = b.Zip(a, (x, y) => x - y).ToArray();
                var length2 = delta.Sum(x => x * x);
                if (length2 == 0) continue;
                var t = Math.Max(0, Math.Min(1, port.Point.Zip(a, (x, y) => x - y).Zip(delta, (x, y) => x * y).Sum() / length2));
                var distance = Enumerable.Range(0, 3).Sum(j => Math.Pow(port.Point[j] - a[j] - t * delta[j], 2));
                if (distance < nearest) { nearest = distance; position = traveled + t * Math.Sqrt(length2); }
                traveled += Math.Sqrt(length2);
            }
            // Snapshot rounds points to .001 ft. Reject distant connectors instead of inventing a tap position.
            if (traveled > 0 && nearest <= 0.01 * 0.01) return position / traveled * segment.LengthFt;
            if (segment.Connectors.Count == 2 && segment.Connectors.All(c => c.Kind == "end"))
                return port.Index == segment.Connectors[0].Index ? 0 : segment.LengthFt;
            return null;
        }

        private Contribution Fitting(DuctNode node, long parent, long child, List<long> children, Walk walk, List<string> demandUsed) {
            var deps = new List<string>(demandUsed) {
                Use("air:density", assumptions.AirDensityKgPerM3), Use("air:viscosity", assumptions.AirViscosityPaS)
            };
            var inlet = Port(node.Id, parent);
            var outlet = Port(node.Id, child);
            var common = DuctPressurePhysics.Section(inlet.Shape, inlet.DiameterIn, inlet.WidthIn, inlet.HeightIn);
            var local = DuctPressurePhysics.Section(outlet.Shape, outlet.DiameterIn, outlet.WidthIn, outlet.HeightIn);
            if (common == null || local == null) {
                Issue("invalid-fitting-size", walk.Group, node.Id, "Fitting reference area is missing.");
                return new(0, 0, false, deps);
            }
            var kind = Enum.TryParse<PressurePartType>(node.PartType, true, out var parsed) ? parsed : PressurePartType.Other;
            var path = FittingPath.Bend;
            var flowRatio = walk.Flow[node.Id] > 0 ? walk.Flow[child] / walk.Flow[node.Id] : 0;
            var areaRatio = local.Value.AreaFt2 / common.Value.AreaFt2;
            double? angle = DuctNetwork.Fact(node, "angle");
            double? radius = DuctNetwork.Fact(node, "radiusOverDiameter");
            var construction = FittingConstruction.Unknown;
            if (assumptions.FittingGeometry.TryGetValue(node.Id, out var geometry)) {
                deps.Add(Use($"geometry:{node.Id}", geometry));
                angle = geometry.Value.AngleDegrees;
                radius = geometry.Value.RadiusOverDiameter;
                construction = geometry.Value.Construction;
            }
            var otherAreaRatio = 1.0;
            if (children.Count > 1) {
                var turns = children.Select(x => (Id: x, Angle: Turn(inlet.Point, Port(node.Id, x).Point, node.Point))).ToList();
                var straight = turns.Where(x => x.Angle.HasValue).OrderBy(x => x.Angle).FirstOrDefault();
                if (straight.Angle is <= 5 && turns.Count(x => x.Angle is <= 5) == 1) {
                    path = child == straight.Id ? FittingPath.Straight : FittingPath.Branch;
                    var branch = children.FirstOrDefault(x => x != straight.Id);
                    var branchPort = Port(node.Id, branch);
                    var branchSection = DuctPressurePhysics.Section(branchPort.Shape, branchPort.DiameterIn, branchPort.WidthIn, branchPort.HeightIn);
                    var straightPort = Port(node.Id, straight.Id);
                    var straightSection = DuctPressurePhysics.Section(straightPort.Shape, straightPort.DiameterIn, straightPort.WidthIn, straightPort.HeightIn);
                    otherAreaRatio = straightSection?.AreaFt2 / common.Value.AreaFt2 ?? 0;
                    areaRatio = branchSection?.AreaFt2 / common.Value.AreaFt2 ?? 0;
                    flowRatio = walk.Flow[node.Id] > 0 ? walk.Flow[branch] / walk.Flow[node.Id] : 0;
                    angle ??= turns.First(x => x.Id == branch).Angle;
                } else path = FittingPath.Branch;
            }
            var converging = IsConverging(walk);
            var row = "assumed-one-velocity-head";
            var c = assumptions.UnmatchedFittingCoefficient.Value;
            var localFlow = walk.Flow[child];
            var selected = false;
            if (assumptions.FittingCoefficients.TryGetValue(new(node.Id, outlet.Index), out var supplied)) {
                c = supplied.Value;
                row = "user-coefficient";
                deps.Add(Use($"coefficient:{node.Id}:{outlet.Index}", supplied));
                selected = true;
            } else if (inlet.Shape == DuctShape.Round && outlet.Shape == DuctShape.Round &&
                DuctCoefficientTable.Lookup(kind, path, angle, radius, areaRatio, otherAreaRatio, flowRatio, converging, children.Count, construction) is { } match) {
                row = match.Id;
                var referenceFlow = match.CommonVelocity ? walk.Flow[node.Id] : localFlow;
                var referenceArea = match.CommonVelocity ? common.Value.AreaFt2 : local.Value.AreaFt2;
                var referenceVelocity = referenceFlow / referenceArea;
                var localVelocity = localFlow / local.Value.AreaFt2;
                // Conversion retains the ASHRAE common-velocity table while the result's C always names its local outlet.
                if (localVelocity > 0) {
                    c = match.Coefficient * Math.Pow(referenceVelocity / localVelocity, 2);
                    deps.Add(Use($"table:{node.Id}:{outlet.Index}", new Assumption<double>(c, AssumptionSource.Default, match.Source)));
                    selected = true;
                }
            }
            if (!selected) {
                deps.Add(Use("fitting:unmatched", assumptions.UnmatchedFittingCoefficient));
                Issue("unmatched-fitting", walk.Group, node.Id,
                    $"{node.PartType ?? "unknown"} {path}: no sourced row matches shape, direction, angle, r/D and area/flow ratios. Using explicit local C={c} screening assumption.");
            }
            var roughness = parts[child].Segment?.Roughness.ValueFt ?? 0.0003;
            if (!DuctPressurePhysics.Nonnegative(roughness) || roughness >= local.Value.DiameterFt) roughness = 0.0003;
            deps.Add(Use($"equivalent-length:{node.Id}:{outlet.Index}", new Assumption<double>(roughness, AssumptionSource.Default,
                Assumptions.Ashrae + " EL=C*Dh/f at the outlet design flow; adjacent rigid roughness or 0.0003 ft galvanized reference")));
            var friction = DuctPressurePhysics.Straight(outlet.Shape, outlet.DiameterIn, outlet.WidthIn, outlet.HeightIn,
                0, localFlow, roughness, assumptions.AirDensityKgPerM3.Value, assumptions.AirViscosityPaS.Value);
            var dp = c * friction.VelocityPressureInWg;
            var el = friction.FrictionFactor > 0 ? c * friction.HydraulicDiameterFt / friction.FrictionFactor : 0;
            fittings.Add(new(node.Id, outlet.Index, walk.Group, path, flowRatio, areaRatio, c, dp, el, row, walk.Complete[node.Id], deps.Distinct().ToList()));
            return new(dp, el, walk.Complete[node.Id], deps);
        }

        private bool IsConverging(Walk walk) {
            var rootPort = Port(walk.Root, walk.Order[0]);
            var classification = rootPort.Classification ?? network.Groups.First(g => g.Id == walk.Group).Classifications.FirstOrDefault() ?? "";
            return classification.IndexOf("Return", StringComparison.OrdinalIgnoreCase) >= 0 || classification.IndexOf("Exhaust", StringComparison.OrdinalIgnoreCase) >= 0;
        }

        private static double? Turn(double[] inlet, double[] outlet, double[] center) {
            if (inlet.Length != 3 || outlet.Length != 3 || center.Length != 3) return null;
            var a = center.Zip(inlet, (x, y) => x - y).ToArray();
            var b = outlet.Zip(center, (x, y) => x - y).ToArray();
            var scale = Math.Sqrt(a.Sum(x => x * x) * b.Sum(x => x * x));
            return scale > 0 ? Math.Acos(Math.Max(-1, Math.Min(1, a.Zip(b, (x, y) => x * y).Sum() / scale))) * 180 / Math.PI : null;
        }

        private double? Component(DuctNode node, List<string> dependencies, string group) {
            if (assumptions.ComponentDropByElement.TryGetValue(node.Id, out var element)) {
                dependencies.Add(Use($"component:element:{node.Id}", element)); return element.Value;
            }
            if (node.Family != null && assumptions.ComponentDropByFamily.TryGetValue(node.Family, out var family)) {
                dependencies.Add(Use($"component:family:{node.Family}", family)); return family.Value;
            }
            if (DuctNetwork.Fact(node, DuctNetwork.PressureDrop) is > 0 and var observed && DuctPressurePhysics.Positive(observed)) return observed;
            dependencies.Add(Use("component:default", assumptions.DefaultComponentDrop));
            if (assumptions.DefaultComponentDrop.Value == null) Issue("unknown-component-drop", group, node.Id, "Rated external component loss at design flow is absent.");
            return assumptions.DefaultComponentDrop.Value;
        }

        private List<GroupPressure> Budgets() {
            var results = new List<GroupPressure>();
            foreach (var group in network.Groups) {
                var paths = terminals.Where(t => t.GroupId == group.Id).ToList();
                var includesComponents = paths.Count > 0 && paths.All(p => p.ComponentLossInWg.HasValue);
                var critical = paths.OrderByDescending(p => includesComponents ? p.TotalLossInWg : p.DuctLossInWg).ThenBy(p => p.TerminalId).FirstOrDefault();
                if (critical == null) Issue("no-terminal-path", group.Id, null, "No terminal has a unique equipment-root path in this group.");
                var dependencies = paths.SelectMany(p => p.AssumptionsUsed).Distinct().ToList();
                var walkable = paths.Count > 0 && paths.Count == group.TerminalCount && paths.All(p => p.IsComplete)
                    && group.Loops == 0 && group.RootIds.Count == 1
                    && !issues.Any(i => i.GroupId == group.Id && i.Code is "unresolved-open-end" or "multiple-root-ports" or "missing-connector" or "self-loop")
                    && group.Classifications.Count <= 1;
                double? tel = null, asp = null, rate = null, margin = null;
                double? pathEl = paths.Count > 0 ? paths.Max(p => p.EffectiveLengthFt) : null;
                if (group.Classifications.Count > 1) Issue("mixed-classification", group.Id, null, "A mixed-classification group cannot define one fan circuit.");
                if (group.RootIds.Count == 1 && critical != null) {
                    var root = parts[group.RootIds[0]].Node!;
                    double? fan;
                    if (assumptions.FanExternalStatic.TryGetValue(root.Id, out var stated)) {
                        dependencies.Add(Use($"fan:{root.Id}", stated)); fan = stated.Value;
                    } else if (DuctNetwork.Fact(root, DuctNetwork.ExternalStatic) is > 0 and var observed && DuctPressurePhysics.Positive(observed)) fan = observed;
                    else {
                        dependencies.Add(Use("fan:default", assumptions.DefaultFanExternalStatic)); fan = assumptions.DefaultFanExternalStatic.Value;
                        if (fan == null) Issue("unknown-fan-static", group.Id, root.Id, "Fan external static at design flow is absent.");
                    }
                    var cls = group.Classifications.Count == 1 ? group.Classifications[0] : "";
                    var supply = cls.IndexOf("Supply", StringComparison.OrdinalIgnoreCase) >= 0;
                    var ret = cls.IndexOf("Return", StringComparison.OrdinalIgnoreCase) >= 0;
                    var exhaust = cls.IndexOf("Exhaust", StringComparison.OrdinalIgnoreCase) >= 0;
                    var peers = network.Groups.Where(g => g.Id != group.Id && g.RootIds.Count == 1 && g.RootIds[0] == root.Id).ToList();
                    var complement = peers.Where(g => g.Classifications.Count == 1 && g.Classifications[0].IndexOf(supply ? "Return" : "Supply", StringComparison.OrdinalIgnoreCase) >= 0).ToList();
                    var circuitPaths = new List<List<TerminalPressure>> { paths };
                    var circuitComplete = walkable;
                    if (supply || ret) {
                        if (complement.Count == 1 && !peers.Any(g => g.Classifications.SequenceEqual(group.Classifications))) {
                            var other = complement[0];
                            var otherPaths = terminals.Where(t => t.GroupId == other.Id).ToList();
                            circuitPaths.Add(otherPaths);
                            circuitComplete &= otherPaths.Count > 0 && otherPaths.Count == other.TerminalCount && otherPaths.All(t => t.IsComplete) && other.Loops == 0
                                && !issues.Any(i => i.GroupId == other.Id && i.Code is "unresolved-open-end" or "multiple-root-ports" or "missing-connector" or "self-loop");
                            dependencies.AddRange(otherPaths.SelectMany(p => p.AssumptionsUsed));
                        } else circuitComplete = false;
                    } else if (!exhaust || peers.Any(g => g.Classifications.SequenceEqual(group.Classifications))) circuitComplete = false;
                    if (!circuitComplete) Issue("incomplete-circuit", group.Id, root.Id, "Full TEL and fan margin need unambiguous, complete supply plus return paths, or one exhaust group.");
                    if (circuitComplete) {
                        tel = circuitPaths.Sum(side => side.Max(p => p.EffectiveLengthFt));
                        // A root-level entry represents additional external components absent from the graph, not fan internal losses.
                        var rootDrop = Component(root, dependencies, group.Id);
                        if (circuitPaths.All(side => side.All(p => p.ComponentLossInWg.HasValue))) {
                            asp = fan - rootDrop - circuitPaths.Sum(side => side.Max(p => p.ComponentLossInWg!.Value));
                            margin = fan - rootDrop - circuitPaths.Sum(side => side.Max(p => p.TotalLossInWg!.Value));
                            rate = tel > 0 ? asp * 100 / tel : null;
                        }
                    }
                }
                results.Add(new(group.Id, walkable, critical, includesComponents, pathEl, tel, asp, rate, margin, dependencies.Distinct().ToList()));
            }
            return results;
        }
    }
}
