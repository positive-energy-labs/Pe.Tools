using System.Globalization;
using System.Runtime.Serialization;
using Newtonsoft.Json;
using Newtonsoft.Json.Converters;

namespace Pe.Shared.RevitData.Ducts;

/// <summary>The one optional ducts.snapshot argument. Omit it to solve with defaults.</summary>
public sealed record DuctSnapshotRequest(DuctStagedAssumptions? Assumptions = null);

/// <summary>
/// Exact staged Work values, not proposal cells or the whole trichotomy document. Revision is the Work revision
/// captured with these values; the pressure result echoes it so callers can fence stale results.
/// </summary>
public sealed record DuctStagedAssumptions(
    [property: JsonRequired] long Revision,
    [property: JsonRequired] IReadOnlyDictionary<string, DuctWorkAssumption> Values);

/// <summary>The existing ducts Work value kinds. Each kind requires its matching unit field or verdict.</summary>
[JsonConverter(typeof(StringEnumConverter))]
public enum DuctAssumptionKind {
    [EnumMember(Value = "verdict")] Verdict,
    [EnumMember(Value = "fan-static")] FanStatic,
    [EnumMember(Value = "component-drop")] ComponentDrop,
    [EnumMember(Value = "flex-roughness")] FlexRoughness
}

/// <summary>
/// A staged value in the existing Work grammar. FanStatic/ComponentDrop require only InWg (finite, nonnegative),
/// FlexRoughness requires only Ft (finite, positive), Verdict requires only capped/connect/ignore.
/// </summary>
public sealed record DuctWorkAssumption([property: JsonRequired] DuctAssumptionKind Kind,
    double? InWg = null, double? Ft = null, OpenEndVerdict? Verdict = null);

/// <summary>Pure adapter from staged Work keys to the single C# solver. It never changes captured topology.</summary>
public static class DuctPressureAssessment {
    /// <summary>Retain the captured snapshot and attach a solve of that graph and the supplied staged values.</summary>
    public static DuctSnapshotData Assess(DuctSnapshotData snapshot, DuctStagedAssumptions? staged = null) =>
        snapshot with {
            Pressure = DuctPressureSolver.Solve(snapshot, Map(snapshot, staged)) with { AssumptionRevision = staged?.Revision }
        };

    /// <summary>Validate keys against this capture and map only supported staged judgments to solver inputs.</summary>
    private static Assumptions Map(DuctSnapshotData snapshot, DuctStagedAssumptions? staged) {
        if (staged is null) return new();
        if (staged.Revision < 0 || staged.Values is null)
            throw new ArgumentException("Assumptions require a nonnegative revision and staged values.");
        var fans = new Dictionary<long, Assumption<double>>();
        var components = new Dictionary<string, Assumption<double>>(StringComparer.Ordinal);
        var flex = new Dictionary<string, Assumption<double>>(StringComparer.Ordinal);
        var ends = new Dictionary<PressurePort, Assumption<OpenEndVerdict>>();
        var issues = snapshot.Issues.ToDictionary(i => i.Id, StringComparer.Ordinal);
        foreach (var entry in staged.Values) {
            var key = entry.Key;
            var value = entry.Value;
            var split = key.IndexOf(':');
            if (value is null || split <= 0 || split == key.Length - 1) throw Invalid(key);
            var prefix = key.Substring(0, split);
            var subject = key.Substring(split + 1);
            Assumption<T> User<T>(T v) => new(v, AssumptionSource.User, $"Staged Work revision {staged.Revision}: {key}");
            switch (value.Kind) {
                case DuctAssumptionKind.FanStatic:
                    if (prefix != "fan-static" || !Pressure(value) ||
                        !long.TryParse(subject, NumberStyles.None, CultureInfo.InvariantCulture, out var id) ||
                        subject != id.ToString(CultureInfo.InvariantCulture) ||
                        !snapshot.Nodes.Any(n => n.Id == id && n.Kind == DuctNodeKind.Equipment)) throw Invalid(key);
                    fans.Add(id, User(value.InWg!.Value));
                    break;
                case DuctAssumptionKind.ComponentDrop:
                    if (prefix != "component-drop" || !Pressure(value) || !snapshot.Nodes.Any(n => n.Family == subject)) throw Invalid(key);
                    components.Add(subject, User(value.InWg!.Value));
                    break;
                case DuctAssumptionKind.FlexRoughness:
                    if (prefix != "flex-roughness" || value.InWg is not null || value.Verdict is not null ||
                        !DuctPressurePhysics.Positive(value.Ft) ||
                        !snapshot.Segments.Any(s => s.Kind == DuctSegmentKind.Flex && s.Type == subject)) throw Invalid(key);
                    flex.Add(subject, User(value.Ft!.Value));
                    break;
                case DuctAssumptionKind.Verdict:
                    if (value.InWg is not null || value.Ft is not null || !issues.TryGetValue(key, out var issue)) throw Invalid(key);
                    if (value.Verdict is not { } verdict || !Enum.IsDefined(typeof(OpenEndVerdict), verdict)) throw Invalid(key);
                    // Advisory judgments stay in Work. They cannot invent demand, roots, or a changed graph.
                    if (issue.Kind != DuctIssueKind.OpenEnd) break;
                    var connectorText = key.Substring(key.LastIndexOf(':') + 1);
                    if (issue.ElementId is not { } elementId ||
                        !int.TryParse(connectorText, NumberStyles.None, CultureInfo.InvariantCulture, out var connector) ||
                        key != $"open-end:{issue.GroupId}:{elementId}:{connector}") throw Invalid(key);
                    var ports = snapshot.Nodes.FirstOrDefault(n => n.Id == elementId)?.Connectors
                        ?? snapshot.Segments.FirstOrDefault(s => s.Id == elementId)?.Connectors;
                    if (ports?.Any(p => p.Index == connector && p.ConnectedTo is null) != true) throw Invalid(key);
                    ends.Add(new(elementId, connector), User(verdict));
                    break;
                default: throw Invalid(key);
            }
        }
        return new() { FanExternalStatic = fans, ComponentDropByFamily = components, FlexRoughnessByType = flex, OpenEnds = ends };
    }

    private static bool Pressure(DuctWorkAssumption value) =>
        value.InWg is { } pressure && DuctPressurePhysics.Nonnegative(pressure) && value.Ft is null && value.Verdict is null;

    private static ArgumentException Invalid(string key) => new($"Invalid or stale staged duct assumption '{key}': use an exact captured Work key and its matching value kind/unit.");
}
