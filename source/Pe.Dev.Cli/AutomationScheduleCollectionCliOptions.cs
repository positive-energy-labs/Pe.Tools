using Pe.Dev.RevitAutomation;
using Pe.Shared.RevitData.Schedules;
using System.Globalization;

namespace Pe.Dev.Cli;

internal sealed record AutomationScheduleCollectionCliOptions(
    string Region,
    string ProjectGuid,
    string ModelGuid,
    string? ExpectedTitle,
    string Engine,
    int TimeoutSeconds,
    bool Debug,
    bool Mask,
    bool Json,
    ScheduleCollectionRequest Request
) {
    public const string UsageText = """
                                    Usage:
                                      pe-dev revit automation collect-schedules --region <US|EMEA> --project-guid <guid> --model-guid <guid> [--expected-title <title>] [--engine <engine>] [--timeout-seconds <seconds>] [--debug <true|false>] [--mask <true|false>] [--primary-parameter-name <name>] [--primary-value <value>] [--primary-category-name <name>]... [--primary-schedule-name <name>]... [--fallback-category-name <name>]... [--fallback-schedule-name <name>]... [--include-templates <true|false>] [--json]
                                    """;

    public static AutomationScheduleCollectionCliOptions Parse(IReadOnlyList<string> args) {
        if (args.Count == 0 || !string.Equals(args[0], "collect-schedules", StringComparison.OrdinalIgnoreCase))
            throw new ArgumentException("Expected `collect-schedules` after `pe-dev revit automation`.");

        string? region = null;
        string? projectGuid = null;
        string? modelGuid = null;
        string? expectedTitle = null;
        var engine = ScheduleCollectionOptions.DefaultEngine;
        var timeoutSeconds = ScheduleCollectionOptions.DefaultTimeoutSeconds;
        var debug = true;
        var mask = true;
        var json = false;
        var includeTemplates = false;
        var primaryParameterName = ScheduleCollectionDefaults.DefaultPrimaryParameterName;
        var primaryValue = ScheduleCollectionDefaults.DefaultPrimaryParameterValue;
        var primaryCategoryNames = new List<string>();
        var primaryScheduleNames = new List<string>();
        var fallbackCategoryNames =
            new List<string>(ScheduleCollectionDefaults.CreateDefaultFallbackCatalogRequest().CategoryNames);
        var fallbackScheduleNames = new List<string>();

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
            case "--primary-parameter-name":
                primaryParameterName = RequireValue(args, ref i, arg);
                break;
            case "--primary-value":
                primaryValue = RequireValue(args, ref i, arg);
                break;
            case "--primary-category-name":
                primaryCategoryNames.Add(RequireValue(args, ref i, arg));
                break;
            case "--primary-schedule-name":
                primaryScheduleNames.Add(RequireValue(args, ref i, arg));
                break;
            case "--fallback-category-name":
                fallbackCategoryNames.Add(RequireValue(args, ref i, arg));
                break;
            case "--fallback-schedule-name":
                fallbackScheduleNames.Add(RequireValue(args, ref i, arg));
                break;
            case "--include-templates":
                includeTemplates = ReadBooleanOption(args, ref i, true);
                break;
            case "--json":
                json = true;
                break;
            default:
                throw new ArgumentException($"Unknown automation schedule collection argument '{arg}'.");
            }
        }

        if (string.IsNullOrWhiteSpace(region))
            throw new ArgumentException("Missing required argument `--region`.");
        if (string.IsNullOrWhiteSpace(projectGuid))
            throw new ArgumentException("Missing required argument `--project-guid`.");
        if (string.IsNullOrWhiteSpace(modelGuid))
            throw new ArgumentException("Missing required argument `--model-guid`.");

        var primaryRequest = new ScheduleCatalogRequest {
            CategoryNames = primaryCategoryNames,
            ScheduleNames = primaryScheduleNames,
            IncludeTemplates = includeTemplates,
            CustomParameterFilters = string.IsNullOrWhiteSpace(primaryParameterName) ||
                                     string.IsNullOrWhiteSpace(primaryValue)
                ? []
                : [
                    new ScheduleCustomParameterFilter(
                        primaryParameterName,
                        primaryValue,
                        ScheduleCustomParameterMatchKind.Equals
                    )
                ]
        };
        var fallbackRequest = new ScheduleCatalogRequest {
            CategoryNames = fallbackCategoryNames
                .Where(name => !string.IsNullOrWhiteSpace(name))
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .ToList(),
            ScheduleNames = fallbackScheduleNames,
            IncludeTemplates = includeTemplates
        };

        return new AutomationScheduleCollectionCliOptions(
            region,
            projectGuid,
            modelGuid,
            expectedTitle,
            engine,
            timeoutSeconds,
            debug,
            mask,
            json,
            new ScheduleCollectionRequest(primaryRequest, fallbackRequest)
        );
    }

    public ScheduleCollectionOptions ToOptions() =>
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
            this.Request
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