namespace Pe.Shared.RevitData.Families;

/// <summary>
///     Capture writes only what apply can build. Where the document holds a fact the executable model
///     cannot express, the fact leaves the member and becomes an unmodeled fact in the capture's run —
///     it never stays behind as a member its own validator refuses (w5-revit defect 2).
///     Pure over <see cref="FamilyModel" />, so the deterministic lane proves the rule without Revit.
/// </summary>
public static class FamilyModelPrune {
    /// <summary>
    ///     A reference line's start is where `on` crosses the two planes in `from` (`MakeRefLines`); with any
    ///     other count there is no point and the engine cannot build the line. Capture reads `from` from the
    ///     alignments on the line's start, and a real family often locks that start to one plane or none.
    ///     Drops such a line and every dimension and nested host that names it, and returns the facts.
    /// </summary>
    public static List<FamilyModelUnmodeledFact> RefLinesWithoutTwoPlanes(FamilyModel model) {
        var facts = new List<FamilyModelUnmodeledFact>();
        var dropped = new HashSet<string>(StringComparer.Ordinal);
        foreach (var (name, line) in model.RefLines.Where(entry => entry.Value.From.Count != 2).ToList()) {
            facts.Add(Fact($"$.refLines.{name}.from", ("on", line.On), ("planes", string.Join(", ", line.From))));
            _ = model.RefLines.Remove(name);
            _ = dropped.Add(name);
        }
        if (dropped.Count == 0) return facts;
        foreach (var (slug, dim) in model.Dimensions.Where(entry => entry.Value.Between.Any(dropped.Contains)).ToList()) {
            facts.Add(Fact($"$.dimensions.{slug}.between", ("references", string.Join(", ", dim.Between))));
            _ = model.Dimensions.Remove(slug);
        }
        // A host is `line:<key>.start`; a reference line key (`line-<n>`) carries no dot.
        foreach (var (slug, nested) in model.Nested.Where(entry => entry.Value.Host.StartsWith("line:", StringComparison.Ordinal) &&
                     dropped.Contains(entry.Value.Host[5..].Split('.')[0])).ToList()) {
            facts.Add(Fact($"$.nested.{slug}.host", ("host", nested.Host)));
            _ = model.Nested.Remove(slug);
        }
        return facts;
    }

    private static FamilyModelUnmodeledFact Fact(string path, params (string Key, string Value)[] facts) => new() {
        Reason = UnmodeledReason.RefLineStartNotTwoPlanes,
        Path = path,
        Facts = facts.ToDictionary(f => f.Key, f => f.Value, StringComparer.Ordinal)
    };
}
