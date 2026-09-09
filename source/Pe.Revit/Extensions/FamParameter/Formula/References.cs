namespace Pe.Revit.Extensions.FamParameter.Formula;

/// <summary>
///     Extension methods for checking parameter references within formulas.
/// </summary>
public static class FormulaReferences {
    /// <summary>
    ///     Checks if this parameter is referenced in a formula, matching names longest-first against
    ///     <paramref name="siblingNames" /> so a longer name that contains this one wins its span first
    ///     ("Width" is not referenced by the formula "Half Width").
    /// </summary>
    /// <param name="param">The family parameter to check for</param>
    /// <param name="formula">The formula to search in</param>
    /// <param name="siblingNames">
    ///     Every other parameter name that could shadow this one. Omit only when no sibling set is
    ///     available: without it the check sees no longer names and over-reports, as it always did.
    /// </param>
    /// <returns>True if the parameter name owns a boundary-valid span of the formula</returns>
    public static bool IsReferencedIn(this FamilyParameter param, string formula, IEnumerable<string>? siblingNames = null) {
        var parameterName = param.Definition.Name;
        if (string.IsNullOrEmpty(parameterName) || string.IsNullOrEmpty(formula)) return false;

        IEnumerable<string> candidates = siblingNames is null ? [parameterName] : siblingNames.Append(parameterName);
        return GetReferencedNames(candidates, formula).Contains(parameterName);
    }

    /// <summary>
    ///     The subset of <paramref name="candidateNames" /> a formula actually references. Names are matched
    ///     longest-first, so "Half Width" consumes its span before "Width" is tested.
    /// </summary>
    public static HashSet<string> GetReferencedNames(this IEnumerable<string> candidateNames, string formula) =>
        FormulaUtils.ExtractReferencedNames(formula, candidateNames);

    /// <summary>
    ///     Gets all family parameters referenced in the given formula string.
    ///     Use this when validating a formula before setting it on a parameter.
    /// </summary>
    /// <returns>Collection of family parameters referenced in the formula</returns>
    public static IEnumerable<FamilyParameter> GetReferencedIn(
        this FamilyParameterSet parameters,
        string formula
    ) {
        if (string.IsNullOrWhiteSpace(formula))
            return [];

        var all = parameters.OfType<FamilyParameter>().ToList();
        var referenced = all.Select(p => p.Definition.Name).GetReferencedNames(formula);
        return all.Where(p => referenced.Contains(p.Definition.Name));
    }

    /// <summary>
    ///     Validates that all parameter-like tokens in a formula reference existing parameters.
    ///     Returns empty list if valid, otherwise returns the invalid parameter names.
    ///     Handles parameter names with spaces correctly by masking known parameters before tokenizing.
    /// </summary>
    /// <remarks>
    ///     Tokens that start with a digit are excluded from this check, as they are almost certainly
    ///     numeric literals (possibly with unit suffixes like "0'" or "12 in"), not parameter references.
    ///     Use <see cref="GetSuspiciousTokens" /> if you need to see those tokens for diagnostics.
    /// </remarks>
    /// <returns>Collection of invalid parameter names, empty if all tokens are valid</returns>
    public static IEnumerable<string> GetInvalidReferences(
        this FamilyParameterSet parameters,
        string formula
    ) {
        if (string.IsNullOrWhiteSpace(formula))
            return [];

        var validParamNames = parameters
            .OfType<FamilyParameter>()
            .Select(p => p.Definition.Name);

        return FormulaUtils.ExtractInvalidTokens(formula, validParamNames);
    }

    /// <summary>
    ///     Extracts "suspicious" tokens from a formula - tokens that start with a digit
    ///     and are not recognized as known parameters or pure numbers.
    ///     These are typically numeric literals with unit suffixes (e.g., "0'", "12 in").
    /// </summary>
    /// <remarks>
    ///     By convention, Revit parameter names start with letters or underscores, not digits.
    ///     However, Revit technically allows parameter names that start with digits.
    ///     This method helps identify tokens that are likely numeric literals but could
    ///     theoretically be unconventional parameter names - useful for diagnostics when
    ///     Revit rejects a formula.
    /// </remarks>
    /// <returns>Collection of suspicious tokens (start with digit, not pure numbers, not known parameters)</returns>
    public static IEnumerable<string> GetSuspiciousTokens(
        this FamilyParameterSet parameters,
        string formula
    ) {
        if (string.IsNullOrWhiteSpace(formula))
            return [];

        var validParamNames = parameters
            .OfType<FamilyParameter>()
            .Select(p => p.Definition.Name);

        return FormulaUtils.ExtractSuspiciousTokens(formula, validParamNames);
    }
}