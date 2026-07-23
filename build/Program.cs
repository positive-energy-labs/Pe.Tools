using Build;
using Build.Modules;
using Build.Options;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Logging;
using ModularPipelines;
using ModularPipelines.Enums;
using ModularPipelines.Extensions;
using ModularPipelines.Logging;



var environment = WindowsDotnetEnvironment.Snapshot();
var builder = Pipeline.CreateBuilder();
builder.Options.ExecutionMode = ModularPipelines.Options.ExecutionMode.StopOnFirstException;
builder.Options.PrintDependencyChains = false;
builder.Options.PrintLogo = false;
builder.Options.PrintResults = true;
builder.Options.ShowProgressInConsole = true;
builder.Options.ThrowOnPipelineFailure = false;

builder.Configuration.AddJsonFile("appsettings.json");
builder.Configuration.AddUserSecrets<Program>();
builder.Configuration.AddEnvironmentVariables();
builder.Services.Replace(ServiceDescriptor.Singleton<IExceptionOutputFormatter, BuildExceptionOutputFormatter>());
builder.Services.AddLogging(logging => logging.AddFilter("ModularPipelines", LogLevel.Critical));

builder.Services.AddOptions<BuildOptions>().Bind(builder.Configuration.GetSection("Build"));
builder.Services.AddOptions<BundleOptions>().Bind(builder.Configuration.GetSection("Bundle"));
builder.Services.AddOptions<PublishOptions>().Bind(builder.Configuration.GetSection("Publish"));

BuildCliArguments parsedArgs;
try {
    parsedArgs = BuildCliArguments.Parse(args);
} catch (Exception exception) {
#pragma warning disable ConsoleUse
    using var standardError = new StreamWriter(Console.OpenStandardError());
    standardError.WriteLine(exception.Message);
#pragma warning restore ConsoleUse
    Environment.ExitCode = 1;
    return;
}

var isPublish = parsedArgs.Commands.Contains("publish");
var isDistributionBuild = isPublish
    || string.Equals(Environment.GetEnvironmentVariable("PeDistributionBuild"), "true", StringComparison.OrdinalIgnoreCase);
var hasConfiguredSigningIdentity =
    !string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable("PeCodeSignThumbprint"))
    || !string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable("PeCodeSignPfx"));

if (isPublish
    && !hasConfiguredSigningIdentity) {
#pragma warning disable ConsoleUse
    using var standardError = new StreamWriter(Console.OpenStandardError());
    standardError.WriteLine("Publish requires an explicit production PeCodeSignThumbprint or PeCodeSignPfx; the local SDK development certificate is acceptance-only.");
#pragma warning restore ConsoleUse
    Environment.ExitCode = 1;
    return;
}
if (isDistributionBuild
    && hasConfiguredSigningIdentity
    && string.Equals(Environment.GetEnvironmentVariable("PeSignTimestamp"), "false", StringComparison.OrdinalIgnoreCase)) {
#pragma warning disable ConsoleUse
    using var standardError = new StreamWriter(Console.OpenStandardError());
    standardError.WriteLine("Distribution signing requires RFC3161 timestamping; PeSignTimestamp=false is development-only.");
#pragma warning restore ConsoleUse
    Environment.ExitCode = 1;
    return;
}

builder.Services.PostConfigure<BuildOptions>(options =>
    options.Configuration = parsedArgs.Configuration ?? options.Configuration);

if (parsedArgs.Commands.Contains("pack")) {
    _ = builder.Services.AddModule<CleanProjectModule>();

    if (parsedArgs.PackTargets.Contains(PackTarget.Desktop))
        _ = builder.Services.AddModule<CreateBundleModule>();

    if (parsedArgs.PackTargets.Contains(PackTarget.Installer))
        _ = builder.Services.AddModule<CreateInstallerModule>();
}

if (parsedArgs.Commands.Contains("publish"))
    _ = builder.Services.AddModule<PublishGithubModule>();

var pipeline = builder.Build();
var loggerProvider = pipeline.RootServices.GetRequiredService<IModuleLoggerProvider>();

if (environment.IsUnsafe) {
    using var logger = loggerProvider.GetLogger();
    WindowsDotnetEnvironment.WriteFailure(logger, environment);
    Environment.ExitCode = 1;
    return;
}

try {
    var summary = await pipeline.RunAsync();
    if (summary.Status is not (Status.Successful or Status.UsedHistory))
        Environment.ExitCode = 1;
} catch (Exception exception) {
    using var logger = loggerProvider.GetLogger();
    BuildFailureLogger.Write(logger, exception);
    Environment.ExitCode = 1;
}


namespace Build {
    internal sealed class BuildExceptionOutputFormatter : IExceptionOutputFormatter {
        public void FormatAndOutput(IEnumerable<string> exceptionOutput) {
        }
    }

    internal sealed record WindowsDotnetEnvironment(
        string? ProgramFiles,
        string? ProgramFilesX86,
        string? AppData,
        string? LocalAppData,
        string? UserProfile,
        string? SystemRoot,
        string? ComSpec
    ) {
        public bool IsUnsafe => OperatingSystem.IsWindows() && Values.Any(string.IsNullOrWhiteSpace);

        private IEnumerable<string?> Values => [ProgramFiles, ProgramFilesX86, AppData, LocalAppData, UserProfile, SystemRoot, ComSpec];

        public static WindowsDotnetEnvironment Snapshot() => new(
            Environment.GetEnvironmentVariable("ProgramFiles"),
            Environment.GetEnvironmentVariable("ProgramFiles(x86)"),
            Environment.GetEnvironmentVariable("APPDATA"),
            Environment.GetEnvironmentVariable("LOCALAPPDATA"),
            Environment.GetEnvironmentVariable("USERPROFILE"),
            Environment.GetEnvironmentVariable("SystemRoot"),
            Environment.GetEnvironmentVariable("ComSpec")
        );

        public static void WriteFailure(IModuleLogger logger, WindowsDotnetEnvironment environment) {
            logger.LogError("Unsafe Windows dotnet environment. Missing Windows environment variables can poison NuGet/MSBuild build servers and cause restore failures like 'Value cannot be null. (Parameter path1)'.");
            logger.LogError("ProgramFiles='{ProgramFiles}', ProgramFiles(x86)='{ProgramFilesX86}', APPDATA='{AppData}', LOCALAPPDATA='{LocalAppData}', USERPROFILE='{UserProfile}', SystemRoot='{SystemRoot}', ComSpec='{ComSpec}'",
                environment.ProgramFiles,
                environment.ProgramFilesX86,
                environment.AppData,
                environment.LocalAppData,
                environment.UserProfile,
                environment.SystemRoot,
                environment.ComSpec);
            WritePathFailureHint(logger);
        }

        public static void WritePathFailureHint(IModuleLogger logger) {
            logger.LogError("Recovery: use '.\\tools\\dotnet-sandbox-safe.ps1 <dotnet arguments>' for sandbox recovery. See docs/ENVIRONMENT.md.");
        }
    }

    internal static class BuildFailureLogger {
        public static void Write(IModuleLogger logger, Exception exception) {
            var rootCause = GetRootCause(exception);
            logger.LogError("Build failed.");
            logger.LogError("Pipeline error: {ErrorType}: {ErrorMessage}", exception.GetType().Name, FirstLine(exception.Message));

            if (!ReferenceEquals(rootCause, exception))
                logger.LogError("Root cause: {ErrorType}: {ErrorMessage}", rootCause.GetType().Name, FirstLine(rootCause.Message));

            var input = ExtractBlock(rootCause.Message, "Input:");
            if (!string.IsNullOrWhiteSpace(input))
                logger.LogError("Command: {Command}", SingleLine(input));

            var errors = ExtractErrorLines(rootCause.Message).Take(8).ToArray();
            if (errors.Length > 0) {
                logger.LogError("Errors:");
                foreach (var error in errors)
                    logger.LogError("{Error}", error);
            }

            if (MentionsNuGetPathFailure(exception))
                WindowsDotnetEnvironment.WritePathFailureHint(logger);

            logger.LogError("Re-run with the same arguments after fixing the root cause.");
        }

        private static bool MentionsNuGetPathFailure(Exception exception) => exception.ToString().Contains("Value cannot be null. (Parameter 'path1')", StringComparison.OrdinalIgnoreCase)
            || exception.ToString().Contains("Value cannot be null. (Parameter path1)", StringComparison.OrdinalIgnoreCase);

        private static Exception GetRootCause(Exception exception) {
            while (exception.InnerException is not null)
                exception = exception.InnerException;

            return exception;
        }

        private static string FirstLine(string value) => value
            .Split(['\r', '\n'], StringSplitOptions.RemoveEmptyEntries)
            .FirstOrDefault()
            ?.Trim() ?? string.Empty;

        private static string SingleLine(string value) => string.Join(
            " ",
            value.Split(['\r', '\n'], StringSplitOptions.RemoveEmptyEntries)
                .Select(part => part.Trim())
                .Where(part => part.Length > 0)
        );

        private static string? ExtractBlock(string message, string label) {
            var lines = message.Split(['\r', '\n'], StringSplitOptions.None);
            var startIndex = Array.FindIndex(lines, line => line.StartsWith(label, StringComparison.Ordinal));
            if (startIndex < 0)
                return null;

            var block = new List<string> { lines[startIndex][label.Length..].Trim() };
            for (var index = startIndex + 1; index < lines.Length; index++) {
                var line = lines[index];
                if (string.IsNullOrWhiteSpace(line) || line.EndsWith(":", StringComparison.Ordinal))
                    break;

                block.Add(line);
            }

            return string.Join(Environment.NewLine, block);
        }

        private static IEnumerable<string> ExtractErrorLines(string message) => message
            .Split(['\r', '\n'], StringSplitOptions.RemoveEmptyEntries)
            .Select(line => line.Trim())
            .Where(IsUsefulErrorLine)
            .Select(TrimBuildLine);

        private static bool IsUsefulErrorLine(string line) {
            if (line.StartsWith("Exit Code:", StringComparison.OrdinalIgnoreCase))
                return true;

            var normalizedLine = TrimBuildLine(line);
            return normalizedLine.Contains(": error ", StringComparison.OrdinalIgnoreCase);
        }

        private static string TrimBuildLine(string line) => line.StartsWith("Error:", StringComparison.OrdinalIgnoreCase)
            ? line["Error:".Length..].Trim()
            : line;
    }

    internal sealed record BuildCliArguments(
        string? Configuration,
        HashSet<PackTarget> PackTargets,
        HashSet<string> Commands
    ) {
        private static readonly HashSet<string> SupportedCommands =
            ["pack", "publish"];
        // Automation appbundles are preserved-for-posterity (CreateAutomationBundleModule stays
        // in-tree, unregistered): the worker is unused and nothing in release.artifacts needs it.
        private static readonly HashSet<string> SupportedPackTargets =
            new(StringComparer.OrdinalIgnoreCase) { "all", "desktop", "installer" };

        public static BuildCliArguments Parse(IReadOnlyList<string> args) {
            string? configuration = null;
            var explicitPackTargets = new HashSet<PackTarget>();
            var commands = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

            for (var i = 0; i < args.Count; i++) {
                var arg = args[i];
                switch (arg) {
                case "--configuration":
                    if (i + 1 >= args.Count)
                        throw new ArgumentException("Missing value for --configuration.");

                    configuration = args[++i];
                    break;
                default:
                    if (SupportedPackTargets.Contains(arg)) {
                        _ = explicitPackTargets.Add(ParsePackTarget(arg));
                    } else {
                        _ = commands.Add(arg);
                    }

                    break;
                }
            }

            if (commands.Count == 0)
                throw new ArgumentException("Expected at least one command. Supported commands: pack, publish. Pack targets: desktop, installer, all.");

            var unsupportedCommands = commands
                .Where(command => !SupportedCommands.Contains(command))
                .OrderBy(command => command, StringComparer.OrdinalIgnoreCase)
                .ToArray();
            if (unsupportedCommands.Length > 0)
                throw new ArgumentException(
                    $"Unsupported command(s): {string.Join(", ", unsupportedCommands)}. Supported commands: pack, publish. Pack targets: desktop, installer, all.");

            if (explicitPackTargets.Count > 0 && !commands.Contains("pack"))
                throw new ArgumentException("Pack targets require the pack command. Use: pack desktop, pack installer, or pack all.");

            var packTargets = ResolvePackTargets(explicitPackTargets);

            return new BuildCliArguments(
                configuration,
                packTargets,
                commands
            );
        }

        private static PackTarget ParsePackTarget(string value) => value.ToLowerInvariant() switch {
            "all" => PackTarget.All,
            "desktop" => PackTarget.Desktop,
            "installer" => PackTarget.Installer,
            _ => throw new ArgumentOutOfRangeException(nameof(value), value, null)
        };

        private static HashSet<PackTarget> ResolvePackTargets(HashSet<PackTarget> explicitPackTargets) {
            if (explicitPackTargets.Count == 0 || explicitPackTargets.Contains(PackTarget.All))
                return [PackTarget.Desktop, PackTarget.Installer];

            return explicitPackTargets;
        }
    }

    internal enum PackTarget {
        All,
        Desktop,
        Installer
    }
}
