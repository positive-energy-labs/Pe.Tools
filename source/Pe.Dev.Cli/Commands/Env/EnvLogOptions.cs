using System.Globalization;

namespace Pe.Dev.Cli;

internal enum EnvLogTarget {
    Host,
    App,
    All
}

internal sealed record EnvLogOptions(
    EnvLogTarget Target,
    int TailLineCount
) {
    private const int DefaultTailLineCount = 200;

    public static EnvLogOptions Parse(IReadOnlyList<string> args) {
        if (args.Count == 0)
            throw new ArgumentException("Missing log target. Expected `host`, `app`, or `all`.");

        var target = ParseTarget(args[0]);
        var tailLineCount = DefaultTailLineCount;

        for (var i = 1; i < args.Count; i++) {
            var arg = args[i];
            switch (arg.ToLowerInvariant()) {
            case "--tail":
            case "-tail":
                tailLineCount = int.Parse(
                    RequireValue(args, ref i, arg),
                    CultureInfo.InvariantCulture
                );
                if (tailLineCount <= 0)
                    throw new ArgumentOutOfRangeException(nameof(args), "--tail must be greater than zero.");
                break;
            default:
                throw new ArgumentException($"Unknown argument '{arg}' for logs.");
            }
        }

        return new EnvLogOptions(target, tailLineCount);
    }

    public IReadOnlyList<(string label, string filePath)> ResolveLogFiles() =>
        this.Target switch {
            EnvLogTarget.Host => [("host", Pe.Dev.RevitAutomation.DevLogPathResolver.HostLogPath)],
            EnvLogTarget.App => [("app", Pe.Dev.RevitAutomation.DevLogPathResolver.RevitAppLogPath)],
            EnvLogTarget.All => [
                ("host", Pe.Dev.RevitAutomation.DevLogPathResolver.HostLogPath),
                ("app", Pe.Dev.RevitAutomation.DevLogPathResolver.RevitAppLogPath)
            ],
            _ => throw new InvalidOperationException($"Unsupported log target '{this.Target}'.")
        };

    private static EnvLogTarget ParseTarget(string value) =>
        value.ToLowerInvariant() switch {
            "host" => EnvLogTarget.Host,
            "app" or "revit" => EnvLogTarget.App,
            "all" or "both" => EnvLogTarget.All,
            _ => throw new ArgumentException($"Unknown log target '{value}'. Expected `host`, `app`, or `all`.")
        };

    private static string RequireValue(IReadOnlyList<string> args, ref int index, string optionName) {
        if (index + 1 >= args.Count)
            throw new ArgumentException($"Missing value for {optionName}.");

        index++;
        return args[index];
    }
}
