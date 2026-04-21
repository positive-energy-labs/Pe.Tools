using System.Globalization;
using Pe.Dev.RevitAutomation;

namespace Pe.Dev.Cli;

internal static class RevitCommandRunner {
    private static readonly RevitProcessSessionSelector SessionSelector = new();
    private static readonly RiderHotReloadService HotReloadService = new(SessionSelector);
    private static readonly RevitAddinApprovalWatcherService ApprovalWatcherService = new();

    public static Task<int> RunAsync(DevCliOptions options, CancellationToken cancellationToken) =>
        options.CommandKind switch {
            RevitCommandKind.Approve => Task.FromResult(RunApprove(options.CommandArguments)),
            RevitCommandKind.Automation => AutomationCliProgram.RunAsync(options.CommandArguments, options.RepoRoot, cancellationToken),
            RevitCommandKind.InternalApproveWorker => RunApproveWorkerAsync(options.CommandArguments, cancellationToken),
            RevitCommandKind.HotReload => RunHotReloadAsync(options.RepoRoot, options.CommandArguments, cancellationToken),
            RevitCommandKind.Logs => Task.FromResult(RunLogs(options.CommandArguments)),
            RevitCommandKind.Session => Task.FromResult(RunSession()),
            RevitCommandKind.Script => ScriptCliProgram.RunAsync(options.CommandArguments.ToArray(), options.RepoRoot, cancellationToken),
            _ => Task.FromResult(10)
        };

    private static int RunLogs(IReadOnlyList<string> forwardedArguments) {
        RevitLogOptions options;
        try {
            options = RevitLogOptions.Parse(forwardedArguments);
        } catch (Exception ex) {
            Console.Error.WriteLine(ex.Message);
            return 10;
        }

        foreach (var (label, filePath) in options.ResolveLogFiles()) {
            Console.WriteLine($"== {label} log ==");
            Console.WriteLine(filePath);

            var lines = File.Exists(filePath)
                ? File.ReadAllLines(filePath)
                : [];
            var startIndex = Math.Max(0, lines.Length - options.TailLineCount);
            if (lines.Length == 0)
                Console.WriteLine("(empty)");
            else {
                for (var i = startIndex; i < lines.Length; i++)
                    Console.WriteLine(lines[i]);
            }

            Console.WriteLine();
        }

        return 0;
    }

    private static int RunApprove(IReadOnlyList<string> forwardedArguments) {
        RevitApproveOptions options;
        try {
            options = RevitApproveOptions.Parse(forwardedArguments);
        } catch (Exception ex) {
            Console.Error.WriteLine(ex.Message);
            return 10;
        }

        if (options.SkipIfSessionExists && SessionSelector.SelectNewestVisibleSession(options.RevitYear) is not null) {
            var scope = options.RevitYear.HasValue
                ? $"Revit {options.RevitYear.Value}"
                : "Revit";
            Console.WriteLine($"Skipped approval watcher because an existing {scope} session is already running.");
            return 0;
        }

        var launchResult = CliProcessRelauncher.StartBackground(
            BuildApproveWorkerArguments(options)
        );

        if (!launchResult.Success) {
            Console.Error.WriteLine(launchResult.Message);
            return launchResult.ExitCode;
        }

        Console.WriteLine(launchResult.Message);
        return 0;
    }

    private static async Task<int> RunApproveWorkerAsync(
        IReadOnlyList<string> forwardedArguments,
        CancellationToken cancellationToken
    ) {
        RevitApproveOptions options;
        try {
            options = RevitApproveOptions.Parse(forwardedArguments);
        } catch (Exception ex) {
            Console.Error.WriteLine(ex.Message);
            return 10;
        }

        return await ApprovalWatcherService.RunAsync(options.TimeoutSeconds, options.RevitYear, cancellationToken);
    }

    private static async Task<int> RunHotReloadAsync(
        string? repoRootOverride,
        IReadOnlyList<string> forwardedArguments,
        CancellationToken cancellationToken
    ) {
        if (forwardedArguments.Count > 0) {
            Console.Error.WriteLine("`pe-dev revit hot-reload` does not accept additional arguments.");
            return 10;
        }

        string repoRoot;
        try {
            repoRoot = RepoRootResolver.Resolve(repoRootOverride);
        } catch (Exception ex) {
            Console.Error.WriteLine(ex.Message);
            return 10;
        }

        var result = await HotReloadService.RunAsync(repoRoot, cancellationToken);
        var output = result.Kind is RevitHotReloadResultKind.Failed
            ? Console.Error
            : Console.Out;
        output.WriteLine(result.Message);
        return result.Kind == RevitHotReloadResultKind.Failed ? 1 : 0;
    }

    private static int RunSession() {
        var sessions = SessionSelector.DiscoverSessions();
        var selectedSession = sessions.FirstOrDefault();
        if (selectedSession is null) {
            Console.WriteLine("No Revit sessions found.");
            return 3;
        }

        Console.WriteLine(FormatSessionRecord("selected", selectedSession));
        foreach (var session in sessions)
            Console.WriteLine(FormatSessionRecord("candidate", session));

        return 0;
    }

    private static string FormatSessionRecord(string label, RevitProcessSessionIdentity session) =>
        $"{label} pid={session.ProcessId} startUtc={session.ProcessStartUtc:O} revitYear={(session.RevitYear?.ToString(CultureInfo.InvariantCulture) ?? "unknown")} title=\"{session.MainWindowTitle}\"";

    private static IReadOnlyList<string> BuildApproveWorkerArguments(RevitApproveOptions options) {
        var arguments = new List<string> { "__internal", "approve-worker", "--timeout-seconds", options.TimeoutSeconds.ToString(CultureInfo.InvariantCulture) };
        if (options.RevitYear.HasValue) {
            arguments.Add("--revit-year");
            arguments.Add(options.RevitYear.Value.ToString(CultureInfo.InvariantCulture));
        }

        return arguments;
    }
}
