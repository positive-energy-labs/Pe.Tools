using System.Runtime.Serialization;
using Newtonsoft.Json;
using Newtonsoft.Json.Converters;

namespace Pe.Shared.RevitData;

/// <summary>The closed set of reasons <see cref="ParameterEditPlan" /> refuses an edit; the prose stays the refusal's message.</summary>
[JsonConverter(typeof(StringEnumConverter))]
public enum EditRefusalCode {
    /// <summary>A given Expected differs from the fresh read.</summary>
    [EnumMember(Value = "target-evidence-stale")] TargetEvidenceStale,
    /// <summary>A wet run edit carries no Expected.</summary>
    [EnumMember(Value = "target-evidence-missing")] TargetEvidenceMissing,
    /// <summary>The edit's element or parameter did not resolve (every resolver refusal).</summary>
    [EnumMember(Value = "target-unresolved")] TargetUnresolved,
    /// <summary>Another edit of the admission group was refused; <see cref="ParameterEditPlan.Refusal.Cause" /> names its code.</summary>
    [EnumMember(Value = "admission-group-refused")] AdmissionGroupRefused,
    /// <summary>Differing values alias one native parameter across a connected alias group.</summary>
    [EnumMember(Value = "alias-conflict")] AliasConflict
}

/// <summary>
///     The one place parameter-write evidence is judged. Edits arrive in groups that are admitted whole (a
///     parameter edit is a group of one; a schedule cell is a group of its targets). Per edit: required evidence
///     needs Expected, and a given Expected must equal Current. A refused edit refuses its group, and every sibling names
///     that cause (which target, what moved) so the person on any member sees why. Surviving groups joined by a
///     shared native target form one connected alias group: differing values refuse all of it, identical values
///     coalesce to one write per target.
/// </summary>
public static class ParameterEditPlan {
    /// <summary>Whether every edit must carry Expected. A given Expected is checked either way.</summary>
    public enum Evidence {
        /// <summary>Wet host writes (<c>revit.apply.parameter-values</c>, <c>schedule.cells.apply</c>).</summary>
        Required,
        /// <summary>Dry runs, which read the evidence, and the in-process script door, which writes without it.</summary>
        IfGiven
    }

    /// <param name="Group">Admission unit; every edit of a group writes or none does.</param>
    /// <param name="Value">The edit, with its Expected evidence.</param>
    /// <param name="Current">Fresh evidence for the resolved target; null when it did not resolve.</param>
    /// <param name="Refusal">Resolution failure, when there is one.</param>
    public sealed record Edit(int Group, ParameterValueEdit Value, ParameterTarget? Current, string? Refusal = null);

    /// <summary>One native target write.</summary>
    /// <param name="Edit">The edit whose value is written (the first by index; all of <see cref="Edits" /> agree).</param>
    /// <param name="Edits">Every edit this write answers, ascending.</param>
    public sealed record Write(int Edit, IReadOnlyList<int> Edits);

    /// <summary>Why one edit is not written: a closed code, its prose, and for a group refusal the code of the cause its prose names.</summary>
    public sealed record Refusal(EditRefusalCode Code, string Message, EditRefusalCode? Cause = null);

    /// <param name="Refusals">Per edit: why it will not be written, or null when a <see cref="Write" /> answers it.</param>
    /// <param name="Writes">One per native target, in order of first edit.</param>
    public sealed record Plan(IReadOnlyList<Refusal?> Refusals, IReadOnlyList<Write> Writes);

    public const string MissingExpected =
        "A wet run needs expected target evidence per edit; read it as Current with a dry run first.";
    public const string GroupRefused = "Nothing in this admission group was written: ";
    public const string AliasConflict =
        "Conflicting edits alias the same native parameter; nothing in the connected alias group was written.";

    public static Plan Build(IReadOnlyList<Edit> edits, Evidence evidence) {
        // A resolver refusal is an unresolved target, whatever it names.
        var refusals = edits.Select(edit => edit.Refusal is { } resolver ? new Refusal(EditRefusalCode.TargetUnresolved, resolver) : Judge(edit, evidence)).ToArray();

        foreach (var group in Enumerable.Range(0, edits.Count).GroupBy(index => edits[index].Group)) {
            // Ordinal-first cause keeps the answer independent of input order.
            var causes = group.Select(index => refusals[index]).OfType<Refusal>().OrderBy(cause => cause.Message, StringComparer.Ordinal).ToList();
            if (causes.Count == 0) continue;
            var sibling = new Refusal(EditRefusalCode.AdmissionGroupRefused,
                GroupRefused + causes[0].Message + (causes.Count > 1 ? $" (+{causes.Count - 1} more refused)" : ""), causes[0].Code);
            foreach (var index in group) refusals[index] ??= sibling;
        }

        // Connected alias groups: union admission groups that share a native target.
        var live = Enumerable.Range(0, edits.Count).Where(index => refusals[index] == null).ToList();
        var components = new UnionFind();
        foreach (var byTarget in live.GroupBy(index => Key(edits[index].Current!)))
            foreach (var index in byTarget.Skip(1))
                components.Union(edits[index].Group, edits[byTarget.First()].Group);
        foreach (var component in live.GroupBy(index => components.Find(edits[index].Group))) {
            if (component.Select(index => Payload(edits[index].Value)).Distinct().Count() <= 1) continue;
            foreach (var index in component) refusals[index] = new Refusal(EditRefusalCode.AliasConflict, AliasConflict);
        }

        var writes = Enumerable.Range(0, edits.Count).Where(index => refusals[index] == null)
            .GroupBy(index => Key(edits[index].Current!))
            .Select(byTarget => new Write(byTarget.First(), byTarget.ToList()))
            .ToList();
        return new Plan(refusals, writes);
    }

    private static Refusal? Judge(Edit edit, Evidence evidence) {
        if (edit.Current == null) return new Refusal(EditRefusalCode.TargetUnresolved, $"Target element {edit.Value.ElementId} did not resolve.");
        if (edit.Value.Expected is not { } expected) return evidence == Evidence.IfGiven ? null : new Refusal(EditRefusalCode.TargetEvidenceMissing, MissingExpected);
        return expected == edit.Current ? null : new Refusal(EditRefusalCode.TargetEvidenceStale, Stale(expected, edit.Current));
    }

    /// <summary>Stale evidence names its target and each field that moved since review, expected then now.</summary>
    public static string Stale(ParameterTarget expected, ParameterTarget current) {
        var moved = new List<string>();
        void Check<T>(string field, T was, T now) {
            if (!EqualityComparer<T>.Default.Equals(was, now)) moved.Add($"{field} expected {Show(was)}, now {Show(now)}");
        }
        Check("elementId", expected.ElementId, current.ElementId);
        Check("parameterId", expected.ParameterId, current.ParameterId);
        Check("parameterName", expected.ParameterName, current.ParameterName);
        Check("storageType", expected.StorageType, current.StorageType);
        Check("isReadOnly", expected.IsReadOnly, current.IsReadOnly);
        Check("hasValue", expected.HasValue, current.HasValue);
        Check("value", expected.RawValue, current.RawValue);
        return $"Expected target evidence is stale: element {current.ElementId} '{current.ParameterName ?? current.ParameterId.ToString()}' " +
               $"changed since review ({string.Join("; ", moved)}).";
    }

    private static string Show<T>(T value) => value switch { null => "null", string text => $"'{text}'", _ => value.ToString()! };

    private static (long, long) Key(ParameterTarget target) => (target.ElementId, target.ParameterId);

    private static (string?, string?, bool) Payload(ParameterValueEdit edit) => (edit.Value, edit.Unit, edit.RawInternal);

    private sealed class UnionFind {
        private readonly Dictionary<int, int> parent = [];

        public int Find(int group) {
            if (!this.parent.TryGetValue(group, out var up) || up == group) return group;
            return this.parent[group] = this.Find(up);
        }

        public void Union(int a, int b) => this.parent[this.Find(a)] = this.Find(b);
    }
}
