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

    private static ApprovalWatcherLaunch StartApprovalWatcherForFreshLaunch(int revitYear, int timeoutSeconds, bool quiet) {
        var launchResult = CliProcessRelauncher.StartBackground(BuildApproveWorkerArguments(new RevitApproveOptions(
            timeoutSeconds,
            revitYear,
            true
        )));
        if (!launchResult.Success) {
            if (!quiet)
                Console.Error.WriteLine(launchResult.Message);
            return new ApprovalWatcherLaunch(launchResult.ExitCode, null, null);
        }
        if (!quiet)
            Console.Out.WriteLine(launchResult.Message);
        return new ApprovalWatcherLaunch(0, launchResult.ProcessId, launchResult.ProcessStartUtc);
    }

    private static void StopApprovalWatcherForFreshLaunch(ApprovalWatcherLaunch launch, RevitTestRunLog runLog, bool quiet) {
        if (launch.ProcessId is not { } processId) {
            runLog.Write("approval-watcher stop skipped no-process-id");
            return;
        }
        try {
            using var process = Process.GetProcessById(processId);
            if (process.HasExited) {
                runLog.Write($"approval-watcher already-exited pid={processId}");
                return;
            }
            if (launch.ProcessStartUtc.HasValue) {
                var processStartUtc = process.StartTime.ToUniversalTime();
                if (processStartUtc != launch.ProcessStartUtc.Value) {
                    runLog.Write($"approval-watcher stop skipped pid-reused pid={processId} expectedStartUtc={launch.ProcessStartUtc.Value:O} actualStartUtc={processStartUtc:O}");
                    return;
                }
            }
            process.Kill(entireProcessTree: true);
            var exited = process.WaitForExit(5000);
            runLog.Write($"approval-watcher stopped pid={processId} exited={exited}");
        } catch (ArgumentException) {
            runLog.Write($"approval-watcher already-exited pid={processId}");
        } catch (Exception ex) {
            runLog.Write($"approval-watcher stop failed pid={processId} {ex}");
            if (!quiet)
                Console.Error.WriteLine($"Warning: failed to stop approval watcher pid={processId}: {ex.Message}");
        }
    }

    private readonly record struct ApprovalWatcherLaunch(int ExitCode, int? ProcessId, DateTime? ProcessStartUtc);

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

        using var runLog = RevitTestRunLog.Create(repoRoot, options);
        if (!options.JsonOutput)
            Console.Out.WriteLine($"test log={runLog.FilePath}");
        runLog.Write($"repoRoot={repoRoot}");
        runLog.Write($"projectPath={projectPath}");
        runLog.Write($"args={string.Join(" ", forwardedArguments.Select(QuoteArgument))}");

        RevitTestExecutionPlan plan;
        try {
            var matrix = RevitTestBuildMatrix.Load(repoRoot);
            var sessions = SessionSelector.DiscoverSessions().ToList();
            foreach (var session in sessions)
                runLog.Write($"discovered-session {FormatSessionRecord("session", session)}");
            var ownedSessions = RevitTestOwnedSessionStore.GetLiveStates(matrix.SupportedRevitYears, sessions);
            foreach (var ownedSession in ownedSessions)
                runLog.Write($"owned-session year={ownedSession.RevitYear} pid={ownedSession.ProcessId} startUtc={ownedSession.ProcessStartUtc:O} configuration={ownedSession.Configuration} runtimeFingerprint={ownedSession.RuntimeFingerprint}");
            plan = RevitTestExecutionPlanner.Resolve(options, matrix, sessions, ownedSessions);
            runLog.Write($"plan configuration={plan.Configuration} revitYear={plan.RevitYear} filter={plan.Filter ?? "<none>"} noBuild={plan.NoBuild} deployedAddin={(plan.AllowDeployedAddin ? "allowed" : "quarantined")} planOnly={options.PlanOnly} timeoutSeconds={(options.TimeoutSeconds?.ToString(CultureInfo.InvariantCulture) ?? "none")} reason={plan.Reason}");
        } catch (Exception ex) {
            runLog.Write($"plan-failed {ex}");
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
                runLog.WriteProcessStart("build", buildStartInfo);
                buildResult = await ForegroundProcessRunner.RunDetailedAsync(
                    buildStartInfo,
                    echoOutput: !options.JsonOutput,
                    runCancellationToken,
                    stdoutLine: line => runLog.Write($"build stdout {line}"),
                    stderrLine: line => runLog.Write($"build stderr {line}"),
                    processStarted: process => runLog.Write($"build process-started pid={process.Id}"),
                    diagnosticLine: line => runLog.Write($"build {line}"));
                runLog.Write($"build exitCode={buildResult.ExitCode}");
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
        var approvalWatcherLaunch = StartApprovalWatcherForFreshLaunch(
            plan.RevitYear,
            TestApprovalWatcherTimeoutSeconds,
            quiet: options.JsonOutput
        );
        if (approvalWatcherLaunch.ExitCode != 0) {
            if (options.JsonOutput)
                WriteFreshTestJson(approvalWatcherLaunch.ExitCode, "Failed to start approval watcher for fresh Revit launch.", plan, runtimeFingerprint, buildResult, null, null, null, timeoutSeconds: options.TimeoutSeconds);
            return approvalWatcherLaunch.ExitCode;
        }
        try {
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
            var revitExecutablePath = ResolveRevitExecutablePath(plan.RevitYear);
            runLog.Write($"revitExecutablePath={revitExecutablePath}");
            testStartInfo.Environment.Remove("RICAUN_REVITTEST_TESTADAPTER_NUNIT_APPLICATION");
            runLog.Write("revitTestApplication=embedded-console");
            testStartInfo.Environment["RICAUN_REVITTEST_TESTADAPTER_NUNIT_VERSION"] =
                plan.RevitYear.ToString(CultureInfo.InvariantCulture);
            testStartInfo.Environment["RICAUN_REVITTEST_TESTADAPTER_NUNIT_OPEN"] =
                bool.TrueString;
            testStartInfo.Environment["RICAUN_REVITTEST_TESTADAPTER_NUNIT_CLOSE"] =
                bool.TrueString;

            var baselineSessions = SessionSelector.DiscoverSessions(plan.RevitYear);
            foreach (var session in baselineSessions)
                runLog.Write($"baseline-session {FormatSessionRecord("baseline", session)}");
            var baselineSessionIds = baselineSessions
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
                runLog,
                ownedSessionTrackingCts.Token
            );

            int testExitCode;
            string? testFailure = null;
            ForegroundProcessResult? testResult = null;
            try {
                runLog.WriteProcessStart("test", testStartInfo);
                testResult = await ForegroundProcessRunner.RunDetailedAsync(
                    testStartInfo,
                    echoOutput: !options.JsonOutput,
                    runCancellationToken,
                    stdoutLine: line => runLog.Write($"test stdout {line}"),
                    stderrLine: line => runLog.Write($"test stderr {line}"),
                    processStarted: process => runLog.Write($"test process-started pid={process.Id}"),
                    heartbeat: (process, elapsed) => LogTestHeartbeat(
                        runLog,
                        plan.RevitYear,
                        baselineSessionIds,
                        process,
                        elapsed),
                    diagnosticLine: line => runLog.Write($"test {line}"));
                testExitCode = testResult.ExitCode;
                runLog.Write($"test exitCode={testExitCode}");
            } catch (OperationCanceledException) when (timedOut()) {
                testExitCode = 124;
                testFailure = $"Fresh Revit verification timed out after {options.TimeoutSeconds} seconds during test run.";
                runLog.Write($"test timed-out timeoutSeconds={options.TimeoutSeconds}");
                if (!options.JsonOutput)
                    Console.Error.WriteLine(testFailure);
            } finally {
                ownedSessionTrackingCts.Cancel();
                await ownedSessionTracker;
            }

            runLog.Write("closing fresh test sessions");
            var closeExitCode = CloseFreshTestSessions(plan.RevitYear, baselineSessionIds, quiet: options.JsonOutput);
            runLog.Write($"close exitCode={closeExitCode}");
            var exitCode = closeExitCode != 0 ? closeExitCode : testExitCode;
            runLog.Write($"final exitCode={exitCode}");
            if (options.JsonOutput)
                WriteFreshTestJson(exitCode, exitCode == 0 ? null : testFailure ?? "Fresh Revit test run failed.", plan, runtimeFingerprint, buildResult, testResult, testExitCode, closeExitCode, timeoutSeconds: options.TimeoutSeconds);
            return exitCode;
        } finally {
            StopApprovalWatcherForFreshLaunch(approvalWatcherLaunch, runLog, quiet: options.JsonOutput);
        }
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
    private static void LogTestHeartbeat(
        RevitTestRunLog runLog,
        int revitYear,
        ISet<int> baselineSessionIds,
        Process testProcess,
        TimeSpan elapsed
    ) {
        runLog.Write($"test heartbeat pid={testProcess.Id} elapsedSeconds={(int)elapsed.TotalSeconds} hasExited={testProcess.HasExited}");
        var visibleSessions = SessionSelector.DiscoverSessions(revitYear).ToList();
        if (visibleSessions.Count == 0) {
            runLog.Write($"test heartbeat no-visible-revit-sessions revitYear={revitYear}");
            return;
        }
        foreach (var session in visibleSessions) {
            var baseline = baselineSessionIds.Contains(session.ProcessId) ? "baseline" : "candidate";
            runLog.Write($"test heartbeat-visible {FormatSessionRecord(baseline, session)}");
        }
    }
    private static string FormatSessionRecord(string label, RevitProcessSessionIdentity session) =>
        $"{label} pid={session.ProcessId} startUtc={session.ProcessStartUtc:O} revitYear={(session.RevitYear?.ToString(CultureInfo.InvariantCulture) ?? "unknown")} responding={session.Responding} hung={session.Hung} title=\"{session.MainWindowTitle}\"";
    private static string QuoteArgument(string argument) =>
        argument.Any(char.IsWhiteSpace)
            ? $"\"{argument.Replace("\"", "\\\"")}\""
            : argument;

    private static string ResolveRevitExecutablePath(int revitYear) {
        var path = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles),
            "Autodesk",
            $"Revit {revitYear}",
            "Revit.exe"
        );

        return File.Exists(path)
            ? path
            : throw new FileNotFoundException($"Could not find Revit {revitYear} executable at '{path}'.", path);
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
        bool quiet,
        RevitTestRunLog runLog,
        CancellationToken cancellationToken
    ) {
        try {
            var lastLoggedPollUtc = DateTime.MinValue;
            while (true) {
                cancellationToken.ThrowIfCancellationRequested();

                var visibleSessions = SessionSelector.DiscoverSessions(revitYear);
                if (DateTime.UtcNow - lastLoggedPollUtc > TimeSpan.FromSeconds(10)) {
                    lastLoggedPollUtc = DateTime.UtcNow;
                    foreach (var session in visibleSessions.Where(session => !baselineSessionIds.Contains(session.ProcessId)))
                        runLog.Write($"tracker-visible {FormatSessionRecord("candidate", session)}");
                }

                var ownedSession = visibleSessions
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

                    runLog.Write($"owned-test-session {FormatSessionRecord("selected", ownedSession)} runtimeFingerprint={runtimeFingerprint[..Math.Min(12, runtimeFingerprint.Length)]}");
                    if (!quiet)
                        Console.Out.WriteLine(
                            $"owned-test-session {FormatSessionRecord("selected", ownedSession)} runtimeFingerprint={runtimeFingerprint[..Math.Min(12, runtimeFingerprint.Length)]}");
                    return;
                }

                await Task.Delay(TimeSpan.FromMilliseconds(500), cancellationToken);
            }
        } catch (OperationCanceledException) {
            runLog.Write("owned-session tracker canceled");
        } catch (Exception ex) {
            runLog.Write($"owned-session tracker failed {ex}");
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

    private sealed class RevitTestRunLog : IDisposable {
        private readonly object _gate = new();
        private readonly StreamWriter _writer;

        private RevitTestRunLog(string filePath) {
            this.FilePath = filePath;
            Directory.CreateDirectory(Path.GetDirectoryName(filePath)!);
            this._writer = new StreamWriter(File.Open(filePath, FileMode.Create, FileAccess.Write, FileShare.ReadWrite)) {
                AutoFlush = true
            };
            this.Write("log-start");
        }

        public string FilePath { get; }

        public static RevitTestRunLog Create(string repoRoot, RevitTestCliOptions options) {
            var root = Path.Combine(repoRoot, ".artifacts", "logs", "pe-dev-test");
            var timestamp = DateTime.UtcNow.ToString("yyyyMMdd-HHmmss", CultureInfo.InvariantCulture);
            var filterSlug = SanitizeFileName(options.Filter ?? "all");
            var fileName = $"{timestamp}-{filterSlug}.log";
            return new RevitTestRunLog(Path.Combine(root, fileName));
        }

        public void WriteProcessStart(string label, ProcessStartInfo startInfo) {
            this.Write($"{label} command={QuoteArgument(startInfo.FileName)} {string.Join(" ", startInfo.ArgumentList.Select(QuoteArgument))}");
            foreach (var pair in startInfo.Environment
                         .Where(pair => pair.Key.StartsWith("RICAUN_REVITTEST_", StringComparison.OrdinalIgnoreCase))
                         .OrderBy(pair => pair.Key, StringComparer.Ordinal))
                this.Write($"{label} env {pair.Key}={pair.Value}");
        }

        public void Write(string message) {
            lock (this._gate) {
                this._writer.WriteLine($"{DateTime.UtcNow:O} {message}");
            }
        }

        public void Dispose() {
            this.Write("log-end");
            this._writer.Dispose();
        }

        private static string SanitizeFileName(string value) {
            var invalid = Path.GetInvalidFileNameChars().ToHashSet();
            var sanitized = new string(value
                .Select(ch => invalid.Contains(ch) || char.IsWhiteSpace(ch) ? '-' : ch)
                .ToArray());
            sanitized = sanitized.Trim('-');
            if (sanitized.Length == 0)
                return "all";
            return sanitized.Length <= 80 ? sanitized : sanitized[..80];
        }
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
