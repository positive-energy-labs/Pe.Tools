using Build.Options;
using Microsoft.Extensions.Options;
using ModularPipelines.Attributes;
using ModularPipelines.Context;
using ModularPipelines.DotNet.Extensions;
using ModularPipelines.DotNet.Options;
using ModularPipelines.Modules;
using Sourcy.DotNet;

namespace Build.Modules;

[DependsOn<ResolveVersioningModule>]
[DependsOn<ResolveBuildMatrixModule>]
[DependsOn<ValidateSolutionParityModule>]
[DependsOn<CleanProjectModule>(Optional = true)]
public sealed class PublishRevitAddinModule(IOptions<BuildOptions> buildOptions) : Module {
    protected override async Task ExecuteModuleAsync(IModuleContext context, CancellationToken cancellationToken) {
        var versioningResult = await context.GetModule<ResolveVersioningModule>();
        var matrixResult = await context.GetModule<ResolveBuildMatrixModule>();
        var versioning = versioningResult.ValueOrDefault!;
        var matrix = matrixResult.ValueOrDefault!;
        var configurations = matrix.ResolveConfigurations(BuildConfigurationGroup.Pack, buildOptions.Value.Configuration);

        foreach (var configuration in configurations)
            await context.SubModule(configuration, async () =>
                await PublishAsync(context, versioning, configuration, cancellationToken));
    }

    private static Task PublishAsync(
        IModuleContext context,
        ResolveVersioningResult versioning,
        string configuration,
        CancellationToken cancellationToken
    ) => context.DotNet().Build(new DotNetBuildOptions {
        ProjectSolution = Projects.Pe_App.FullName,
        Configuration = configuration,
        Properties = [
            ("PeIsolatedBuild", "true"),
            ("DeployAddin", "false"),
            ("PublishAddin", "true"),
            ("LaunchRevit", "false"),
            ("VersionPrefix", versioning.VersionPrefix),
            ("VersionSuffix", versioning.VersionSuffix!)
        ]
    }, cancellationToken: cancellationToken);
}

