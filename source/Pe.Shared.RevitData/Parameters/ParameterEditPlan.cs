namespace Pe.Shared.RevitData;

/// <summary>
///     The one place parameter-write evidence is judged. Edits arrive in groups that are admitted whole (a
///     parameter edit is a group of one; a schedule cell is a group of its targets). Per edit: required evidence
///     needs Expected, and a given Expected must equal Current. A refused edit refuses its group. Surviving groups joined by a
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

    /// <param name="Refusals">Per edit: why it will not be written, or null when a <see cref="Write" /> answers it.</param>
    /// <param name="Writes">One per native target, in order of first edit.</param>
    public sealed record Plan(IReadOnlyList<string?> Refusals, IReadOnlyList<Write> Writes);

    public const string Stale = "Expected target evidence is stale.";
    public const string MissingExpected =
        "A wet run needs expected target evidence per edit; read it as Current with a dry run first.";
    public const string GroupRefused = "Another edit in this admission group was refused; nothing in the group was written.";
    public const string AliasConflict =
        "Conflicting edits alias the same native parameter; nothing in the connected alias group was written.";

    public static Plan Build(IReadOnlyList<Edit> edits, Evidence evidence) {
        var refusals = edits.Select(edit => edit.Refusal ?? Judge(edit, evidence)).ToArray();

        foreach (var group in Enumerable.Range(0, edits.Count).GroupBy(index => edits[index].Group)) {
            if (group.All(index => refusals[index] == null)) continue;
            foreach (var index in group) refusals[index] ??= GroupRefused;
        }

        // Connected alias groups: union admission groups that share a native target.
        var live = Enumerable.Range(0, edits.Count).Where(index => refusals[index] == null).ToList();
        var components = new UnionFind();
        foreach (var byTarget in live.GroupBy(index => Key(edits[index].Current!)))
            foreach (var index in byTarget.Skip(1))
                components.Union(edits[index].Group, edits[byTarget.First()].Group);
        foreach (var component in live.GroupBy(index => components.Find(edits[index].Group))) {
            if (component.Select(index => Payload(edits[index].Value)).Distinct().Count() <= 1) continue;
            foreach (var index in component) refusals[index] = AliasConflict;
        }

        var writes = Enumerable.Range(0, edits.Count).Where(index => refusals[index] == null)
            .GroupBy(index => Key(edits[index].Current!))
            .Select(byTarget => new Write(byTarget.First(), byTarget.ToList()))
            .ToList();
        return new Plan(refusals, writes);
    }

    private static string? Judge(Edit edit, Evidence evidence) {
        if (edit.Current == null) return "Target did not resolve.";
        if (edit.Value.Expected is not { } expected) return evidence == Evidence.IfGiven ? null : MissingExpected;
        return expected == edit.Current ? null : Stale;
    }

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
