using System.Text.RegularExpressions;
using Build.Options;
using JetBrains.Annotations;
using Microsoft.Extensions.Options;
using ModularPipelines.Context;
using ModularPipelines.Git.Extensions;
using ModularPipelines.Git.Options;
using ModularPipelines.Modules;
using ModularPipelines.Options;

namespace Build.Modules;

/// <summary>
///     Resolve semantic versions for compiling and publishing the add-in.
///     One release authority (Pe.Revit.Sdk P17): pe-version.json at the repo root;
///     the Build__Version option is the only override. No GitVersion.
/// </summary>
public sealed class ResolveVersioningModule(IOptions<BuildOptions> buildOptions) : Module<ResolveVersioningResult> {
    protected override async Task<ResolveVersioningResult?> ExecuteAsync(IModuleContext context,
        CancellationToken cancellationToken) {
        var version = buildOptions.Value.Version;
        if (string.IsNullOrEmpty(version)) version = ReadVersionFile();

        var versioning = await CreateFromVersionStringAsync(context, version);
        context.Summary.KeyValue("Build", "Version", versioning.Version);
        return versioning;
    }

    /// <summary>
    ///     Read pe-version.json, walking up from the pipeline's working directory.
    /// </summary>
    private static string ReadVersionFile() {
        for (var dir = new DirectoryInfo(Directory.GetCurrentDirectory()); dir is not null; dir = dir.Parent) {
            var file = Path.Combine(dir.FullName, "pe-version.json");
            if (!File.Exists(file)) continue;

            var match = Regex.Match(File.ReadAllText(file), "(?<=\"version\"\\s*:\\s*\")[^\"]+");
            if (match.Success) return match.Value;

            throw new InvalidOperationException($"pe-version.json at {file} has no \"version\" value.");
        }

        throw new InvalidOperationException(
            "No release version resolved: create pe-version.json at the repo root or set Build__Version.");
    }

    /// <summary>
    ///     Resolve versions using the specified version string.
    /// </summary>
    private static async Task<ResolveVersioningResult> CreateFromVersionStringAsync(IModuleContext context,
        string version) {
        var versionParts = version.Split('-');

        return new ResolveVersioningResult {
            Version = version,
            VersionPrefix = versionParts[0],
            VersionSuffix = versionParts.Length > 1 ? versionParts[1] : null,
            IsPrerelease = versionParts.Length > 1,
            PreviousVersion = await FetchPreviousVersionAsync(context)
        };
    }

    /// <summary>
    ///     Retrieves the previous version from the git history.
    /// </summary>
    private static async Task<string> FetchPreviousVersionAsync(IModuleContext context) {
        var describeResult = await context.Git().Commands.Describe(
            new GitDescribeOptions { Tags = true, Abbrev = "0", Arguments = ["HEAD^"] },
            new CommandExecutionOptions { ThrowOnNonZeroExitCode = false, LogSettings = CommandLoggingOptions.Silent });

        var previousTag = describeResult.StandardOutput.Trim();
        if (!string.IsNullOrWhiteSpace(previousTag)) return previousTag;

        var revisionResult = await context.Git().Commands.RevList(
            new GitRevListOptions {
                MaxParents = "0",
                MaxCount = "1",
                Pretty = "format:%H",
                Arguments = ["HEAD"],
                NoCommitHeader = true
            },
            new CommandExecutionOptions { LogSettings = CommandLoggingOptions.Silent });

        return revisionResult.StandardOutput.Trim();
    }
}

[PublicAPI]
public sealed record ResolveVersioningResult {
    /// <summary>
    ///     Release version, includes version number and release stage.
    /// </summary>
    /// <remarks>Version format: <c>version-environment.n.date</c>.</remarks>
    /// <example>
    ///     1.0.0-alpha.1 <br />
    ///     12.3.6-rc.2.250101 <br />
    ///     2026.4.0
    /// </example>
    public required string Version { get; init; }

    /// <summary>
    ///     The normal part of the release version number.
    /// </summary>
    /// <example>
    ///     1.0.0 <br />
    ///     12.3.6 <br />
    ///     2026.4.0
    /// </example>
    public required string VersionPrefix { get; init; }

    /// <summary>
    ///     The pre-release label of the release version number.
    /// </summary>
    /// <example>
    ///     alpha <br />
    ///     beta <br />
    ///     rc.1.250101
    /// </example>
    public required string? VersionSuffix { get; init; }

    /// <summary>
    ///     Indicates whether the current version represents a prerelease.
    /// </summary>
    /// <remarks>
    ///     A version is considered a prerelease if it includes a version suffix,
    ///     such as "alpha", "beta", or similar identifiers.
    /// </remarks>
    public required bool IsPrerelease { get; init; }

    /// <summary>
    ///     The previous release version.
    /// </summary>
    public required string PreviousVersion { get; init; }
}