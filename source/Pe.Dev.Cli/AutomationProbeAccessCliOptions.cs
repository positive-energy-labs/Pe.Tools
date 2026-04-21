using System.Globalization;
using Pe.Dev.RevitAutomation;

namespace Pe.Dev.Cli;

internal sealed record AutomationProbeAccessCliOptions(
    string Region,
    string ProjectGuid,
    string ModelGuid,
    string? ExpectedTitle,
    string Engine,
    int TimeoutSeconds,
    bool Debug,
    bool Mask,
    bool Json
) {
    public const string UsageText = """
                                     Usage:
                                       pe-dev revit automation probe-access --region <US|EMEA> --project-guid <guid> --model-guid <guid> [--expected-title <title>] [--engine <engine>] [--timeout-seconds <seconds>] [--debug <true|false>] [--mask <true|false>] [--json]
                                     """;

    public static AutomationProbeAccessCliOptions Parse(IReadOnlyList<string> args) {
        if (args.Count == 0 || !string.Equals(args[0], "probe-access", StringComparison.OrdinalIgnoreCase))
            throw new ArgumentException("Expected `probe-access` after `pe-dev revit automation`.");

        string? region = null;
        string? projectGuid = null;
        string? modelGuid = null;
        string? expectedTitle = null;
        var engine = ProbeAccessOptions.DefaultEngine;
        var timeoutSeconds = ProbeAccessOptions.DefaultTimeoutSeconds;
        var debug = true;
        var mask = true;
        var json = false;

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
                debug = ReadBooleanOption(args, ref i, defaultValue: true);
                break;
            case "--mask":
                mask = ReadBooleanOption(args, ref i, defaultValue: true);
                break;
            case "--json":
                json = true;
                break;
            default:
                throw new ArgumentException($"Unknown automation probe argument '{arg}'.");
            }
        }

        if (string.IsNullOrWhiteSpace(region))
            throw new ArgumentException("Missing required argument `--region`.");
        if (string.IsNullOrWhiteSpace(projectGuid))
            throw new ArgumentException("Missing required argument `--project-guid`.");
        if (string.IsNullOrWhiteSpace(modelGuid))
            throw new ArgumentException("Missing required argument `--model-guid`.");

        return new AutomationProbeAccessCliOptions(
            region,
            projectGuid,
            modelGuid,
            expectedTitle,
            engine,
            timeoutSeconds,
            debug,
            mask,
            json
        );
    }

    public ProbeAccessOptions ToProbeAccessOptions() =>
        new(
            this.Region,
            this.ProjectGuid,
            this.ModelGuid,
            this.ExpectedTitle,
            this.Engine,
            this.TimeoutSeconds,
            this.Debug,
            this.Mask,
            this.Json
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
