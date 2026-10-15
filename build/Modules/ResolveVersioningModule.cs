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
///     One release authority (Pe.Revit.Sdk A5): the <c>version</c> field of
///     <c>product.payloads.json</c> at the repo root. Build__Version may assert that value,
///     never override it. No GitVersion.
/// </summary>
public sealed class ResolveVersioningModule(IOptions<BuildOptions> buildOptions) : Module<ResolveVersioningResult> {
    protected override async Task<ResolveVersioningResult?> ExecuteAsync(IModuleContext context,
        CancellationToken cancellationToken) {
        var version = ReadManifestVersion();
        if (!string.IsNullOrEmpty(buildOptions.Value.Version) && buildOptions.Value.Version != version)
            throw new InvalidOperationException(
                $"Build__Version cannot override product.payloads.json: declared '{version}', received '{buildOptions.Value.Version}'.");

        var versioning = await CreateFromVersionStringAsync(context, version);
        context.Summary.KeyValue("Build", "Version", versioning.Version);
        return versioning;
    }

    /// <summary>
    ///     Read the <c>version</c> field of <c>product.payloads.json</c>, walking up from the
    ///     pipeline's working directory. This mirrors the SDK's primary version authority
    ///     (Pe.Revit.Common.props / RepoContext): the manifest is the single release-version SoT.
    /// </summary>
    private static string ReadManifestVersion() {
        for (var dir = new DirectoryInfo(Directory.GetCurrentDirectory()); dir is not null; dir = dir.Parent) {
            var file = Path.Combine(dir.FullName, "product.payloads.json");
            if (!File.Exists(file)) continue;

            var match = Regex.Match(File.ReadAllText(file), "(?<=\"version\"\\s*:\\s*\")[^\"]+");
            if (match.Success) return match.Value;

            throw new InvalidOperationException($"product.payloads.json at {file} has no \"version\" value.");
        }

        throw new InvalidOperationException(
            "No release version resolved: add a \"version\" field to product.payloads.json at the repo root.");
    }

    /// <summary>
    ///     Resolve versions using the specified version string.
    /// </summary>
    private static async Task<ResolveVersioningResult> CreateFromVersionStringAsync(IModuleContext context,
        string version) {
        return new ResolveVersioningResult {
            Version = version,
            IsPrerelease = version.Contains('-'),
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
