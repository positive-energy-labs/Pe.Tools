using Pe.Revit.Extensions.FamParameter;
using Pe.Revit.Extensions.FamParameter.Formula;
using System.Diagnostics;
using System.Globalization;
using System.Text;

namespace Pe.Revit.Extensions.FamDocument;

public static class Formula {
    private static readonly HashSet<ForgeTypeId> _forbiddenDataTypes = [
        SpecTypeId.String.Url,
        SpecTypeId.Reference.LoadClassification,
        SpecTypeId.String.MultilineText
    ];

    public static bool UnsetFormula(this FamilyDocument famDoc, FamilyParameter targetParam) {
        var success = famDoc.TrySetFormulaFast(targetParam, null, out _);
        return success;
    }

    public static bool TrySetFormula(
        this FamilyDocument famDoc,
        FamilyParameter targetParam,
        string formula,
        out string? errorMessage
    ) {
        errorMessage = null;

        try {
            if (string.IsNullOrWhiteSpace(formula))
                return famDoc.TrySetFormulaFast(targetParam, null, out errorMessage);

            var parameters = famDoc.FamilyManager.Parameters;
            var lookupContext = TryParseSizeLookupFormula(formula);
            var formulaForReferenceValidation = lookupContext?.FormulaForReferenceValidation ?? formula;

            if (TryValidateSizeLookupFormula(famDoc, targetParam, formula, lookupContext, out errorMessage))
                return false;

            var invalidParams = parameters.GetInvalidReferences(formulaForReferenceValidation).ToList();
            var invalidUnitSuffixes = invalidParams.Where(FormulaUtils.LooksLikeUnitSuffix).ToList();
            if (lookupContext != null && invalidParams.Count == invalidUnitSuffixes.Count)
                invalidParams.Clear();

            if (invalidParams.Count != 0) {
                var likelyUnitSuffixes = invalidParams.Where(FormulaUtils.LooksLikeUnitSuffix).ToList();

                if (likelyUnitSuffixes.Count > 0) {
                    var dataType = targetParam.Definition.GetDataType();
                    var isParsableAsValue = UnitUtils.IsMeasurableSpec(dataType)
                                            && UnitFormatUtils.TryParse(famDoc.GetUnits(), dataType, formula, out _);

                    if (isParsableAsValue) {
                        errorMessage = $"Cannot set formula on parameter '{targetParam.Name()}'. " +
                                       $"The value '{formula}' appears to be a literal with unit suffix, not a valid Revit formula. " +
                                       $"Revit formulas don't support unit suffixes like {string.Join(", ", likelyUnitSuffixes.Select(s => $"'{s}'"))}. " +
                                       $"Consider using SetAsFormula: false to set this as a value instead.";
                    } else {
                        errorMessage = $"Cannot set formula on parameter '{targetParam.Name()}'. " +
                                       $"Found tokens that look like unit suffixes: {string.Join(", ", likelyUnitSuffixes.Select(s => $"'{s}'"))}. " +
                                       $"If this is intended as a literal value, use SetAsFormula: false. " +
                                       $"If it's a formula, these may be misspelled parameter names.";
                    }
                } else {
                    errorMessage = $"Cannot set formula on parameter '{targetParam.Name()}'. " +
                                   $"Formula references non-existent parameters: {string.Join(", ", invalidParams.Select(p => $"'{p}'"))}";
                }

                return false;
            }

            if (!targetParam.IsInstance) {
                var referencedParams = parameters.GetReferencedIn(formulaForReferenceValidation);
                var instanceParams = referencedParams.Where(p => p.IsInstance).ToList();

                if (instanceParams.Count > 0) {
                    var instanceNames = instanceParams.Select(p => $"'{p.Name()}'");
                    errorMessage = $"Cannot set formula on type parameter '{targetParam.Name()}'. " +
                                   $"Type parameter formulas cannot reference instance parameters: {string.Join(", ", instanceNames)}";
                    return false;
                }
            }

            var suspiciousTokens = parameters.GetSuspiciousTokens(formulaForReferenceValidation).ToList();

            var success = famDoc.TrySetFormulaFast(targetParam, formula, out var fastErrorMessage);
            if (!success) {
                errorMessage = suspiciousTokens.Count > 0
                    ? $"Cannot set formula on parameter '{targetParam.Name()}'. " +
                      $"Revit rejected the formula. Found tokens that may be numeric literals with unrecognized unit formats " +
                      $"(or unconventional parameter names starting with digits): {string.Join(", ", suspiciousTokens.Select(t => $"'{t}'"))}. " +
                      $"Revit error: {fastErrorMessage}"
                    : $"Cannot set formula on parameter '{targetParam.Name()}'. " +
                      $"Revit error: {fastErrorMessage}";
                return false;
            }

            return true;
        } catch (Exception ex) {
            errorMessage = ex.ToStringDemystified();
            return false;
        }
    }

    public static bool TrySetFormula(this FamilyDocument famDoc,
        FamilyParameter targetParam,
        FamilyParameter sourceParam,
        out string? errorMessage) {
        if (string.IsNullOrWhiteSpace(sourceParam.Formula)) {
            errorMessage = $"Cannot set formula on parameter '{targetParam.Name()}'. " +
                           $"Source parameter '{sourceParam.Name()}' has no formula.";
            return false;
        }

        var srcDataType = sourceParam.Definition.GetDataType();
        var tgtDataType = targetParam.Definition.GetDataType();
        if (srcDataType != tgtDataType) {
            errorMessage = $"Cannot set formula on parameter '{targetParam.Name()}'. " +
                           $"Source parameter '{sourceParam.Name()}' has datatype '{srcDataType}' but target parameter '{targetParam.Name()}' has datatype '{tgtDataType}'.";
            return false;
        }

        return famDoc.TrySetFormula(targetParam, sourceParam.Formula, out errorMessage);
    }

    public static bool TrySetFormulaFast(
        this FamilyDocument famDoc,
        FamilyParameter targetParam,
        string? formula,
        out string? errorMessage
    ) {
        errorMessage = null;

        try {
            if (_forbiddenDataTypes.Contains(targetParam.Definition.GetDataType())) {
                errorMessage = $"Cannot set formula on parameter '{targetParam.Name()}'. " +
                               $"This datatype formula-forbidden, among these others: {string.Join(", ", _forbiddenDataTypes.Select(d => d.ToLabel()))}.";
                return false;
            }

            famDoc.FamilyManager.SetFormula(targetParam, string.IsNullOrWhiteSpace(formula) ? null : formula);
            return true;
        } catch (Exception ex) {
            errorMessage = ex.ToStringDemystified();
            return false;
        }
    }

    private static bool TryValidateSizeLookupFormula(
        FamilyDocument famDoc,
        FamilyParameter targetParam,
        string formula,
        SizeLookupFormulaContext? lookupContext,
        out string? errorMessage
    ) {
        errorMessage = null;

        if (lookupContext == null)
            return false;

        if (!lookupContext.ParsedSuccessfully) {
            errorMessage = $"Cannot set formula on parameter '{targetParam.Name()}'. size_lookup could not be parsed safely for validation.";
            return true;
        }

        if (lookupContext.Arguments.Count < 4) {
            errorMessage = $"Cannot set formula on parameter '{targetParam.Name()}'. size_lookup requires at least 4 arguments: table name, return column, default value, and at least one lookup key.";
            return true;
        }

        if (string.IsNullOrWhiteSpace(lookupContext.Arguments[0])) {
            errorMessage = $"Cannot set formula on parameter '{targetParam.Name()}'. size_lookup table-name argument is blank.";
            return true;
        }

        if (string.IsNullOrWhiteSpace(lookupContext.Arguments[1])) {
            errorMessage = $"Cannot set formula on parameter '{targetParam.Name()}'. size_lookup return-column argument is blank.";
            return true;
        }

        if (string.IsNullOrWhiteSpace(lookupContext.Arguments[2])) {
            errorMessage = $"Cannot set formula on parameter '{targetParam.Name()}'. size_lookup default-value argument is blank.";
            return true;
        }

        if (lookupContext.Arguments.Skip(3).Any(string.IsNullOrWhiteSpace)) {
            errorMessage = $"Cannot set formula on parameter '{targetParam.Name()}'. size_lookup contains a blank lookup-key argument.";
            return true;
        }

        var dataType = targetParam.Definition.GetDataType();
        var fallback = lookupContext.Arguments[2];
        if (UnitUtils.IsMeasurableSpec(dataType)
            && LooksLikePlainNumberLiteral(fallback)
            && !UnitFormatUtils.TryParse(famDoc.GetUnits(), dataType, fallback, out _)) {
            errorMessage = $"Cannot set formula on parameter '{targetParam.Name()}'. size_lookup default '{fallback}' is a plain numeric literal, but measurable parameters usually need a unit-typed fallback compatible with '{dataType.TypeId}'. Example patterns from real families are values like '2.38\"' or '0 GPM'.";
            return true;
        }

        return false;
    }

    private static SizeLookupFormulaContext? TryParseSizeLookupFormula(string formula) {
        var sizeLookupIndex = formula.IndexOf("size_lookup", StringComparison.OrdinalIgnoreCase);
        if (sizeLookupIndex < 0)
            return null;

        var openParenIndex = formula.IndexOf('(', sizeLookupIndex);
        if (openParenIndex < 0)
            return new SizeLookupFormulaContext([], formula, false);

        if (!TryFindMatchingParen(formula, openParenIndex, out var closeParenIndex))
            return new SizeLookupFormulaContext([], formula, false);

        var argsText = formula.Substring(openParenIndex + 1, closeParenIndex - openParenIndex - 1);
        var args = SplitFormulaArguments(argsText);
        if (args.Count < 3)
            return new SizeLookupFormulaContext(args, formula, false);

        const string sanitizedTableName = "\"__size_lookup_table__\"";
        const string sanitizedReturnColumn = "\"__size_lookup_column__\"";
        const string sanitizedDefault = "0";
        var rebuiltArgs = args.Select((arg, index) => index switch {
            0 => sanitizedTableName,
            1 => sanitizedReturnColumn,
            2 => sanitizedDefault,
            _ => arg
        }).ToArray();
        var maskedFormula = string.Concat(
            formula[..(openParenIndex + 1)],
            string.Join(", ", rebuiltArgs),
            formula[closeParenIndex..]);

        return new SizeLookupFormulaContext(args, maskedFormula, true);
    }

    private static bool TryFindMatchingParen(string formula, int openParenIndex, out int closeParenIndex) {
        var depth = 0;
        var inString = false;
        for (var i = openParenIndex; i < formula.Length; i++) {
            var c = formula[i];
            if (c == '"')
                inString = !inString;

            if (inString)
                continue;

            if (c == '(')
                depth++;
            else if (c == ')') {
                depth--;
                if (depth == 0) {
                    closeParenIndex = i;
                    return true;
                }
            }
        }

        closeParenIndex = -1;
        return false;
    }

    private static List<string> SplitFormulaArguments(string argsText) {
        var args = new List<string>();
        var current = new StringBuilder();
        var depth = 0;
        var inString = false;

        foreach (var c in argsText) {
            if (c == '"')
                inString = !inString;

            if (!inString) {
                if (c == '(')
                    depth++;
                else if (c == ')')
                    depth--;
                else if (c == ',' && depth == 0) {
                    args.Add(current.ToString().Trim());
                    current.Clear();
                    continue;
                }
            }

            current.Append(c);
        }

        args.Add(current.ToString().Trim());
        return args;
    }

    private static bool LooksLikePlainNumberLiteral(string value) => double.TryParse(
        value,
        NumberStyles.Float,
        CultureInfo.InvariantCulture,
        out _);

    private sealed record SizeLookupFormulaContext(IReadOnlyList<string> Arguments, string FormulaForReferenceValidation, bool ParsedSuccessfully);
}
