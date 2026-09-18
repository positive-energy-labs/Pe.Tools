namespace Pe.Shared.RevitData;

/// <summary>
///     The one place parameter-write evidence is judged. Edits arrive in groups that are admitted whole (a
///     parameter edit is a group of one; a schedule cell is a group of its targets). Per edit: a wet run needs
///     Expected, and Expected must equal Current. A refused edit refuses its group. Surviving groups joined by a
///     shared native target form one connected alias group: differing values refuse all of it, identical values
///     coalesce to one write per target.
/// </summary>
public static class ParameterEditPlan {
    /// <param name="Group">Admission unit; every edit of a group writes or none does.</param>
    /// <param name="Value">The edit, with its Expected evidence.</param>
    /// <param name="Current">Fresh evidence for the resolved target; null when it did not resolve.</param>
    /// <param name="Refusal">Resolution failure, when there is one.</param>
    public sealed record Edit(int Group, ParameterValueEdit Value, ParameterTarget? Current, string? Refusal = null);

    /// <param name="Refusals">Per edit: why it will not be written, or null.</param>
    /// <param name="Writes">One representative edit index per native target write.</param>
    /// <param name="WriteOf">Per edit: its index into <see cref="Writes" />, or -1 when refused.</param>
    public sealed record Plan(IReadOnlyList<string?> Refusals, IReadOnlyList<int> Writes, IReadOnlyList<int> WriteOf);

    public const string Stale = "Expected target evidence is stale.";
    public const string MissingExpected =
        "A wet run needs expected target evidence per edit; read it as Current with a dry run first.";
    public const string GroupRefused = "Another edit in this admission group was refused; nothing in the group was written.";
    public const string AliasConflict =
        "Conflicting edits alias the same native parameter; nothing in the connected alias group was written.";

    public static Plan Build(IReadOnlyList<Edit> edits, bool dryRun) {
        var refusals = edits.Select(edit => edit.Refusal ?? Judge(edit, dryRun)).ToArray();

        foreach (var group in edits.Select((edit, index) => (edit.Group, index)).GroupBy(item => item.Group)) {
            if (group.All(item => refusals[item.index] == null)) continue;
            foreach (var (_, index) in group) refusals[index] ??= GroupRefused;
        }

        // Connected alias groups: union admission groups that share a native target.
        var root = edits.Select(edit => edit.Group).Distinct().ToDictionary(group => group, group => group);
        int Find(int group) => root[group] == group ? group : root[group] = Find(root[group]);
        var live = Enumerable.Range(0, edits.Count).Where(index => refusals[index] == null).ToList();
        foreach (var byTarget in live.GroupBy(index => Key(edits[index].Current!)))
            foreach (var index in byTarget.Skip(1))
                root[Find(edits[index].Group)] = Find(edits[byTarget.First()].Group);
        foreach (var component in live.GroupBy(index => Find(edits[index].Group))) {
            if (component.Select(index => Payload(edits[index].Value)).Distinct().Count() <= 1) continue;
            foreach (var index in component) refusals[index] = AliasConflict;
        }

        var writes = new List<int>();
        var writeOf = Enumerable.Repeat(-1, edits.Count).ToArray();
        foreach (var byTarget in Enumerable.Range(0, edits.Count).Where(index => refusals[index] == null)
                     .GroupBy(index => Key(edits[index].Current!))) {
            foreach (var index in byTarget) writeOf[index] = writes.Count;
            writes.Add(byTarget.First());
        }
        return new Plan(refusals, writes, writeOf);
    }

    private static string? Judge(Edit edit, bool dryRun) {
        if (edit.Current == null) return "Target did not resolve.";
        if (edit.Value.Expected is not { } expected) return dryRun ? null : MissingExpected;
        return expected == edit.Current ? null : Stale;
    }

    private static (long, long) Key(ParameterTarget target) => (target.ElementId, target.ParameterId);

    private static (string?, string?, bool) Payload(ParameterValueEdit edit) => (edit.Value, edit.Unit, edit.RawInternal);
}
