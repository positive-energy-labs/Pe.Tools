using Build.Options;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using ModularPipelines.Attributes;
using ModularPipelines.Context;
using ModularPipelines.Git.Extensions;
using ModularPipelines.Modules;
using Pe.Shared.RevitVersions;

namespace Build.Modules;

[DependsOn<ResolveVersioningModule>]
[DependsOn<ResolveBuildMatrixModule>]
[DependsOn<ResolveBuildLayoutModule>]
[DependsOn<CleanProjectModule>(Optional = true)]
public sealed class CreateAutomationBundleModule(IOptions<BuildOptions> buildOptions) : Module {
    private const string WorkerProjectPath = "source/Pe.Dev.RevitAutomation.Worker/Pe.Dev.RevitAutomation.Worker.csproj";

    protected override async Task ExecuteModuleAsync(IModuleContext context, CancellationToken cancellationToken) {
        var versioning = (await context.GetModule<ResolveVersioningModule>()).ValueOrDefault!;
        var matrix = (await context.GetModule<ResolveBuildMatrixModule>()).ValueOrDefault!;
        var layout = (await context.GetModule<ResolveBuildLayoutModule>()).ValueOrDefault!;
        var configurations = matrix.ResolveConfigurations(BuildConfigurationGroup.AutomationPack, buildOptions.Value.Configuration);
        if (configurations.Length == 0) {
            context.Logger.LogInformation("Skipping automation appbundles because no supported configuration was requested.");
            return;
        }

        var years = configurations.Select(configuration =>
            RevitVersionCatalog.TryResolveFromConfiguration(configuration, out var spec) && spec.SupportsDesignAutomation
                ? spec.Year
                : throw new InvalidOperationException($"Automation packaging does not support '{configuration}'."))
            .ToArray();
        var project = Path.Combine(context.Git().RootDirectory.Path, WorkerProjectPath);
        await BuildDotNetCli.BuildTargetQuietAsync(
            context,
            project,
            configurations[0],
            "PeCreateAppBundle",
            [
                ("PeIsolatedBuild", "true"),
                ("DeployAddin", "false"),
                ("LaunchRevit", "false"),
                ("PeRevitYears", string.Join(";", years)),
                ("PeAppBundleOutputRoot", layout.Artifacts.AutomationPackagesRoot),
                ("VersionPrefix", versioning.VersionPrefix),
                ("VersionSuffix", versioning.VersionSuffix!)
            ],
            cancellationToken
        ).ConfigureAwait(false);

        foreach (var year in years) {
            var path = Path.Combine(layout.Artifacts.AutomationPackagesRoot,
                $"Pe.Dev.RevitAutomation.Worker.{year}.appbundle.zip");
            if (!File.Exists(path))
                throw new FileNotFoundException($"SDK appbundle target did not produce '{path}'.", path);
            context.Summary.KeyValue("Artifacts", $"Automation AppBundle {year}", path);
        }
    }
}
