namespace Pe.Extensions.FamParameter.Formula;

/// <summary>
///     Extension methods for checking parameter references within formulas.
/// </summary>
public static class FormulaReferences {
    /// <summary>
    ///     Checks if this parameter is referenced in a formula with strict boundary validation.
    ///     Validates that the parameter name is properly bounded by formula operators/delimiters.
    /// </summary>
    /// <param name="param">The family parameter to check for</param>
    /// <param name="formula">The formula to search in</param>
    /// <returns>True if the parameter name is properly bounded in the formula</returns>
    public static bool IsReferencedIn(this FamilyParameter param, string formula) {
        var parameterName = param.Definition.Name;
        if (string.IsNullOrEmpty(parameterName) || string.IsNullOrEmpty(formula)) return false;

        var searchStart = 0;
        while (searchStart < formula.Length) {
            var leftIndex = formula.IndexOf(parameterName, searchStart, StringComparison.Ordinal);
            if (leftIndex == -1) return false;
            var leftValid = leftIndex == 0 || FormulaUtils.BoundaryChars.Contains(formula[leftIndex - 1]);

            var rightIndex = leftIndex + parameterName.Length;
            var rightValid = rightIndex >= formula.Length || FormulaUtils.BoundaryChars.Contains(formula[rightIndex]);
            if (leftValid && rightValid) return true;

            // Ok to only move index by 1 because this invalidates whatever parameter name was here (first letter chopped off)
            searchStart = leftIndex + 1;
        }

        return false;
    }

    /// <summary>
    ///     Checks if this parameter's formula references another parameter.
    /// </summary>
    /// <returns>True if otherParam is referenced in this parameter's formula</returns>
    public static bool ReferencesParam(this FamilyParameter thisParam, FamilyParameter otherParam) {
        var formula = thisParam.Formula;
        if (string.IsNullOrWhiteSpace(formula))
            return false;

        return otherParam.IsReferencedIn(formula);
    }

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

        return parameters
            .OfType<FamilyParameter>()
            .Where(p => p.IsReferencedIn(formula));
    }

    /// <summary>
    ///     Validates that all parameter-like tokens in a formula reference existing parameters.
    ///     Returns empty list if valid, otherwise returns the invalid parameter names.
    ///     Handles parameter names with spaces correctly by masking known parameters before tokenizing.
    /// </summary>
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
}