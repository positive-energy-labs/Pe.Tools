using Build.Options;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using ModularPipelines.Attributes;
using ModularPipelines.Context;
using ModularPipelines.Modules;
using Sourcy.DotNet;

namespace Build.Modules;

[DependsOn<ResolveVersioningModule>]
[DependsOn<ResolveBuildMatrixModule>]
[DependsOn<ResolveBuildTaxonomyModule>]
[DependsOn<ValidateSolutionParityModule>]
[DependsOn<CleanProjectModule>(Optional = true)]
public sealed class PublishRevitAddinModule(IOptions<BuildOptions> buildOptions) : Module {
    protected override async Task ExecuteModuleAsync(IModuleContext context, CancellationToken cancellationToken) {
        var versioningResult = await context.GetModule<ResolveVersioningModule>();
        var matrixResult = await context.GetModule<ResolveBuildMatrixModule>();
        var taxonomyResult = await context.GetModule<ResolveBuildTaxonomyModule>();
        var versioning = versioningResult.ValueOrDefault!;
        var matrix = matrixResult.ValueOrDefault!;
        var taxonomy = taxonomyResult.ValueOrDefault!;
        taxonomy.RequireProductClass("Pe.App", ProductClass.DesktopAddin);
        var configurations = matrix.ResolveConfigurations(BuildConfigurationGroup.Pack, buildOptions.Value.Configuration);

        foreach (var configuration in configurations)
            await context.SubModule(configuration, async () => {
                context.Logger.LogInformation("Publishing Revit add-in for {Configuration}.", configuration);
                await PublishAsync(context, versioning, configuration, cancellationToken);
            });
    }

    private static Task PublishAsync(
        IModuleContext context,
        ResolveVersioningResult versioning,
        string configuration,
        CancellationToken cancellationToken
    ) => BuildDotNetCli.BuildQuietAsync(
        context,
        Projects.Pe_App.FullName,
        configuration,
        [
            ("PeIsolatedBuild", "true"),
            ("DeployAddin", "false"),
            ("PublishAddin", "true"),
            ("LaunchRevit", "false"),
            ("VersionPrefix", versioning.VersionPrefix),
            ("VersionSuffix", versioning.VersionSuffix!)
        ],
        cancellationToken
    );
}

