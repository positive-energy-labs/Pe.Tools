using Build.Options;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using ModularPipelines.Attributes;
using ModularPipelines.Context;
using ModularPipelines.Git.Extensions;
using ModularPipelines.Modules;

namespace Build.Modules;

[DependsOn<ResolveVersioningModule>]
[DependsOn<ResolveBuildMatrixModule>]
[DependsOn<ResolveBuildLayoutModule>]
[DependsOn<ResolvePackageSigningModule>]
[DependsOn<ValidateSolutionParityModule>]
[DependsOn<CleanProjectModule>(Optional = true)]
public sealed class PublishRevitAddinModule(IOptions<BuildOptions> buildOptions) : Module {
    protected override async Task ExecuteModuleAsync(IModuleContext context, CancellationToken cancellationToken) {
        var versioningResult = await context.GetModule<ResolveVersioningModule>();
        var matrixResult = await context.GetModule<ResolveBuildMatrixModule>();
        var layoutResult = await context.GetModule<ResolveBuildLayoutModule>();
        var signingResult = await context.GetModule<ResolvePackageSigningModule>();
        var versioning = versioningResult.ValueOrDefault!;
        var matrix = matrixResult.ValueOrDefault!;
        var layout = layoutResult.ValueOrDefault!;
        var signing = signingResult.ValueOrDefault!;
        var rootDirectory = context.Git().RootDirectory;
        var appProjectPath = BuildProjectDiscovery.FindSingleProjectByKind(rootDirectory.Path, "RevitAddin");
        var assemblyName = BuildProjectDiscovery.AssemblyName(appProjectPath);
        var configurations = matrix.ResolveConfigurations(BuildConfigurationGroup.Pack, buildOptions.Value.Configuration);

        foreach (var configuration in configurations)
            await context.SubModule(configuration, async () => {
                context.Logger.LogInformation("Publishing Revit add-in for {Configuration}.", configuration);
                foreach (var path in new[] {
                    Path.Combine(layout.Artifacts.ArtifactsRoot, "build", assemblyName, configuration),
                    Path.Combine(layout.Artifacts.ArtifactsRoot, "obj", assemblyName, configuration)
                })
                    if (Directory.Exists(path)) Directory.Delete(path, recursive: true);
                await PublishAsync(
                    context,
                    versioning,
                    appProjectPath,
                    configuration,
                    layout.GetRevitPublishDirectory(configuration),
                    signing,
                    cancellationToken
                );
            });
    }

    private static async Task PublishAsync(
        IModuleContext context,
        ResolveVersioningResult versioning,
        string projectPath,
        string configuration,
        string publishDirectory,
        PackageSigningResult signing,
        CancellationToken cancellationToken
    ) {
        await BuildDotNetCli.BuildQuietAsync(
            context,
            projectPath,
            configuration,
            [
            ("PeIsolatedBuild", "true"),
            ("DeployAddin", "false"),
            ("PublishAddin", "true"),
            ("LaunchRevit", "false"),
            ("AddinPublishDir", publishDirectory),
            ("VersionPrefix", versioning.VersionPrefix),
                ("VersionSuffix", versioning.VersionSuffix!),
                .. signing.BuildProperties
            ],
            cancellationToken
        );
        signing.VerifyPublishedAddin(publishDirectory);
    }
}

