using EnumerableAsyncProcessor.Extensions;
using Microsoft.Extensions.Logging;
using ModularPipelines.Attributes;
using ModularPipelines.Context;
using ModularPipelines.FileSystem;
using ModularPipelines.Git.Extensions;
using ModularPipelines.Git.Options;
using ModularPipelines.GitHub.Attributes;
using ModularPipelines.GitHub.Extensions;
using ModularPipelines.Modules;
using Octokit;
using Shouldly;
using File = ModularPipelines.FileSystem.File;

namespace Build.Modules;

/// <summary>
///     Publish the add-in to GitHub.
/// </summary>
[SkipIfNoGitHubToken]
[DependsOn<ResolveVersioningModule>]
[DependsOn<ResolveBuildLayoutModule>]
[DependsOn<GenerateGitHubChangelogModule>]
[DependsOn<CreateBundleModule>(Optional = true)]
[DependsOn<CreateInstallerModule>(Optional = true)]
public sealed class PublishGithubModule : Module {
    protected override async Task ExecuteModuleAsync(IModuleContext context, CancellationToken cancellationToken) {
        var versioningResult = await context.GetModule<ResolveVersioningModule>();
        var layoutResult = await context.GetModule<ResolveBuildLayoutModule>();
        var changelogResult = await context.GetModule<GenerateGitHubChangelogModule>();
        var versioning = versioningResult.ValueOrDefault!;
        var layout = layoutResult.ValueOrDefault!;
        var changelog = changelogResult.ValueOrDefault!;

        Directory.CreateDirectory(layout.PackagesRoot);
        var outputFolder = new Folder(layout.PackagesRoot);
        var targetFiles = EnumerateReleaseArtifacts(outputFolder, versioning.Version).ToArray();
        targetFiles.ShouldNotBeEmpty("No artifacts were found to create the Release");

        var repository = GitHubRepositoryRef.Resolve(context);
        context.Logger.LogInformation("Publishing release to GitHub repository {Repository}", repository.Identifier);
        var newRelease = new NewRelease(versioning.Version) {
            Name = versioning.Version,
            Body = changelog,
            TargetCommitish = context.Git().Information.LastCommitSha,
            Prerelease = versioning.IsPrerelease
        };

        var release = await context.GitHub().Client.Repository.Release
            .Create(repository.Owner, repository.Name, newRelease);
        await targetFiles
            .ForEachAsync(async file => {
                var asset = new ReleaseAssetUpload {
                    ContentType = "application/x-binary", FileName = file.Name, RawData = file.GetStream()
                };

                context.Logger.LogInformation("Uploading asset: {Asset}", asset.FileName);

                await context.GitHub().Client.Repository.Release.UploadAsset(release, asset, cancellationToken);
            }, cancellationToken)
            .ProcessInParallel();

        context.Summary.KeyValue("Deployment", "GitHub", release.HtmlUrl);
    }

    protected override async Task OnFailedAsync(
        IModuleContext context,
        Exception exception,
        CancellationToken cancellationToken
    ) {
        var versioningResult = await context.GetModule<ResolveVersioningModule>();
        var versioning = versioningResult.ValueOrDefault!;

        await context.Git().Commands
            .Push(new GitPushOptions { Delete = true, Arguments = ["origin", versioning.Version] },
                token: cancellationToken);
    }

    private static IEnumerable<File> EnumerateReleaseArtifacts(Folder outputFolder, string version) {
        if (!outputFolder.Exists)
            yield break;

        foreach (var path in Directory.EnumerateFiles(outputFolder.Path, "*", SearchOption.AllDirectories)) {
            var file = new File(path);
            if (file.Extension == ".zip")
                yield return file;

            if (file.Extension == ".msi" && file.Name.Contains(version, StringComparison.OrdinalIgnoreCase))
                yield return file;
        }
    }
}

// PE_HOT_RELOAD_NUDGE
