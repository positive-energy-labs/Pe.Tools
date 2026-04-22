using Pe.Dev.RevitAutomation;
using Pe.Shared.RevitData;
using System.Globalization;

namespace Pe.Dev.Cli;

internal sealed record AutomationParameterCollectionCliOptions(
    string Region,
    string ProjectGuid,
    string ModelGuid,
    string? ExpectedTitle,
    string Engine,
    int TimeoutSeconds,
    bool Debug,
    bool Mask,
    bool Json,
    LoadedFamiliesFilter? Filter
) {
    public const string UsageText = """
                                    Usage:
                                      pe-dev revit automation collect-parameters --region <US|EMEA> --project-guid <guid> --model-guid <guid> [--expected-title <title>] [--engine <engine>] [--timeout-seconds <seconds>] [--debug <true|false>] [--mask <true|false>] [--family-name <name>]... [--category-name <name>]... [--placement-scope <AllLoaded|PlacedOnly|UnplacedOnly>] [--json]
                                    """;

    public static AutomationParameterCollectionCliOptions Parse(IReadOnlyList<string> args) {
        if (args.Count == 0 || !string.Equals(args[0], "collect-parameters", StringComparison.OrdinalIgnoreCase))
            throw new ArgumentException("Expected `collect-parameters` after `pe-dev revit automation`.");

        string? region = null;
        string? projectGuid = null;
        string? modelGuid = null;
        string? expectedTitle = null;
        var engine = ParameterCollectionOptions.DefaultEngine;
        var timeoutSeconds = ParameterCollectionOptions.DefaultTimeoutSeconds;
        var debug = true;
        var mask = true;
        var json = false;
        var familyNames = new List<string>();
        var categoryNames = new List<string>();
        var placementScope = LoadedFamilyPlacementScope.AllLoaded;

        for (var i = 1; i < args.Count; i++) {
            var arg = args[i];
            switch (arg) {
            case "--region":
                region = RequireValue(args, ref i, arg);
                break;
            case "--project-guid":
                projectGuid = RequireValue(args, ref i, arg);
                break;
            case "--model-guid":
                modelGuid = RequireValue(args, ref i, arg);
                break;
            case "--expected-title":
                expectedTitle = RequireValue(args, ref i, arg);
                break;
            case "--engine":
                engine = RequireValue(args, ref i, arg);
                break;
            case "--timeout-seconds":
                timeoutSeconds = int.Parse(RequireValue(args, ref i, arg), CultureInfo.InvariantCulture);
                break;
            case "--debug":
                debug = ReadBooleanOption(args, ref i, true);
                break;
            case "--mask":
                mask = ReadBooleanOption(args, ref i, true);
                break;
            case "--family-name":
                familyNames.Add(RequireValue(args, ref i, arg));
                break;
            case "--category-name":
                categoryNames.Add(RequireValue(args, ref i, arg));
                break;
            case "--placement-scope":
                placementScope = Enum.Parse<LoadedFamilyPlacementScope>(RequireValue(args, ref i, arg), true);
                break;
            case "--json":
                json = true;
                break;
            default:
                throw new ArgumentException($"Unknown automation parameter collection argument '{arg}'.");
            }
        }

        if (string.IsNullOrWhiteSpace(region))
            throw new ArgumentException("Missing required argument `--region`.");
        if (string.IsNullOrWhiteSpace(projectGuid))
            throw new ArgumentException("Missing required argument `--project-guid`.");
        if (string.IsNullOrWhiteSpace(modelGuid))
            throw new ArgumentException("Missing required argument `--model-guid`.");

        var filter = familyNames.Count == 0 && categoryNames.Count == 0 &&
                     placementScope == LoadedFamilyPlacementScope.AllLoaded
            ? null
            : new LoadedFamiliesFilter {
                FamilyNames = familyNames, CategoryNames = categoryNames, PlacementScope = placementScope
            };

        return new AutomationParameterCollectionCliOptions(
            region,
            projectGuid,
            modelGuid,
            expectedTitle,
            engine,
            timeoutSeconds,
            debug,
            mask,
            json,
            filter
        );
    }

    public ParameterCollectionOptions ToOptions() =>
        new(
            this.Region,
            this.ProjectGuid,
            this.ModelGuid,
            this.ExpectedTitle,
            this.Engine,
            this.TimeoutSeconds,
            this.Debug,
            this.Mask,
            this.Json,
            this.Filter
        );

    private static string RequireValue(IReadOnlyList<string> args, ref int index, string optionName) {
        if (index + 1 >= args.Count)
            throw new ArgumentException($"Missing value for {optionName}.");

        index++;
        return args[index];
    }

    private static bool ReadBooleanOption(IReadOnlyList<string> args, ref int index, bool defaultValue) {
        if (index + 1 >= args.Count || args[index + 1].StartsWith("--", StringComparison.Ordinal))
            return defaultValue;

        index++;
        return bool.Parse(args[index]);
    }
}