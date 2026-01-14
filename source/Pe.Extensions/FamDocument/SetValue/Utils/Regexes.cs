using System.Globalization;
using System.Text.RegularExpressions;

namespace Pe.Extensions.FamDocument.SetValue.Utils;

public static class Regexes {
    // Compiled regexes for performance - created once and reused
    private static readonly Regex IntegerRegex = new(@"^-?\d+", RegexOptions.Compiled);
    private static readonly Regex DoubleRegex = new(@"^-?\d*\.?\d+", RegexOptions.Compiled);

    public static bool TryExtractInteger(string? input, out int result) {
        result = 0;
        if (string.IsNullOrWhiteSpace(input)) return false;

        var trimmed = input!.Trim();
        var match = IntegerRegex.Match(trimmed);

        return match.Success
               && int.TryParse(match.Value, NumberStyles.Integer, CultureInfo.InvariantCulture, out result);
    }

    public static bool TryExtractDouble(string? input, out double result) {
        result = 0.0;
        if (string.IsNullOrWhiteSpace(input)) return false;

        var trimmed = input!.Trim();
        var match = DoubleRegex.Match(trimmed);

        return match.Success
               && double.TryParse(match.Value, NumberStyles.Float | NumberStyles.AllowLeadingSign,
                   CultureInfo.InvariantCulture, out result);
    }

    public static int ExtractInteger(string input) =>
        TryExtractInteger(input, out var result)
            ? result
            : throw new ArgumentException(
                $@"No valid integer found at the start of string: {input}",
                nameof(input)
            );

    public static double ExtractDouble(string input) =>
        TryExtractDouble(input, out var result)
            ? result
            : throw new ArgumentException(
                $@"No valid numeric value found at the start of string: {input}",
                nameof(input)
            );
}