namespace Pe.Dev.Cli;

internal enum RevitLogTarget {
    Host,
    App,
    All
}

internal sealed record RevitLogOptions(
    RevitLogTarget Target,
    int TailLineCount,
    bool PrintPathsOnly
) {
    private const int DefaultTailLineCount = 200;

    public static RevitLogOptions Parse(IReadOnlyList<string> args) {
        if (args.Count == 0)
            throw new ArgumentException("Missing log target. Expected `host`, `app`, or `all`.");

        var target = ParseTarget(args[0]);
        var tailLineCount = DefaultTailLineCount;
        var printPathsOnly = false;

        for (var i = 1; i < args.Count; i++) {
            var arg = args[i];
            switch (arg.ToLowerInvariant()) {
                case "--tail":
                case "-tail":
                    tailLineCount = int.Parse(
                        RequireValue(args, ref i, arg),
                        System.Globalization.CultureInfo.InvariantCulture
                    );
                    if (tailLineCount <= 0)
                        throw new ArgumentOutOfRangeException(nameof(args), "--tail must be greater than zero.");
                    break;
                case "--path":
                    printPathsOnly = true;
                    break;
                default:
                    throw new ArgumentException($"Unknown argument '{arg}' for logs.");
            }
        }

        return new RevitLogOptions(target, tailLineCount, printPathsOnly);
    }

    public IReadOnlyList<(string label, string filePath)> ResolveLogFiles() =>
        this.Target switch {
            RevitLogTarget.Host => [("host", LogFileLayout.HostLogPath)],
            RevitLogTarget.App => [("app", LogFileLayout.RevitAppLogPath)],
            RevitLogTarget.All => [("host", LogFileLayout.HostLogPath), ("app", LogFileLayout.RevitAppLogPath)],
            _ => throw new InvalidOperationException($"Unsupported log target '{this.Target}'.")
        };

    private static RevitLogTarget ParseTarget(string value) =>
        value.ToLowerInvariant() switch {
            "host" => RevitLogTarget.Host,
            "app" or "revit" => RevitLogTarget.App,
            "all" or "both" => RevitLogTarget.All,
            _ => throw new ArgumentException($"Unknown log target '{value}'. Expected `host`, `app`, or `all`.")
        };

    private static string RequireValue(IReadOnlyList<string> args, ref int index, string optionName) {
        if (index + 1 >= args.Count)
            throw new ArgumentException($"Missing value for {optionName}.");

        index++;
        return args[index];
    }
}
