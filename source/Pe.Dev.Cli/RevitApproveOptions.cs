using System.Globalization;

namespace Pe.Dev.Cli;

internal sealed record RevitApproveOptions(
    int TimeoutSeconds,
    int? RevitYear,
    bool SkipIfSessionExists
) {
    public static RevitApproveOptions Parse(IReadOnlyList<string> args) {
        var timeoutSeconds = 60;
        int? revitYear = null;
        var skipIfSessionExists = false;

        for (var i = 0; i < args.Count; i++) {
            var arg = args[i];
            switch (arg.ToLowerInvariant()) {
            case "--timeout-seconds":
            case "-timeoutseconds":
                timeoutSeconds = int.Parse(RequireValue(args, ref i, arg), CultureInfo.InvariantCulture);
                if (timeoutSeconds <= 0)
                    throw new ArgumentOutOfRangeException(nameof(args), "--timeout-seconds must be greater than zero.");
                break;
            case "--revit-year":
            case "-revityear":
                revitYear = int.Parse(RequireValue(args, ref i, arg), CultureInfo.InvariantCulture);
                break;
            case "--skip-if-session-exists":
                skipIfSessionExists = true;
                break;
            default:
                throw new ArgumentException($"Unknown argument '{arg}' for approve.");
            }
        }

        return new RevitApproveOptions(timeoutSeconds, revitYear, skipIfSessionExists);
    }

    private static string RequireValue(IReadOnlyList<string> args, ref int index, string optionName) {
        if (index + 1 >= args.Count)
            throw new ArgumentException($"Missing value for {optionName}.");

        index++;
        return args[index];
    }
}
