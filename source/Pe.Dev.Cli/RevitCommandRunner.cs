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

    internal static Task<int> RunApproveWorkerCommandAsync(IReadOnlyList<string> forwardedArguments, CancellationToken cancellationToken) =>
        RunApproveWorkerAsync(forwardedArguments, cancellationToken);

    internal static Task<int> RunSyncRuntimeCommandAsync(string? repoRootOverride, IReadOnlyList<string> forwardedArguments, CancellationToken cancellationToken) =>
        RunSyncRuntimeAsync(repoRootOverride, forwardedArguments, cancellationToken);

    internal static Task<int> RunFreshTestCommandAsync(string? repoRootOverride, IReadOnlyList<string> forwardedArguments, CancellationToken cancellationToken) =>
        RunTestAsync(repoRootOverride, forwardedArguments, cancellationToken);

    internal static int RunSessionCommand(IReadOnlyList<string> forwardedArguments) => RunSession(forwardedArguments);

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

        if (!options.RunInline) {
            var launchResult = CliProcessRelauncher.StartBackground(BuildApproveWorkerArguments(options with { RunInline = true }));
            if (!launchResult.Success) {
                Console.Error.WriteLine(launchResult.Message);
                return launchResult.ExitCode;
            }

            Console.WriteLine(launchResult.Message);
            return 0;
        }

        return await ApprovalWatcherService.RunAsync(options.TimeoutSeconds, options.RevitYear, cancellationToken);
    }

    internal static async Task<int> RunHotReloadCommandAsync(
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
            RevitSessionHostClient.TryGetProbe(),
            RevitSessionHostClient.TryGetSessionSummary()
        );

        if (initialReport.SelectedProcessSession is null) {
            WriteHostStatusSummary(initialReport);
            Console.Error.WriteLine("No visible local Revit process sessions found.");
            return GetSessionExitCode(initialReport);
        }

        var selectedSession = initialReport.SelectedProcessSession;
        Console.Out.WriteLine($"sync-runtime {FormatSessionRecord("selected", selectedSession)}");
        WriteHostStatusSummary(initialReport);

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
            RevitSessionHostClient.TryGetProbe(),
            RevitSessionHostClient.TryGetSessionSummary()
        );
        if (postReport.SelectedProcessSession is null) {
            WriteHostStatusSummary(postReport);
            Console.Error.WriteLine("Revit session was not visible after hot reload completed.");
            return 2;
        }

        Console.Out.WriteLine($"post-sync {FormatSessionRecord("selected", postReport.SelectedProcessSession)}");
        WriteHostStatusSummary(postReport);

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

        RevitTestOutputLayout outputLayout;
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
        testStartInfo.ArgumentList.Add("/p:PeRevitRawDotNetTestWarningSuppressed=true");
        testStartInfo.ArgumentList.Add("/p:PeVerifyTarget=FreshRevitProcess");

        testStartInfo.Environment["RICAUN_REVITTEST_TESTADAPTER_NUNIT_VERSION"] =
            plan.RevitYear.ToString(CultureInfo.InvariantCulture);
        testStartInfo.Environment["RICAUN_REVITTEST_TESTADAPTER_NUNIT_OPEN"] =
            bool.TrueString;
        testStartInfo.Environment["RICAUN_REVITTEST_TESTADAPTER_NUNIT_CLOSE"] =
            bool.TrueString;

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

        using var ownedSessionTrackingCts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        var ownedSessionTracker = TrackFreshOwnedSessionAsync(
            plan.RevitYear,
            plan.Configuration,
            runtimeFingerprint,
            baselineSessionIds,
            ownedSessionTrackingCts.Token
        );

        int testExitCode;
        try {
            testExitCode = await ForegroundProcessRunner.RunAsync(testStartInfo, cancellationToken);
        } finally {
            ownedSessionTrackingCts.Cancel();
            await ownedSessionTracker;
        }

        var closeExitCode = CloseFreshTestSessions(plan.RevitYear, baselineSessionIds);
        return closeExitCode != 0 ? closeExitCode : testExitCode;
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
            RevitSessionHostClient.TryGetProbe(),
            RevitSessionHostClient.TryGetSessionSummary()
        );
        if (options.RequireAttachedRrd) {
            var failure = TryResolveAttachedRrdFailure(report, options.RevitYear!.Value);
            if (failure is not null) {
                Console.Error.WriteLine(failure);
                return 3;
            }
        }

        if (options.JsonOutput) {
            Console.WriteLine(JsonSerializer.Serialize(report, JsonOptions));
            return options.RequireAttachedRrd ? 0 : GetSessionExitCode(report);
        }

        if (report.HostProbe != null) {
            var summary = report.HostSessionSummary;
            Console.WriteLine(
                $"host reachable bridgeConnected={(summary?.BridgeIsConnected ?? report.HostProbe.BridgeIsConnected)} activeDocument=\"{summary?.ActiveDocument?.Title ?? "None"}\" revitVersion={(summary?.RevitVersion ?? "unknown")}");
        } else {
            Console.WriteLine($"host unreachable baseUrl={RevitSessionHostClient.GetHostBaseUrl()}");
        }

        if (report.SelectedProcessSession is null) {
            Console.WriteLine("No visible local Revit process sessions found.");
            return options.RequireAttachedRrd ? 0 : GetSessionExitCode(report);
        }

        Console.WriteLine(FormatSessionRecord("selected", report.SelectedProcessSession));
        foreach (var session in report.ProcessSessions)
            Console.WriteLine(FormatSessionRecord("candidate", session));

        return options.RequireAttachedRrd ? 0 : GetSessionExitCode(report);
    }

    internal static RevitSessionReport CreateSessionReport(
        IReadOnlyList<RevitProcessSessionIdentity> processSessions,
        HostProbeData? hostProbe,
        HostSessionSummaryData? hostSessionSummary
    ) {
        var orderedSessions = processSessions
            .OrderByDescending(session => session.ProcessStartUtc)
            .ToList();
        return new RevitSessionReport(
            hostProbe,
            hostSessionSummary,
            orderedSessions,
            orderedSessions.FirstOrDefault()
        );
    }

    internal static int GetSessionExitCode(RevitSessionReport report) => report.HasAnySessions ? 0 : 3;

    private static string FormatSessionRecord(string label, RevitProcessSessionIdentity session) =>
        $"{label} pid={session.ProcessId} startUtc={session.ProcessStartUtc:O} revitYear={(session.RevitYear?.ToString(CultureInfo.InvariantCulture) ?? "unknown")} responding={session.Responding} hung={session.Hung} title=\"{session.MainWindowTitle}\"";

    private static void WriteHostStatusSummary(RevitSessionReport report) {
        if (report.HostProbe == null) {
            Console.Out.WriteLine($"host unreachable baseUrl={RevitSessionHostClient.GetHostBaseUrl()}");
            return;
        }

        var summary = report.HostSessionSummary;
        Console.Out.WriteLine(
            $"host reachable bridgeConnected={(summary?.BridgeIsConnected ?? report.HostProbe.BridgeIsConnected)} activeDocument=\"{summary?.ActiveDocument?.Title ?? "None"}\" revitVersion={(summary?.RevitVersion ?? "unknown")}");
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
        if (options.RunInline)
            arguments.Add("--run-inline");

        return arguments;
    }

    private static int StartApprovalWatcherForFreshLaunch(int revitYear, int timeoutSeconds) {
        var options = new RevitApproveOptions(timeoutSeconds, revitYear, false);
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

    private static string? TryResolveAttachedRrdFailure(RevitSessionReport report, int requiredRevitYear) {
        if (report.HostProbe is null) {
            return
                $"AttachedRrd verification for Revit {requiredRevitYear} requires a live Rider-driven `Pe.App` session, but `Pe.Host` was unreachable. Start the matching RRD session, run `pe-dev revit sync-runtime`, and retry.";
        }

        var summary = report.HostSessionSummary;
        var bridgeConnected = summary?.BridgeIsConnected ?? report.HostProbe.BridgeIsConnected;
        if (!bridgeConnected) {
            return
                $"AttachedRrd verification for Revit {requiredRevitYear} requires the live `Pe.App` bridge to be connected. Start the matching RRD session, run `pe-dev revit sync-runtime`, and retry.";
        }

        if (!int.TryParse(summary?.RevitVersion, NumberStyles.None, CultureInfo.InvariantCulture, out var bridgedYear)) {
            return
                $"AttachedRrd verification for Revit {requiredRevitYear} requires host session metadata with the active Revit year. Start the matching RRD session, confirm `pe-dev revit session` reports a bridged Revit version, then retry.";
        }

        if (bridgedYear != requiredRevitYear) {
            return
                $"AttachedRrd verification requested Revit {requiredRevitYear}, but the live bridged RRD session is Revit {bridgedYear}. Start or retarget the matching Rider-driven session, run `pe-dev revit sync-runtime`, and retry.";
        }

        var matchingVisibleSession = report.ProcessSessions.FirstOrDefault(session =>
            session.RevitYear == requiredRevitYear &&
            session.Responding &&
            !session.Hung
        );
        return matchingVisibleSession is null
            ? $"AttachedRrd verification requested Revit {requiredRevitYear}, but no healthy visible local Revit {requiredRevitYear} session was found. Start the matching RRD session, run `pe-dev revit sync-runtime`, and retry."
            : null;
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

    private static async Task TrackFreshOwnedSessionAsync(
        int revitYear,
        string configuration,
        string runtimeFingerprint,
        ISet<int> baselineSessionIds,
        CancellationToken cancellationToken
    ) {
        try {
            while (true) {
                cancellationToken.ThrowIfCancellationRequested();

                var ownedSession = SessionSelector.DiscoverSessions(revitYear)
                    .Where(session =>
                        !baselineSessionIds.Contains(session.ProcessId) &&
                        session.Responding &&
                        !session.Hung
                    )
                    .OrderByDescending(session => session.ProcessStartUtc)
                    .FirstOrDefault();
                if (ownedSession is not null) {
                    RevitTestOwnedSessionStore.Save(
                        new RevitTestOwnedSessionState(
                            revitYear,
                            ownedSession.ProcessId,
                            ownedSession.ProcessStartUtc,
                            configuration,
                            runtimeFingerprint,
                            DateTime.UtcNow
                        )
                    );

                    Console.Out.WriteLine(
                        $"owned-test-session {FormatSessionRecord("selected", ownedSession)} runtimeFingerprint={runtimeFingerprint[..Math.Min(12, runtimeFingerprint.Length)]}");
                    return;
                }

                await Task.Delay(TimeSpan.FromMilliseconds(500), cancellationToken);
            }
        } catch (OperationCanceledException) {
        } catch (Exception ex) {
            Console.Error.WriteLine(
                $"Failed to record owned Revit test session for Revit {revitYear}: {ex.Message}");
        }
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

    private static int CloseFreshTestSessions(int revitYear, ISet<int> baselineSessionIds) {
        var visibleSessions = SessionSelector.DiscoverSessions(revitYear)
            .ToArray();
        var ownedSession = RevitTestOwnedSessionStore.TryGetLiveState(revitYear, visibleSessions);
        if (ownedSession is not null) {
            try {
                TerminateOwnedTestSession(ownedSession);
                RevitTestOwnedSessionStore.Delete(revitYear);
                return 0;
            } catch (Exception ex) {
                Console.Error.WriteLine(
                    $"Failed to close owned fresh test Revit session pid={ownedSession.ProcessId} revitYear={revitYear}: {ex.Message}");
                return 1;
            }
        }

        var sessionsToClose = visibleSessions
            .Where(session => !baselineSessionIds.Contains(session.ProcessId))
            .OrderByDescending(session => session.ProcessStartUtc)
            .ToArray();
        if (sessionsToClose.Length == 0) {
            RevitTestOwnedSessionStore.Delete(revitYear);
            return 0;
        }

        if (sessionsToClose.Length > 1) {
            Console.Error.WriteLine(
                $"Unable to close fresh test Revit sessions for Revit {revitYear} because no owned-session record was available and multiple new sessions were found: {string.Join(", ", sessionsToClose.Select(session => $"pid={session.ProcessId} startUtc={session.ProcessStartUtc:O}"))}");
            return 1;
        }

        var inferredSession = sessionsToClose[0];
        try {
            using var process = Process.GetProcessById(inferredSession.ProcessId);
            if (process.HasExited) {
                RevitTestOwnedSessionStore.Delete(revitYear);
                return 0;
            }

            process.Kill(entireProcessTree: true);
            process.WaitForExit(10000);
            RevitTestOwnedSessionStore.Delete(revitYear);
            Console.Out.WriteLine(
                $"closed inferred fresh test Revit pid={inferredSession.ProcessId} revitYear={revitYear}");
        } catch (Exception ex) {
            Console.Error.WriteLine(
                $"Failed to close inferred fresh test Revit session pid={inferredSession.ProcessId} revitYear={revitYear}: {ex.Message}");
            return 1;
        }

        return 0;
    }

    private static JsonSerializerOptions CreateJsonOptions() {
        var options = new JsonSerializerOptions(JsonSerializerDefaults.Web) {
            DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull
        };
        options.Converters.Add(new JsonStringEnumConverter());
        return options;
    }
}
