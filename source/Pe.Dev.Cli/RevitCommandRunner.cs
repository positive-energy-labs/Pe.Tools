using Pe.Dev.RevitAutomation;
using Pe.Shared.HostContracts.Protocol;
using System.Globalization;
using System.Diagnostics;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace Pe.Dev.Cli;

internal static class RevitCommandRunner {
    private const int TestApprovalWatcherTimeoutSeconds = 600;

    private static readonly RevitProcessSessionSelector SessionSelector = new();
    private static readonly RiderHotReloadService HotReloadService = new(SessionSelector);
    private static readonly RevitAddinApprovalWatcherService ApprovalWatcherService = new();
    private static readonly RevitTestOwnedSessionStateStore RevitTestOwnedSessionStore = RevitTestOwnedSessionStateStore.CreateDefault();
    private static readonly JsonSerializerOptions JsonOptions = CreateJsonOptions();

    public static Task<int> RunAsync(DevCliOptions options, CancellationToken cancellationToken) =>
        options.CommandKind switch {
            RevitCommandKind.Approve => Task.FromResult(RunApprove(options.CommandArguments)),
            RevitCommandKind.Automation => AutomationCliProgram.RunAsync(options.CommandArguments, options.RepoRoot, cancellationToken),
            RevitCommandKind.InternalApproveWorker => RunApproveWorkerAsync(options.CommandArguments, cancellationToken),
            RevitCommandKind.HotReload => RunHotReloadAsync(options.RepoRoot, options.CommandArguments, cancellationToken),
            RevitCommandKind.Logs => Task.FromResult(RunLogs(options.CommandArguments)),
            RevitCommandKind.Session => Task.FromResult(RunSession(options.CommandArguments)),
            RevitCommandKind.SyncRuntime => RunSyncRuntimeAsync(options.RepoRoot, options.CommandArguments, cancellationToken),
            RevitCommandKind.Test => RunTestAsync(options.RepoRoot, options.CommandArguments, cancellationToken),
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
        WriteHotReloadResult(result);
        return result.Kind == RevitHotReloadResultKind.Failed ? 1 : 0;
    }

    private static async Task<int> RunSyncRuntimeAsync(
        string? repoRootOverride,
        IReadOnlyList<string> forwardedArguments,
        CancellationToken cancellationToken
    ) {
        if (forwardedArguments.Count > 0) {
            Console.Error.WriteLine("`pe-dev revit sync-runtime` does not accept additional arguments.");
            return 10;
        }

        string repoRoot;
        try {
            repoRoot = RepoRootResolver.Resolve(repoRootOverride);
        } catch (Exception ex) {
            Console.Error.WriteLine(ex.Message);
            return 10;
        }

        var initialReport = CreateSessionReport(
            SessionSelector.DiscoverSessions().ToList(),
            RevitSessionHostClient.TryGetStatus()
        );

        if (initialReport.SelectedProcessSession is null) {
            WriteHostStatusSummary(initialReport.HostStatus);
            Console.Error.WriteLine("No visible local Revit process sessions found.");
            return GetSessionExitCode(initialReport);
        }

        var selectedSession = initialReport.SelectedProcessSession;
        Console.Out.WriteLine($"sync-runtime {FormatSessionRecord("selected", selectedSession)}");
        WriteHostStatusSummary(initialReport.HostStatus);

        if (!selectedSession.Responding || selectedSession.Hung) {
            Console.Error.WriteLine(
                $"Selected Revit session PID {selectedSession.ProcessId} is not healthy enough for hot reload (responding={selectedSession.Responding}, hung={selectedSession.Hung}).");
            return 2;
        }

        var hotReloadResult = await HotReloadService.RunAsync(repoRoot, cancellationToken);
        WriteHotReloadResult(hotReloadResult);
        if (hotReloadResult.Kind != RevitHotReloadResultKind.Triggered)
            return hotReloadResult.Kind == RevitHotReloadResultKind.NoSession ? 3 : 1;

        var postReport = CreateSessionReport(
            SessionSelector.DiscoverSessions().ToList(),
            RevitSessionHostClient.TryGetStatus()
        );
        if (postReport.SelectedProcessSession is null) {
            WriteHostStatusSummary(postReport.HostStatus);
            Console.Error.WriteLine("Revit session was not visible after hot reload completed.");
            return 2;
        }

        Console.Out.WriteLine($"post-sync {FormatSessionRecord("selected", postReport.SelectedProcessSession)}");
        WriteHostStatusSummary(postReport.HostStatus);

        if (!postReport.SelectedProcessSession.Responding || postReport.SelectedProcessSession.Hung) {
            Console.Error.WriteLine(
                $"Selected Revit session PID {postReport.SelectedProcessSession.ProcessId} became unhealthy after hot reload (responding={postReport.SelectedProcessSession.Responding}, hung={postReport.SelectedProcessSession.Hung}).");
            return 2;
        }

        return 0;
    }

    private static async Task<int> RunTestAsync(
        string? repoRootOverride,
        IReadOnlyList<string> forwardedArguments,
        CancellationToken cancellationToken
    ) {
        RevitTestCliOptions options;
        try {
            options = RevitTestCliOptions.Parse(forwardedArguments);
        } catch (Exception ex) {
            Console.Error.WriteLine(ex.Message);
            return 10;
        }

        string repoRoot;
        try {
            repoRoot = RepoRootResolver.Resolve(repoRootOverride);
        } catch (Exception ex) {
            Console.Error.WriteLine(ex.Message);
            return 10;
        }

        var projectPath = Path.Combine(repoRoot, "source", "Pe.Revit.Tests", "Pe.Revit.Tests.csproj");
        if (!File.Exists(projectPath)) {
            Console.Error.WriteLine($"Could not find test project at '{projectPath}'.");
            return 10;
        }

        RevitTestExecutionPlan plan;
        try {
            var matrix = RevitTestBuildMatrix.Load(repoRoot);
            var sessions = SessionSelector.DiscoverSessions().ToList();
            var ownedSessions = RevitTestOwnedSessionStore.GetLiveStates(matrix.SupportedRevitYears, sessions);
            plan = RevitTestExecutionPlanner.Resolve(options, matrix, sessions, ownedSessions);
        } catch (Exception ex) {
            Console.Error.WriteLine(ex.Message);
            return 10;
        }

        Console.Out.WriteLine(
            $"revit test configuration={plan.Configuration} revitYear={plan.RevitYear} noBuild={plan.NoBuild} deployedAddin={(plan.AllowDeployedAddin ? "allowed" : "quarantined")} reason={plan.Reason}");

        RevitTestOutputLayout outputLayout;
        if (plan.NoBuild) {
            try {
                outputLayout = RevitTestOutputLayout.Resolve(repoRoot, plan.Configuration);
            } catch (Exception ex) {
                Console.Error.WriteLine(ex.Message);
                return 10;
            }

            if (!File.Exists(outputLayout.AssemblyPath)) {
                Console.Error.WriteLine(
                    $"`pe-dev revit test --no-build` expected an existing test assembly at '{outputLayout.AssemblyPath}', but it was not found. Re-run without `--no-build` or build configuration '{plan.Configuration}' first."
                );
                return 10;
            }
        }

        if (!plan.NoBuild) {
            var buildStartInfo = CreateDotNetStartInfo(
                repoRoot,
                "build",
                projectPath,
                "-c",
                plan.Configuration,
                "/p:WarningLevel=0"
            );
            var buildExitCode = await ForegroundProcessRunner.RunAsync(buildStartInfo, cancellationToken);
            if (buildExitCode != 0)
                return buildExitCode;
        }

        try {
            outputLayout = RevitTestOutputLayout.Resolve(repoRoot, plan.Configuration);
        } catch (Exception ex) {
            Console.Error.WriteLine(ex.Message);
            return 10;
        }

        string runtimeFingerprint;
        try {
            runtimeFingerprint = RevitTestRuntimeFingerprint.Compute(outputLayout.OutputDirectory);
        } catch (Exception ex) {
            Console.Error.WriteLine(ex.Message);
            return 10;
        }

        var launchMode = RevitTestLaunchMode.LaunchFreshOwnedSession;

        Console.Out.WriteLine(
            $"revit test launchMode={launchMode} runtimeFingerprint={runtimeFingerprint[..Math.Min(12, runtimeFingerprint.Length)]}");

        if (plan.OwnedSession is not null) {
            try {
                TerminateOwnedTestSession(plan.OwnedSession);
                RevitTestOwnedSessionStore.Delete(plan.RevitYear);
            } catch (Exception ex) {
                Console.Error.WriteLine($"Failed to recycle owned Revit test session: {ex.Message}");
                return 1;
            }
        }

        var approvalWatcherExitCode = StartApprovalWatcherForFreshLaunch(
            plan.RevitYear,
            TestApprovalWatcherTimeoutSeconds
        );
        if (approvalWatcherExitCode != 0)
            return approvalWatcherExitCode;

        var testStartInfo = CreateDotNetStartInfo(
            repoRoot,
            "test",
            projectPath,
            "-c",
            plan.Configuration,
            "--no-build"
        );
        if (!string.IsNullOrWhiteSpace(plan.Filter)) {
            testStartInfo.ArgumentList.Add("--filter");
            testStartInfo.ArgumentList.Add(plan.Filter);
        }

        testStartInfo.Environment["RICAUN_REVITTEST_TESTADAPTER_NUNIT_VERSION"] =
            plan.RevitYear.ToString(CultureInfo.InvariantCulture);
        testStartInfo.Environment["RICAUN_REVITTEST_TESTADAPTER_NUNIT_OPEN"] =
            bool.TrueString;
        testStartInfo.Environment["RICAUN_REVITTEST_TESTADAPTER_NUNIT_CLOSE"] =
            bool.FalseString;
        testStartInfo.Environment["PE_REVIT_TEST_ORCHESTRATED"] = "1";

        var baselineSessionIds = SessionSelector.DiscoverSessions(plan.RevitYear)
            .Select(session => session.ProcessId)
            .ToHashSet();

        using var quarantine = !plan.AllowDeployedAddin
            ? RevitAddinQuarantine.CreateForPeApp(plan.RevitYear)
            : null;

        if (quarantine is not null) {
            try {
                quarantine.Initialize();
                Console.Out.WriteLine(quarantine.Describe());
            } catch (Exception ex) {
                Console.Error.WriteLine(
                    $"Failed to quarantine deployed add-in for Revit {plan.RevitYear}: {ex.Message}"
                );
                return 1;
            }
        }

        var testExitCode = await ForegroundProcessRunner.RunAsync(testStartInfo, cancellationToken);
        PersistOwnedTestSession(
            plan.RevitYear,
            plan.Configuration,
            runtimeFingerprint,
            baselineSessionIds
        );
        return testExitCode;
    }

    private static int RunSession(IReadOnlyList<string> forwardedArguments) {
        RevitSessionOptions options;
        try {
            options = RevitSessionOptions.Parse(forwardedArguments);
        } catch (Exception ex) {
            Console.Error.WriteLine(ex.Message);
            return 10;
        }

        var report = CreateSessionReport(
            SessionSelector.DiscoverSessions().ToList(),
            RevitSessionHostClient.TryGetStatus()
        );
        if (options.JsonOutput) {
            Console.WriteLine(JsonSerializer.Serialize(report, JsonOptions));
            return GetSessionExitCode(report);
        }

        if (report.HostStatus != null) {
            Console.WriteLine(
                $"host reachable bridgeConnected={report.HostStatus.BridgeIsConnected} connectedSessions={report.HostStatus.Sessions.Count} defaultSessionId={(report.HostStatus.DefaultSessionId ?? "none")} activeDocument=\"{report.HostStatus.ActiveDocumentTitle ?? "None"}\"");
            foreach (var hostSession in report.HostStatus.Sessions) {
                Console.WriteLine(
                    $"host-session sessionId={hostSession.SessionId} pid={hostSession.ProcessId} revitVersion={hostSession.RevitVersion} activeDocument=\"{hostSession.ActiveDocumentTitle ?? "None"}\" openDocuments={hostSession.OpenDocumentCount}");
            }
        } else {
            Console.WriteLine($"host unreachable baseUrl={RevitSessionHostClient.GetHostBaseUrl()}");
        }

        if (report.SelectedProcessSession is null) {
            Console.WriteLine("No visible local Revit process sessions found.");
            return GetSessionExitCode(report);
        }

        Console.WriteLine(FormatSessionRecord("selected", report.SelectedProcessSession));
        foreach (var session in report.ProcessSessions)
            Console.WriteLine(FormatSessionRecord("candidate", session));

        return GetSessionExitCode(report);
    }

    internal static RevitSessionReport CreateSessionReport(
        IReadOnlyList<RevitProcessSessionIdentity> processSessions,
        HostStatusData? hostStatus
    ) {
        var orderedSessions = processSessions
            .OrderByDescending(session => session.ProcessStartUtc)
            .ToList();
        return new RevitSessionReport(
            hostStatus,
            orderedSessions,
            orderedSessions.FirstOrDefault()
        );
    }

    internal static int GetSessionExitCode(RevitSessionReport report) => report.HasAnySessions ? 0 : 3;

    private static string FormatSessionRecord(string label, RevitProcessSessionIdentity session) =>
        $"{label} pid={session.ProcessId} startUtc={session.ProcessStartUtc:O} revitYear={(session.RevitYear?.ToString(CultureInfo.InvariantCulture) ?? "unknown")} responding={session.Responding} hung={session.Hung} title=\"{session.MainWindowTitle}\"";

    private static void WriteHostStatusSummary(HostStatusData? hostStatus) {
        if (hostStatus == null) {
            Console.Out.WriteLine($"host unreachable baseUrl={RevitSessionHostClient.GetHostBaseUrl()}");
            return;
        }

        Console.Out.WriteLine(
            $"host reachable bridgeConnected={hostStatus.BridgeIsConnected} connectedSessions={hostStatus.Sessions.Count} defaultSessionId={(hostStatus.DefaultSessionId ?? "none")} activeDocument=\"{hostStatus.ActiveDocumentTitle ?? "None"}\"");
    }

    private static void WriteHotReloadResult(RevitHotReloadResult result) {
        var output = result.Kind is RevitHotReloadResultKind.Failed
            ? Console.Error
            : Console.Out;
        output.WriteLine(result.Message);
    }

    private static IReadOnlyList<string> BuildApproveWorkerArguments(RevitApproveOptions options) {
        var arguments = new List<string> { "__internal", "approve-worker", "--timeout-seconds", options.TimeoutSeconds.ToString(CultureInfo.InvariantCulture) };
        if (options.RevitYear.HasValue) {
            arguments.Add("--revit-year");
            arguments.Add(options.RevitYear.Value.ToString(CultureInfo.InvariantCulture));
        }

        return arguments;
    }

    private static int StartApprovalWatcherForFreshLaunch(int revitYear, int timeoutSeconds) {
        var options = new RevitApproveOptions(timeoutSeconds, revitYear, true);
        var launchResult = CliProcessRelauncher.StartBackground(BuildApproveWorkerArguments(options));
        if (!launchResult.Success) {
            Console.Error.WriteLine(launchResult.Message);
            return launchResult.ExitCode;
        }

        Console.Out.WriteLine(
            $"Approval watcher started for Revit {revitYear} (timeoutSeconds={timeoutSeconds})."
        );
        return 0;
    }

    private static ProcessStartInfo CreateDotNetStartInfo(string workingDirectory, params string[] arguments) {
        var startInfo = new ProcessStartInfo("dotnet") {
            WorkingDirectory = workingDirectory,
            UseShellExecute = false,
            RedirectStandardOutput = true,
            RedirectStandardError = true
        };

        foreach (var argument in arguments)
            startInfo.ArgumentList.Add(argument);

        return startInfo;
    }

    private static void PersistOwnedTestSession(
        int revitYear,
        string configuration,
        string runtimeFingerprint,
        ISet<int>? baselineSessionIds
    ) {
        var sessions = SessionSelector.DiscoverSessions(revitYear);
        if (sessions.Count == 0) {
            RevitTestOwnedSessionStore.Delete(revitYear);
            return;
        }

        var selectedSession = baselineSessionIds is null
            ? sessions.FirstOrDefault()
            : sessions.FirstOrDefault(session => !baselineSessionIds.Contains(session.ProcessId)) ?? sessions.FirstOrDefault();
        if (selectedSession is null)
            return;

        RevitTestOwnedSessionStore.Save(
            new RevitTestOwnedSessionState(
                revitYear,
                selectedSession.ProcessId,
                selectedSession.ProcessStartUtc,
                configuration,
                runtimeFingerprint,
                DateTime.UtcNow
            )
        );

        Console.Out.WriteLine($"owned-test-session {FormatSessionRecord("selected", selectedSession)}");
    }

    private static void TerminateOwnedTestSession(RevitTestOwnedSessionState sessionState) {
        using var process = Process.GetProcessById(sessionState.ProcessId);
        if (process.HasExited)
            return;

        var processStartUtc = process.StartTime.ToUniversalTime();
        if (processStartUtc != sessionState.ProcessStartUtc) {
            throw new InvalidOperationException(
                $"PID {sessionState.ProcessId} no longer matches the owned test session start time."
            );
        }

        process.Kill(entireProcessTree: true);
        process.WaitForExit(10000);
        Console.Out.WriteLine(
            $"recycled owned test Revit pid={sessionState.ProcessId} revitYear={sessionState.RevitYear}"
        );
    }

    private static JsonSerializerOptions CreateJsonOptions() {
        var options = new JsonSerializerOptions(JsonSerializerDefaults.Web) {
            DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull
        };
        options.Converters.Add(new JsonStringEnumConverter());
        return options;
    }
}
