namespace Pe.Revit.Extensions.FamParameter.Formula;

/// <summary>
///     Extension methods for navigating formula dependency relationships.
/// </summary>
public static class FormulaDependencies {
    /// <summary>
    ///     Gets all family parameters that THIS parameter's formula references.
    ///     Direction: What do I depend on? (downstream dependencies)
    /// </summary>
    /// <returns>Collection of family parameters referenced in the formula, empty if no formula or no references</returns>
    public static IEnumerable<FamilyParameter> GetDependencies(
        this FamilyParameter param,
        FamilyParameterSet parameters
    ) => parameters.GetReferencedIn(param.Formula);

    /// <summary>
    ///     Gets all family parameters that reference THIS parameter in their formulas.
    ///     Direction: Who depends on me? (upstream dependents)
    /// </summary>
    /// <returns>Collection of family parameters that use this parameter in their formulas</returns>
    public static IEnumerable<FamilyParameter> GetDependents(
        this FamilyParameter param,
        FamilyParameterSet parameters
    ) {
        var all = parameters.OfType<FamilyParameter>().ToList();
        // Siblings are needed so a formula naming only "Half Width" does not report "Width" as a dependency.
        var siblings = all.Select(p => p.Definition.Name).ToList();
        return all
            .Where(p => !p.IsBuiltInParameter())
            .Where(p => param.IsReferencedIn(p.Formula, siblings));
    }
}