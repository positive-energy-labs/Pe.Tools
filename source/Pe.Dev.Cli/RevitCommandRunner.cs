using Pe.Dev.RevitAutomation;
using System.Globalization;
using System.Diagnostics;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace Pe.Dev.Cli;

internal static class RevitCommandRunner {
    private const int TestApprovalWatcherTimeoutSeconds = 600;

    private static readonly RevitProcessSessionSelector SessionSelector = new();
    private static readonly RevitAddinApprovalWatcherService ApprovalWatcherService = new();
    private static readonly RevitTestOwnedSessionStateStore RevitTestOwnedSessionStore = RevitTestOwnedSessionStateStore.CreateDefault();
    private static readonly JsonSerializerOptions JsonOptions = CreateJsonOptions();

    internal static Task<int> RunApproveWorkerCommandAsync(IReadOnlyList<string> forwardedArguments, CancellationToken cancellationToken) =>
        RunApproveWorkerAsync(forwardedArguments, cancellationToken);

    internal static Task<int> RunFreshTestCommandAsync(string? repoRootOverride, IReadOnlyList<string> forwardedArguments, CancellationToken cancellationToken) =>
        RunTestAsync(repoRootOverride, forwardedArguments, cancellationToken);

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

    private static IReadOnlyList<string> BuildApproveWorkerArguments(RevitApproveOptions options) {
        var arguments = new List<string> {
            "__internal",
            "approve-worker",
            "--timeout-seconds",
            options.TimeoutSeconds.ToString(CultureInfo.InvariantCulture)
        };
        if (options.RevitYear.HasValue) {
            arguments.Add("--revit-year");
            arguments.Add(options.RevitYear.Value.ToString(CultureInfo.InvariantCulture));
        }
        if (options.RunInline)
            arguments.Add("--run-inline");
        return arguments;
    }

    private static int StartApprovalWatcherForFreshLaunch(int revitYear, int timeoutSeconds, bool quiet) {
        var launchResult = CliProcessRelauncher.StartBackground(BuildApproveWorkerArguments(new RevitApproveOptions(
            timeoutSeconds,
            revitYear,
            true
        )));
        if (!launchResult.Success) {
            if (!quiet)
                Console.Error.WriteLine(launchResult.Message);
            return launchResult.ExitCode;
        }

        if (!quiet)
            Console.Out.WriteLine(launchResult.Message);
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
            if (ArgsRequestJson(forwardedArguments))
                WriteFreshTestJson(10, ex.Message, null, null, null, null, null, null);
            else
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
            if (options.JsonOutput)
                WriteFreshTestJson(10, ex.Message, null, null, null, null, null, null);
            else
                Console.Error.WriteLine(ex.Message);
            return 10;
        }

        if (!options.JsonOutput) {
            Console.Out.WriteLine(
                $"test lane=FreshOwnedRevit configuration={plan.Configuration} revitYear={plan.RevitYear} noBuild={plan.NoBuild} deployedAddin={(plan.AllowDeployedAddin ? "allowed" : "quarantined")} planOnly={options.PlanOnly} timeoutSeconds={(options.TimeoutSeconds?.ToString(CultureInfo.InvariantCulture) ?? "none")} reason={plan.Reason}");
            if (options.PlanOnly)
                Console.Out.WriteLine("plan only: no build, Revit launch, test run, quarantine, or session cleanup will be performed.");
            else
                AgentGuidanceWriter.WriteFreshOwnedLane(Console.Out, plan.RevitYear);
        }

        if (options.PlanOnly) {
            if (options.JsonOutput)
                WriteFreshTestJson(0, null, plan, null, null, null, null, null, planOnly: true, timeoutSeconds: options.TimeoutSeconds);
            return 0;
        }

        using var timeoutCts = options.TimeoutSeconds.HasValue
            ? CancellationTokenSource.CreateLinkedTokenSource(cancellationToken)
            : null;
        if (timeoutCts is not null)
            timeoutCts.CancelAfter(TimeSpan.FromSeconds(options.TimeoutSeconds!.Value));
        var runCancellationToken = timeoutCts?.Token ?? cancellationToken;
        var timedOut = () => timeoutCts?.IsCancellationRequested == true && !cancellationToken.IsCancellationRequested;

        ForegroundProcessResult? buildResult = null;
        if (!plan.NoBuild) {
            var buildStartInfo = CreateDotNetStartInfo(
                repoRoot,
                "build",
                projectPath,
                "-c",
                plan.Configuration,
                "/p:WarningLevel=0"
            );
            try {
                buildResult = await ForegroundProcessRunner.RunDetailedAsync(buildStartInfo, echoOutput: !options.JsonOutput, runCancellationToken);
            } catch (OperationCanceledException) when (timedOut()) {
                if (options.JsonOutput)
                    WriteFreshTestJson(124, $"Fresh Revit verification timed out after {options.TimeoutSeconds} seconds during build.", plan, null, buildResult, null, null, null, timeoutSeconds: options.TimeoutSeconds);
                else
                    Console.Error.WriteLine($"Fresh Revit verification timed out after {options.TimeoutSeconds} seconds during build.");
                return 124;
            }
            if (buildResult.ExitCode != 0) {
                if (options.JsonOutput)
                    WriteFreshTestJson(buildResult.ExitCode, "Fresh Revit test build failed.", plan, null, buildResult, null, null, null, timeoutSeconds: options.TimeoutSeconds);
                return buildResult.ExitCode;
            }
        }

        RevitTestOutputLayout outputLayout;
        try {
            outputLayout = RevitTestOutputLayout.Resolve(repoRoot, plan.Configuration);
        } catch (Exception ex) {
            if (options.JsonOutput)
                WriteFreshTestJson(10, ex.Message, plan, null, buildResult, null, null, null, timeoutSeconds: options.TimeoutSeconds);
            else
                Console.Error.WriteLine(ex.Message);
            return 10;
        }

        string runtimeFingerprint;
        try {
            runtimeFingerprint = RevitTestRuntimeFingerprint.Compute(outputLayout.OutputDirectory);
        } catch (Exception ex) {
            if (options.JsonOutput)
                WriteFreshTestJson(10, ex.Message, plan, null, buildResult, null, null, null, timeoutSeconds: options.TimeoutSeconds);
            else
                Console.Error.WriteLine(ex.Message);
            return 10;
        }

        var launchMode = RevitTestLaunchMode.LaunchFreshOwnedSession;

        if (!options.JsonOutput)
            Console.Out.WriteLine(
                $"test launchMode={launchMode} runtimeFingerprint={runtimeFingerprint[..Math.Min(12, runtimeFingerprint.Length)]}");

        if (plan.OwnedSession is not null) {
            try {
                TerminateOwnedTestSession(plan.OwnedSession, quiet: options.JsonOutput);
                RevitTestOwnedSessionStore.Delete(plan.RevitYear);
            } catch (Exception ex) {
                if (options.JsonOutput)
                    WriteFreshTestJson(1, $"Failed to recycle owned Revit test session: {ex.Message}", plan, runtimeFingerprint, buildResult, null, null, null, timeoutSeconds: options.TimeoutSeconds);
                else
                    Console.Error.WriteLine($"Failed to recycle owned Revit test session: {ex.Message}");
                return 1;
            }
        }

        var approvalWatcherExitCode = StartApprovalWatcherForFreshLaunch(
            plan.RevitYear,
            TestApprovalWatcherTimeoutSeconds,
            quiet: options.JsonOutput
        );
        if (approvalWatcherExitCode != 0) {
            if (options.JsonOutput)
                WriteFreshTestJson(approvalWatcherExitCode, "Failed to start approval watcher for fresh Revit launch.", plan, runtimeFingerprint, buildResult, null, null, null, timeoutSeconds: options.TimeoutSeconds);
            return approvalWatcherExitCode;
        }

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
                if (!options.JsonOutput)
                    Console.Out.WriteLine(quarantine.Describe());
            } catch (Exception ex) {
                var failure = $"Failed to quarantine deployed add-in for Revit {plan.RevitYear}: {ex.Message}";
                if (options.JsonOutput)
                    WriteFreshTestJson(1, failure, plan, runtimeFingerprint, buildResult, null, null, null, timeoutSeconds: options.TimeoutSeconds);
                else
                    Console.Error.WriteLine(failure);
                return 1;
            }
        }

        using var ownedSessionTrackingCts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        var ownedSessionTracker = TrackFreshOwnedSessionAsync(
            plan.RevitYear,
            plan.Configuration,
            runtimeFingerprint,
            baselineSessionIds,
            options.JsonOutput,
            ownedSessionTrackingCts.Token
        );

        int testExitCode;
        string? testFailure = null;
        ForegroundProcessResult? testResult = null;
        try {
            testResult = await ForegroundProcessRunner.RunDetailedAsync(testStartInfo, echoOutput: !options.JsonOutput, runCancellationToken);
            testExitCode = testResult.ExitCode;
        } catch (OperationCanceledException) when (timedOut()) {
            testExitCode = 124;
            testFailure = $"Fresh Revit verification timed out after {options.TimeoutSeconds} seconds during test run.";
            if (!options.JsonOutput)
                Console.Error.WriteLine(testFailure);
        } finally {
            ownedSessionTrackingCts.Cancel();
            await ownedSessionTracker;
        }

        var closeExitCode = CloseFreshTestSessions(plan.RevitYear, baselineSessionIds, quiet: options.JsonOutput);
        var exitCode = closeExitCode != 0 ? closeExitCode : testExitCode;
        if (options.JsonOutput)
            WriteFreshTestJson(exitCode, exitCode == 0 ? null : testFailure ?? "Fresh Revit test run failed.", plan, runtimeFingerprint, buildResult, testResult, testExitCode, closeExitCode, timeoutSeconds: options.TimeoutSeconds);
        return exitCode;
    }

    private static void WriteFreshTestJson(
        int exitCode,
        string? failure,
        RevitTestExecutionPlan? plan,
        string? runtimeFingerprint,
        ForegroundProcessResult? buildResult,
        ForegroundProcessResult? testResult,
        int? testExitCode,
        int? closeExitCode,
        bool planOnly = false,
        int? timeoutSeconds = null
    ) {
        Console.WriteLine(JsonSerializer.Serialize(
            new RevitFreshTestReport(
                1,
                "test",
                planOnly ? "planned" : exitCode == 0 ? "passed" : "failed",
                exitCode,
                failure,
                plan is null ? null : new RevitFreshTestPlanSummary(
                    plan.Configuration,
                    plan.RevitYear,
                    plan.Filter,
                    plan.NoBuild,
                    plan.AllowDeployedAddin,
                    timeoutSeconds,
                    !plan.NoBuild && !planOnly,
                    !planOnly,
                    !plan.AllowDeployedAddin && !planOnly,
                    plan.Reason
                ),
                planOnly,
                runtimeFingerprint,
                buildResult?.ExitCode,
                testExitCode,
                closeExitCode,
                buildResult?.StdoutTail ?? [],
                buildResult?.StderrTail ?? [],
                testResult?.StdoutTail ?? [],
                testResult?.StderrTail ?? []
            ),
            JsonOptions
        ));
    }

    private static string FormatSessionRecord(string label, RevitProcessSessionIdentity session) =>
        $"{label} pid={session.ProcessId} startUtc={session.ProcessStartUtc:O} revitYear={(session.RevitYear?.ToString(CultureInfo.InvariantCulture) ?? "unknown")} responding={session.Responding} hung={session.Hung} title=\"{session.MainWindowTitle}\"";

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
        bool quiet,
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

                    if (!quiet)
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

    private static void TerminateOwnedTestSession(RevitTestOwnedSessionState sessionState, bool quiet = false) {
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
        if (!quiet)
            Console.Out.WriteLine(
                $"recycled owned test Revit pid={sessionState.ProcessId} revitYear={sessionState.RevitYear}"
            );
    }

    private static int CloseFreshTestSessions(int revitYear, ISet<int> baselineSessionIds, bool quiet = false) {
        var visibleSessions = SessionSelector.DiscoverSessions(revitYear)
            .ToArray();
        var ownedSession = RevitTestOwnedSessionStore.TryGetLiveState(revitYear, visibleSessions);
        if (ownedSession is not null) {
            try {
                TerminateOwnedTestSession(ownedSession, quiet);
                RevitTestOwnedSessionStore.Delete(revitYear);
                return 0;
            } catch (Exception ex) {
                if (!quiet)
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
            if (!quiet)
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
            if (!quiet)
                Console.Out.WriteLine(
                    $"closed inferred fresh test Revit pid={inferredSession.ProcessId} revitYear={revitYear}");
        } catch (Exception ex) {
            if (!quiet)
                Console.Error.WriteLine(
                    $"Failed to close inferred fresh test Revit session pid={inferredSession.ProcessId} revitYear={revitYear}: {ex.Message}");
            return 1;
        }

        return 0;
    }

    private static bool ArgsRequestJson(IReadOnlyList<string> args) =>
        args.Any(arg => string.Equals(arg, "--json", StringComparison.OrdinalIgnoreCase));

    private static JsonSerializerOptions CreateJsonOptions() {
        var options = new JsonSerializerOptions(JsonSerializerDefaults.Web) {
            DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
            Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping
        };
        options.Converters.Add(new JsonStringEnumConverter());
        return options;
    }
}
