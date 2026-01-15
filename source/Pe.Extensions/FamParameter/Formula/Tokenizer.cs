using System.Text.RegularExpressions;

namespace Pe.Extensions.FamParameter.Formula;

/// <summary>
///     Low-level formula tokenization utilities.
///     Internal implementation - consumers should use higher-level methods in <see cref="FormulaReferences" />.
/// </summary>
internal static class FormulaUtils {
    /// <summary>
    ///     Revit formula functions (case-insensitive).
    ///     These are excluded from parameter name extraction.
    /// </summary>
    public static readonly HashSet<string> RevitFunctions = new(StringComparer.OrdinalIgnoreCase) {
        "sin",
        "cos", 
        "tan",
        "asin",
        "acos",
        "atan",
        "exp",
        "log",
        "sqrt",
        "abs",
        "if",
        "or",
        "and",
        "not",
        "text_file_lookup_obsoleted",
        "pi",
        "ConduitSize_Lookup_obsoleted",
        "round",
        "roundup",
        "rounddown",
        "size_lookup",
        "ln"
    };

    /// <summary>
    ///     Boundary chars: operators + structural formula characters.
    ///     Excludes quotes (") because they are used to delimit string literals.
    /// </summary>
    public static readonly char[] BoundaryChars = [
        '+', '-', '*', '/', '^', '=', '>', '<', ' ', '[', ']', '(', ')', ',', '\t', '\r', '\n'
    ];

    /// <summary>
    ///     Extracts tokens from a formula after masking out known valid parameter names.
    ///     This allows detection of invalid parameter references, including those with spaces.
    ///     Returns only tokens that are NOT numbers, functions, or known parameters.
    /// </summary>
    internal static IEnumerable<string> ExtractInvalidTokens(string formula, IEnumerable<string> validParameterNames) {
        if (string.IsNullOrWhiteSpace(formula))
            return [];

        var tokens = ExtractUnknownTokens(formula, validParameterNames);

        // Filter to only tokens that could be parameter references
        // (don't start with digit, aren't functions)
        return tokens.Where(CouldBeParameterReference).Distinct();
    }

    /// <summary>
    ///     Extracts "suspicious" tokens from a formula - tokens that start with a digit
    ///     and are not recognized as known parameters. These are typically numeric literals
    ///     with unit suffixes (e.g., "0'", "12 in", "45 deg"), but could theoretically be
    ///     parameter names that start with digits (rare but allowed in Revit).
    /// </summary>
    /// <remarks>
    ///     Use this for diagnostic purposes when Revit rejects a formula - the suspicious
    ///     tokens may help identify what Revit interpreted incorrectly.
    /// </remarks>
    internal static IEnumerable<string> ExtractSuspiciousTokens(string formula, IEnumerable<string> validParameterNames) {
        if (string.IsNullOrWhiteSpace(formula))
            return [];

        var tokens = ExtractUnknownTokens(formula, validParameterNames);

        // Suspicious = starts with digit (likely numeric literal with unit suffix)
        // but not a pure number or known function
        return tokens
            .Where(t => !string.IsNullOrEmpty(t) && char.IsDigit(t[0]))
            .Where(t => !double.TryParse(t, out _))  // Not a pure number
            .Distinct();
    }

    /// <summary>
    ///     Core tokenization: extracts all tokens that remain after masking known parameters,
    ///     stripping string literals, and splitting on boundary chars.
    /// </summary>
    private static IEnumerable<string> ExtractUnknownTokens(string formula, IEnumerable<string> validParameterNames) {
        // Strip string literals first
        var withoutStrings = Regex.Replace(formula, "\"[^\"]*\"", " ");

        // Sort parameters by length descending to handle overlapping names correctly
        // e.g., "Width Offset" should be checked before "Width"
        var sortedParams = validParameterNames
            .Where(p => !string.IsNullOrEmpty(p))
            .OrderByDescending(p => p.Length)
            .ToList();

        // Use span for efficient character-by-character processing
        var chars = withoutStrings.ToCharArray();

        // Mask out valid parameters by replacing them with spaces
        foreach (var paramName in sortedParams) {
            MaskParameter(chars, paramName);
        }

        // Now tokenize the masked string
        var maskedFormula = new string(chars);
        return maskedFormula.Split(BoundaryChars, StringSplitOptions.RemoveEmptyEntries);
    }

    /// <summary>
    ///     Determines if a token could plausibly be a parameter reference.
    ///     By convention, parameter names start with a letter or underscore, not a digit.
    ///     Tokens starting with digits are almost always numeric literals (possibly with unit suffixes).
    /// </summary>
    private static bool CouldBeParameterReference(string token) {
        if (string.IsNullOrEmpty(token)) return false;

        // Tokens starting with a digit are almost certainly numeric literals, not parameters
        // (e.g., "0'", "12", "45.5 in" -> after split: "0'", "12", "45", "5", "in")
        if (char.IsDigit(token[0])) return false;

        // Known Revit functions
        if (RevitFunctions.Contains(token)) return false;

        return true;
    }

    /// <summary>
    ///     Masks all boundary-valid occurrences of a parameter name in a character array.
    ///     Modifies the array in-place for efficiency.
    /// </summary>
    private static void MaskParameter(char[] chars, string paramName) {
        var paramLen = paramName.Length;
        var maxStart = chars.Length - paramLen;

        for (var i = 0; i <= maxStart; i++) {
            // Quick check: first character must match
            if (chars[i] != paramName[0])
                continue;

            // Check if full parameter name matches at this position
            var matches = true;
            for (var j = 1; j < paramLen; j++) {
                if (chars[i + j] != paramName[j]) {
                    matches = false;
                    break;
                }
            }

            if (!matches)
                continue;

            // Validate boundaries
            var leftValid = i == 0 || BoundaryChars.Contains(chars[i - 1]);
            var rightValid = (i + paramLen >= chars.Length) || BoundaryChars.Contains(chars[i + paramLen]);

            if (leftValid && rightValid) {
                // Mask this occurrence with spaces
                for (var j = 0; j < paramLen; j++) {
                    chars[i + j] = ' ';
                }
                // Skip past this occurrence
                i += paramLen - 1;
            }
        }
    }
}