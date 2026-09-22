namespace Pe.Revit.Extensions.ProjDocument;

/// <summary>A loaded Family as name resolution sees it.</summary>
public sealed record LoadedFamily(string Name, long Id, bool Editable, string Category);

/// <summary>One requested name: its family id, or exactly one refusal (and a null id).</summary>
public sealed record FamilyNameResolution(string Name, long? FamilyId, string? Code = null, string? Message = null);

/// <summary>
///     A loaded family's stable identity is its NAME in the document: Revit replaces the Family element on every
///     LoadFamily after an edit, so an id names one load only (family ledger, Decided). Names are exact and case-sensitive.
/// </summary>
public static class ProjectFamilies {
    /// <summary>What refuses a whole request of names: none, or one name twice.</summary>
    public static IReadOnlyList<(string Code, string Message)> RequestRefusals(IReadOnlyList<string> names) =>
        names.Count == 0
            ? [("family-names-empty", "Name at least one family.")]
            : names.GroupBy(name => name, StringComparer.Ordinal).Where(g => g.Count() > 1)
                .Select(g => ("family-name-duplicate", $"'{g.Key}' is named more than once.")).ToList();

    public static IReadOnlyList<FamilyNameResolution> ResolveByName(this Document document, IReadOnlyList<string> names) =>
        Resolve(new FilteredElementCollector(document).OfClass(typeof(Family)).Cast<Family>()
            .Select(f => new LoadedFamily(f.Name, f.Id.Value(), f.IsEditable && !f.IsInPlace, f.FamilyCategory?.Name ?? "no category")), names);

    /// <summary>Per name, in request order. Ambiguity refuses and never picks.</summary>
    public static IReadOnlyList<FamilyNameResolution> Resolve(IEnumerable<LoadedFamily> loaded, IReadOnlyList<string> names) {
        var byName = loaded.ToLookup(f => f.Name, StringComparer.Ordinal);
        return names.Select(name => byName[name].ToList() switch {
            [] => new FamilyNameResolution(name, null, "family-not-found", $"No loaded family named '{name}'."),
            [{ Editable: false }] => new FamilyNameResolution(name, null, "family-not-editable", $"'{name}' cannot be edited (in-place/system)."),
            [var one] => new FamilyNameResolution(name, one.Id),
            var many => new FamilyNameResolution(name, null, "family-name-ambiguous",
                $"'{name}' matches {many.Count} families ({string.Join(", ", many.Select(f => f.Category).OrderBy(c => c, StringComparer.Ordinal))}).")
        }).ToList();
    }
}
