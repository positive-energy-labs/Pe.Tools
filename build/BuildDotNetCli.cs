using System.Diagnostics;
using System.Text.RegularExpressions;
using ModularPipelines.Context;

namespace Build;

internal static partial class BuildDotNetCli {
    public static Task BuildQuietAsync(
        IModuleContext context,
        string projectPath,
        string configuration,
        IReadOnlyCollection<(string Name, string? Value)> properties,
        CancellationToken cancellationToken
    ) => RunQuietAsync(context, BuildArguments("build", projectPath, configuration, properties), cancellationToken);

    public static Task BuildTargetQuietAsync(
        IModuleContext context,
        string projectPath,
        string configuration,
        string target,
        IReadOnlyCollection<(string Name, string? Value)> properties,
        CancellationToken cancellationToken
    ) {
        var arguments = BuildArguments("build", projectPath, configuration, properties);
        arguments.Add($"-t:{target}");
        return RunQuietAsync(context, arguments, cancellationToken);
    }

    public static Task PublishQuietAsync(
        IModuleContext context,
        string projectPath,
        string configuration,
        IReadOnlyCollection<string> additionalArguments,
        IReadOnlyCollection<(string Name, string? Value)> properties,
        CancellationToken cancellationToken
    ) {
        var arguments = BuildArguments("publish", projectPath, configuration, properties);
        arguments.InsertRange(4, additionalArguments);
        return RunQuietAsync(context, arguments, cancellationToken);
    }

    private static async Task RunQuietAsync(IModuleContext context, IReadOnlyCollection<string> arguments, CancellationToken cancellationToken) {
        var startInfo = new ProcessStartInfo("dotnet") {
            UseShellExecute = false,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            CreateNoWindow = true
        };

        foreach (var argument in arguments)
            startInfo.ArgumentList.Add(argument);

        using var process = new Process { StartInfo = startInfo };
        var standardOutput = new List<string>();
        var standardError = new List<string>();
        process.OutputDataReceived += (_, e) => AddLine(standardOutput, e.Data);
        process.ErrorDataReceived += (_, e) => AddLine(standardError, e.Data);

        if (!process.Start())
            throw new DotNetCommandException(FormatCommand(arguments), -1, [], ["Failed to start dotnet process."]);

        process.BeginOutputReadLine();
        process.BeginErrorReadLine();
        await process.WaitForExitAsync(cancellationToken);

        if (process.ExitCode != 0)
            throw DotNetCommandException.Create(arguments, process.ExitCode, standardOutput, standardError);
    }

    private static void AddLine(List<string> lines, string? line) {
        if (!string.IsNullOrWhiteSpace(line))
            lines.Add(line);
    }

    private static List<string> BuildArguments(
        string command,
        string projectPath,
        string configuration,
        IReadOnlyCollection<(string Name, string? Value)> properties
    ) {
        var arguments = new List<string> {
            command,
            projectPath,
            "--configuration",
            configuration,
            "--nologo",
            "--verbosity",
            "quiet",
            "-p:WarningLevel=0"
        };

        foreach (var (name, value) in properties)
            arguments.Add($"-p:{name}={value ?? string.Empty}");

        return arguments;
    }

    private static string FormatCommand(IEnumerable<string> arguments) => "dotnet " + string.Join(" ", arguments.Select(QuoteIfNeeded));

    private static string QuoteIfNeeded(string argument) => argument.Any(char.IsWhiteSpace) ? $"\"{argument}\"" : argument;

    private sealed partial class DotNetCommandException(string command, int exitCode, IReadOnlyCollection<string> output, IReadOnlyCollection<string> errors) : Exception(BuildMessage(command, exitCode, output, errors)) {
        public override string ToString() => Message;

        public static DotNetCommandException Create(IReadOnlyCollection<string> arguments, int exitCode, IReadOnlyCollection<string> standardOutput, IReadOnlyCollection<string> standardError) {
            var combined = standardError.Concat(standardOutput).ToArray();
            var errors = combined.Where(IsBuildError).Distinct().Take(12).ToArray();
            var warnings = combined.Where(IsBuildWarning).Distinct().Take(5).ToArray();
            var output = errors.Length == 0
                ? combined.Where(line => !IsBuildWarning(line)).Distinct().Take(12).ToArray()
                : warnings;

            return new DotNetCommandException(FormatCommand(arguments), exitCode, output, errors);
        }

        private static bool IsBuildError(string line) => ErrorRegex().IsMatch(line) || line.Contains("Build FAILED", StringComparison.OrdinalIgnoreCase);

        private static bool IsBuildWarning(string line) => WarningRegex().IsMatch(line);

        private static string BuildMessage(string command, int exitCode, IReadOnlyCollection<string> output, IReadOnlyCollection<string> errors) {
            var lines = new List<string> {
                $"dotnet command failed with exit code {exitCode}.",
                "Input: " + command
            };

            if (errors.Count > 0) {
                lines.Add("Errors:");
                lines.AddRange(errors.Select(error => "  " + SingleLine(error)));
            }

            if (output.Count > 0) {
                lines.Add(errors.Count > 0 ? "Warnings:" : "Output:");
                lines.AddRange(output.Select(line => "  " + SingleLine(line)));
            }

            return string.Join(Environment.NewLine, lines);
        }

        private static string SingleLine(string value) => Regex.Replace(value.Trim(), "\\s+", " ");

        [GeneratedRegex(@"\berror\s+[A-Z]+\d+\b", RegexOptions.IgnoreCase)]
        private static partial Regex ErrorRegex();

        [GeneratedRegex(@"\bwarning\s+[A-Z]+\d+\b", RegexOptions.IgnoreCase)]
        private static partial Regex WarningRegex();
    }
}
