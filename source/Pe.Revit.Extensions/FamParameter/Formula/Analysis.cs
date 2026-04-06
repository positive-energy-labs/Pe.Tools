namespace Pe.Extensions.FamParameter.Formula;

/// <summary>
///     Extension methods for analyzing and classifying formulas.
/// </summary>
public static class FormulaAnalysis {
    /// <summary>
    ///     Checks if a formula is a constant expression (contains no parameter references).
    ///     Constant formulas include literals like "20", "7.75\"", "60 Hz", "\"text\"",
    ///     and constant expressions like "2 A + 5 A".
    /// </summary>
    /// <returns>True if the formula has no parameter references</returns>
    public static bool IsConstant(this FamilyParameterSet parameters, string formula) {
        if (string.IsNullOrWhiteSpace(formula)) return false;
        return !parameters.GetReferencedIn(formula).Any();
    }

    /// <summary>
    ///     Checks if a formula is just a single parameter reference (no operators, no functions).
    ///     Returns the referenced parameter if so, null otherwise.
    /// </summary>
    /// <param name="parameters">The family parameter set containing all parameters</param>
    /// <param name="formula">The formula string to check</param>
    /// <returns>The single referenced parameter, or null if not a single reference</returns>
    public static FamilyParameter? TryGetSingleReference(this FamilyParameterSet parameters, string formula) {
        if (string.IsNullOrWhiteSpace(formula)) return null;

        var referencedParams = parameters.GetReferencedIn(formula).ToList();
        if (referencedParams.Count != 1) return null;

        var param = referencedParams[0];
        // Formula must be EXACTLY the parameter name (trimmed)
        return formula.Trim() == param.Definition.Name ? param : null;
    }
}