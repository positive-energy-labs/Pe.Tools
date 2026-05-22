using Pe.Shared.Product;
using System.Globalization;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace Pe.Dev.Cli;

internal static class VerifyDoctorCommand {
    private const int SchemaVersion = 1;
    private static readonly JsonSerializerOptions JsonOptions = CreateJsonOptions();

    public static int Run(IReadOnlyList<string> args) {
        VerifyDoctorOptions options;
        try {
            options = VerifyDoctorOptions.Parse(args);
        } catch (Exception ex) {
            Console.Error.WriteLine(ex.Message);
            return VerifyDoctorExitCodes.CommandLineError;
        }

        var localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        var applicationData = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
        var installedRuntime = ProductRuntimeLayout.ForCurrentUser(localAppData);
        var developmentRuntime = ProductDevelopmentRuntimeLayout.ForCurrentUser(localAppData);
        var sessionReport = RevitCommandRunner.CreateCurrentSessionReport();
        var runtimeComparison = RuntimeAssemblyGraph.CompareLoadedToDisk(sessionReport.HostSessionSummary);
        var attachedFailure = options.RequireAttachedRrd
            ? RevitCommandRunner.TryResolveAttachedRrdFailure(sessionReport, options.RevitYear!.Value)
            : null;

        var environmentChecks = CreateEnvironmentChecks().ToArray();
        var installedHostExists = File.Exists(installedRuntime.Binaries.HostExecutablePath);
        var devHostExists = File.Exists(developmentRuntime.Binaries.HostExecutablePath);
        var devPeDevExists = File.Exists(developmentRuntime.Binaries.PeDevDllPath);
        var peaLauncherExists = File.Exists(installedRuntime.Binaries.PeaLauncherPath);
        var issues = CreateIssues(
            environmentChecks,
            installedHostExists,
            devHostExists,
            devPeDevExists,
            peaLauncherExists,
            runtimeComparison.Mismatches.Count,
            options.RequireAttachedRrd,
            attachedFailure
        ).ToArray();
        var exitCode = GetExitCode(issues);
        var report = new VerifyDoctorReport(
            SchemaVersion: SchemaVersion,
            Command: "doctor",
            Outcome: GetOutcome(exitCode),
            ExitCode: exitCode,
            Issues: issues,
            RecommendedNextSteps: CreateRecommendedNextSteps(issues, sessionReport.HostProbe is not null, sessionReport.HostSessionSummary?.BridgeIsConnected ?? sessionReport.HostProbe?.BridgeIsConnected ?? false).ToArray(),
            EnvironmentChecks: environmentChecks,
            InstalledHostExists: installedHostExists,
            DevHostExists: devHostExists,
            DevPeDevExists: devPeDevExists,
            PeaLauncherExists: peaLauncherExists,
            RuntimeDescriptors: EnumerateRuntimeDescriptors(applicationData).ToArray(),
            HostReachable: sessionReport.HostProbe is not null,
            BridgeConnected: sessionReport.HostSessionSummary?.BridgeIsConnected ?? sessionReport.HostProbe?.BridgeIsConnected ?? false,
            VisibleRevitSessionCount: sessionReport.ProcessSessions.Count,
            SelectedRevitYear: sessionReport.SelectedProcessSession?.RevitYear,
            ActiveDocumentTitle: sessionReport.HostSessionSummary?.ActiveDocument?.Title,
            LoadedRuntimeAssemblyCount: sessionReport.HostSessionSummary?.RuntimeAssemblies?.Count ?? 0,
            StaleRuntimeAssemblyCount: runtimeComparison.Mismatches.Count,
            UncheckedRuntimeAssemblyCount: runtimeComparison.MissingLocations.Count,
            AttachedRrdFailure: attachedFailure
        );

        if (options.JsonOutput) {
            Console.WriteLine(JsonSerializer.Serialize(report, JsonOptions));
            return exitCode;
        }

        WriteHumanReport(report);
        WriteGuidance(options, report);
        return exitCode;
    }

    private static IEnumerable<VerifyDoctorEnvironmentCheck> CreateEnvironmentChecks() {
        string[] requiredVariables = ["ProgramFiles", "APPDATA", "LOCALAPPDATA", "USERPROFILE", "TEMP", "TMP"];
        foreach (var variable in requiredVariables) {
            var value = Environment.GetEnvironmentVariable(variable);
            yield return new VerifyDoctorEnvironmentCheck(variable, !string.IsNullOrWhiteSpace(value), value);
        }
    }

    private static IEnumerable<VerifyDoctorIssue> CreateIssues(
        IReadOnlyList<VerifyDoctorEnvironmentCheck> environmentChecks,
        bool installedHostExists,
        bool devHostExists,
        bool devPeDevExists,
        bool peaLauncherExists,
        int staleRuntimeAssemblyCount,
        bool requireAttachedRrd,
        string? attachedFailure
    ) {
        var missingEnvVars = environmentChecks.Where(check => !check.Ok).Select(check => check.Name).ToArray();
        if (missingEnvVars.Length > 0)
            yield return new VerifyDoctorIssue(
                "windows-env-incomplete",
                VerifyDoctorIssueSeverity.Error,
                $"Missing required Windows/dotnet environment variables: {string.Join(", ", missingEnvVars)}."
            );

        if (!installedHostExists)
            yield return new VerifyDoctorIssue("installed-host-missing", VerifyDoctorIssueSeverity.Error, "Installed Pe.Host runtime was not found.");
        if (!devHostExists)
            yield return new VerifyDoctorIssue("dev-host-missing", VerifyDoctorIssueSeverity.Error, "Development Pe.Host runtime was not found.");
        if (!devPeDevExists)
            yield return new VerifyDoctorIssue("dev-pe-dev-missing", VerifyDoctorIssueSeverity.Error, "Development pe-dev runtime was not found.");
        if (!peaLauncherExists)
            yield return new VerifyDoctorIssue("pea-launcher-missing", VerifyDoctorIssueSeverity.Error, "Installed pea launcher was not found.");

        if (staleRuntimeAssemblyCount > 0)
            yield return new VerifyDoctorIssue("stale-runtime-assemblies", VerifyDoctorIssueSeverity.Error, $"Loaded RRD runtime has {staleRuntimeAssemblyCount} stale assemblies compared to disk.");

        if (requireAttachedRrd && !string.IsNullOrWhiteSpace(attachedFailure))
            yield return new VerifyDoctorIssue("attached-rrd-unavailable", VerifyDoctorIssueSeverity.Error, attachedFailure);
    }

    private static IEnumerable<string> CreateRecommendedNextSteps(
        IReadOnlyList<VerifyDoctorIssue> issues,
        bool hostReachable,
        bool bridgeConnected
    ) {
        if (issues.Any(issue => issue.Code == "windows-env-incomplete")) {
            yield return "Use `./tools/dotnet-sandbox-safe.ps1 <dotnet args>` for build/test commands in this shell.";
            yield break;
        }

        if (issues.Any(issue => issue.Code is "installed-host-missing" or "dev-host-missing" or "dev-pe-dev-missing" or "pea-launcher-missing"))
            yield return "Build `source/Pe.Dev.Cli/Pe.Dev.Cli.csproj` and run `pe-dev pea install-dev` if local runtime mirrors are missing.";

        if (issues.Any(issue => issue.Code == "stale-runtime-assemblies"))
            yield return "Run `pe-dev sync`; if stale assemblies remain, restart RRD or use `pe-dev test ...`.";

        if (issues.Any(issue => issue.Code == "attached-rrd-unavailable"))
            yield return "Start the matching Rider-driven RRD session, run `pe-dev sync`, then retry attached validation.";

        if (issues.Count == 0 && hostReachable && bridgeConnected) {
            yield return "Run `pe-dev sync` before live scripting/tests when runtime code changed.";
            yield return "Use `pe-dev test ...` when process-fresh proof matters more than current document/session state.";
            yield break;
        }

        if (issues.Count == 0) {
            yield return "Use plain `dotnet build` for compile checks and `pe-dev test ...` for deterministic Revit-backed proof.";
            yield return "Start RRD and run `pe-dev sync` before `pea script ...` or attached `.Tests` validation.";
        }
    }

    private static IEnumerable<VerifyDoctorRuntimeDescriptor> EnumerateRuntimeDescriptors(string applicationData) {
        var addinsRoot = RevitDeploymentIdentity.ResolvePerUserAddinsRootPath(applicationData);
        if (!Directory.Exists(addinsRoot))
            yield break;

        foreach (var addinDirectory in Directory.EnumerateDirectories(addinsRoot)) {
            var yearSegment = Path.GetFileName(addinDirectory);
            if (!int.TryParse(yearSegment, NumberStyles.None, CultureInfo.InvariantCulture, out var revitYear))
                continue;

            var descriptorPath = RevitDeploymentIdentity.ResolvePerUserRuntimeDescriptorPath(revitYear, applicationData);
            if (PeAppRuntimeDeploymentDescriptor.TryLoad(descriptorPath, out var descriptor) && descriptor is not null) {
                yield return new VerifyDoctorRuntimeDescriptor(revitYear, descriptorPath, descriptor.RuntimeLane.ToString(), "runtime-descriptor");
                continue;
            }

            if (File.Exists(descriptorPath))
                yield return new VerifyDoctorRuntimeDescriptor(revitYear, descriptorPath, ProductRuntimeLane.Installed.ToString(), "invalid-runtime-descriptor-default");
        }
    }

    private static void WriteHumanReport(VerifyDoctorReport report) {
        Console.WriteLine($"doctor outcome={report.Outcome} exitCode={report.ExitCode} issues={report.Issues.Count}");
        foreach (var issue in report.Issues)
            Console.WriteLine($"issue severity={issue.Severity} code={issue.Code} message=\"{issue.Message}\"");

        foreach (var check in report.EnvironmentChecks)
            Console.WriteLine($"env-var name={check.Name} ok={check.Ok} value=\"{check.Value ?? ""}\"");

        Console.WriteLine($"runtime installedHost={report.InstalledHostExists} devHost={report.DevHostExists} devPeDev={report.DevPeDevExists} peaLauncher={report.PeaLauncherExists}");
        if (report.RuntimeDescriptors.Count == 0)
            Console.WriteLine("runtime-descriptor none");
        foreach (var descriptor in report.RuntimeDescriptors)
            Console.WriteLine($"runtime-descriptor revitYear={descriptor.RevitYear} lane={descriptor.RuntimeLane} source={descriptor.Source} path=\"{descriptor.DescriptorPath}\"");

        Console.WriteLine($"session hostReachable={report.HostReachable} bridgeConnected={report.BridgeConnected} visibleRevitSessions={report.VisibleRevitSessionCount} selectedRevitYear={(report.SelectedRevitYear?.ToString(CultureInfo.InvariantCulture) ?? "unknown")} activeDocument=\"{report.ActiveDocumentTitle ?? "None"}\"");
        Console.WriteLine($"runtime-freshness loadedAssemblies={report.LoadedRuntimeAssemblyCount} staleAssemblies={report.StaleRuntimeAssemblyCount} uncheckedAssemblies={report.UncheckedRuntimeAssemblyCount}");
        if (!string.IsNullOrWhiteSpace(report.AttachedRrdFailure))
            Console.WriteLine($"attached-rrd failure=\"{report.AttachedRrdFailure}\"");
    }

    private static void WriteGuidance(VerifyDoctorOptions options, VerifyDoctorReport report) {
        if (report.Issues.Any(issue => issue.Code == "windows-env-incomplete")) {
            AgentGuidanceWriter.Write(Console.Out, report.Issues.First(issue => issue.Code == "windows-env-incomplete").Message, report.RecommendedNextSteps.ToArray());
            return;
        }

        if (options.RequireAttachedRrd && !string.IsNullOrWhiteSpace(report.AttachedRrdFailure)) {
            AgentGuidanceWriter.WriteAttachedPreflightFailed(Console.Out, options.RevitYear!.Value, report.AttachedRrdFailure);
            return;
        }

        if (report.StaleRuntimeAssemblyCount > 0) {
            AgentGuidanceWriter.WriteRuntimeAssembliesStale(Console.Out, report.StaleRuntimeAssemblyCount);
            return;
        }

        if (report.Issues.Count > 0) {
            AgentGuidanceWriter.Write(Console.Out, "Local runtime preflight failed.", report.RecommendedNextSteps.ToArray());
            return;
        }

        if (report.HostReachable && report.BridgeConnected) {
            AgentGuidanceWriter.Write(Console.Out, "AttachedRrd host and bridge are reachable.", report.RecommendedNextSteps.ToArray());
            return;
        }

        AgentGuidanceWriter.Write(Console.Out, "No fully attached RRD bridge is available right now.", report.RecommendedNextSteps.ToArray());
    }

    private static int GetExitCode(IReadOnlyList<VerifyDoctorIssue> issues) {
        if (issues.Any(issue => issue.Code is "windows-env-incomplete" or "installed-host-missing" or "dev-host-missing" or "dev-pe-dev-missing" or "pea-launcher-missing"))
            return VerifyDoctorExitCodes.LocalEnvironmentFailed;
        if (issues.Any(issue => issue.Code == "attached-rrd-unavailable"))
            return VerifyDoctorExitCodes.AttachedRrdUnavailable;
        if (issues.Any(issue => issue.Code == "stale-runtime-assemblies"))
            return VerifyDoctorExitCodes.StaleRuntimeAssemblies;
        return VerifyDoctorExitCodes.Passed;
    }

    private static string GetOutcome(int exitCode) => exitCode == VerifyDoctorExitCodes.Passed ? "passed" : "failed";

    private static JsonSerializerOptions CreateJsonOptions() {
        var options = new JsonSerializerOptions(JsonSerializerDefaults.Web) {
            DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
            Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping
        };
        options.Converters.Add(new JsonStringEnumConverter());
        return options;
    }
}

internal static class VerifyDoctorExitCodes {
    public const int Passed = 0;
    public const int LocalEnvironmentFailed = 2;
    public const int AttachedRrdUnavailable = 3;
    public const int StaleRuntimeAssemblies = 4;
    public const int CommandLineError = 10;
}

internal sealed record VerifyDoctorOptions(bool JsonOutput, int? RevitYear, bool RequireAttachedRrd) {
    public static VerifyDoctorOptions Parse(IReadOnlyList<string> args) {
        var jsonOutput = false;
        int? revitYear = null;
        var requireAttachedRrd = false;

        for (var i = 0; i < args.Count; i++) {
            switch (args[i].ToLowerInvariant()) {
            case "--json":
                jsonOutput = true;
                break;
            case "--revit-year":
                if (i + 1 >= args.Count)
                    throw new ArgumentException("Missing value for --revit-year.");
                revitYear = RevitTestCliOptions.ParseYear(args[++i]);
                break;
            case "--require-attached-rrd":
                requireAttachedRrd = true;
                break;
            default:
                throw new ArgumentException($"Unknown doctor option '{args[i]}'. Supported options: --json, --revit-year <year>, --require-attached-rrd.");
            }
        }

        if (requireAttachedRrd && !revitYear.HasValue)
            throw new ArgumentException("doctor --require-attached-rrd requires --revit-year <year>.");

        return new VerifyDoctorOptions(jsonOutput, revitYear, requireAttachedRrd);
    }
}

internal sealed record VerifyDoctorReport(
    int SchemaVersion,
    string Command,
    string Outcome,
    int ExitCode,
    IReadOnlyList<VerifyDoctorIssue> Issues,
    IReadOnlyList<string> RecommendedNextSteps,
    IReadOnlyList<VerifyDoctorEnvironmentCheck> EnvironmentChecks,
    bool InstalledHostExists,
    bool DevHostExists,
    bool DevPeDevExists,
    bool PeaLauncherExists,
    IReadOnlyList<VerifyDoctorRuntimeDescriptor> RuntimeDescriptors,
    bool HostReachable,
    bool BridgeConnected,
    int VisibleRevitSessionCount,
    int? SelectedRevitYear,
    string? ActiveDocumentTitle,
    int LoadedRuntimeAssemblyCount,
    int StaleRuntimeAssemblyCount,
    int UncheckedRuntimeAssemblyCount,
    string? AttachedRrdFailure
);

internal sealed record VerifyDoctorIssue(string Code, VerifyDoctorIssueSeverity Severity, string Message);

internal enum VerifyDoctorIssueSeverity {
    Warning,
    Error
}

internal sealed record VerifyDoctorEnvironmentCheck(string Name, bool Ok, string? Value);

internal sealed record VerifyDoctorRuntimeDescriptor(int RevitYear, string DescriptorPath, string RuntimeLane, string Source);
