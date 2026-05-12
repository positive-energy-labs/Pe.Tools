using System.Globalization;

namespace Pe.Dev.Cli;

internal sealed record RevitTestCliOptions(
    string? ConfigurationOverride,
    int? RevitYearOverride,
    string? Filter,
    bool NoBuild,
    bool AllowDeployedAddin
) {
    public bool HasExplicitTarget => !string.IsNullOrWhiteSpace(this.ConfigurationOverride) || this.RevitYearOverride.HasValue;

    public static RevitTestCliOptions Parse(IReadOnlyList<string> args) {
        string? configurationOverride = null;
        int? revitYearOverride = null;
        string? filter = null;
        var noBuild = false;
        var allowDeployedAddin = false;

        for (var i = 0; i < args.Count; i++) {
            switch (args[i]) {
            case "--configuration":
                configurationOverride = RequireValue(args, ref i, args[i]);
                break;
            case "--revit-year":
                revitYearOverride = ParseYear(RequireValue(args, ref i, args[i]));
                break;
            case "--filter":
                filter = RequireValue(args, ref i, args[i]);
                break;
            case "--no-build":
                noBuild = true;
                break;
            case "--allow-deployed-addin":
                allowDeployedAddin = true;
                break;
            default:
                throw new ArgumentException($"Unknown `pe-dev revit test` argument '{args[i]}'.");
            }
        }

        if (!string.IsNullOrWhiteSpace(configurationOverride) && revitYearOverride.HasValue) {
            throw new ArgumentException(
                "Specify either --configuration or --revit-year for `pe-dev revit test`, not both."
            );
        }

        return new RevitTestCliOptions(
            configurationOverride,
            revitYearOverride,
            filter,
            noBuild,
            allowDeployedAddin
        );
    }

    internal static int ParseYear(string value) {
        if (!int.TryParse(value, NumberStyles.None, CultureInfo.InvariantCulture, out var year))
            throw new ArgumentException($"Invalid Revit year '{value}'.");

        if (year is >= 23 and <= 99)
            return 2000 + year;
        if (year is >= 2000 and <= 2100)
            return year;

        throw new ArgumentException($"Unsupported Revit year '{value}'.");
    }

    private static string RequireValue(IReadOnlyList<string> args, ref int index, string optionName) {
        if (index + 1 >= args.Count)
            throw new ArgumentException($"Missing value for {optionName}.");

        index++;
        return args[index];
    }
}
