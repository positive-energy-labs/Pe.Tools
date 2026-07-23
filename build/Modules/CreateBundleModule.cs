using Build.Options;
using Microsoft.Extensions.Options;
using ModularPipelines.Attributes;
using ModularPipelines.Context;
using ModularPipelines.Git.Extensions;
using ModularPipelines.Modules;
using Pe.Shared.RevitVersions;
using Shouldly;

namespace Build.Modules;

[DependsOn<ResolveVersioningModule>]
[DependsOn<ResolveBuildMatrixModule>]
[DependsOn<ResolveBuildLayoutModule>]
[DependsOn<ResolvePackageSigningModule>]
[DependsOn<CleanProjectModule>(Optional = true)]
public sealed class CreateBundleModule(IOptions<BuildOptions> buildOptions) : Module {
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
        var appAssemblyName = BuildProjectDiscovery.AssemblyName(appProjectPath);
        var configurations = matrix.ResolveConfigurations(BuildConfigurationGroup.Pack, buildOptions.Value.Configuration);
        configurations.ShouldNotBeEmpty("No configurations were found to create a bundle.");

        var revitYears = configurations
            .Select(ResolveRevitYear)
            .Distinct()
            .Order()
            .ToArray();
        revitYears.ShouldNotBeEmpty("No Revit years were found to create a bundle.");

        Directory.CreateDirectory(layout.Artifacts.BundlePackagesRoot);
        var bundleZipPath = Path.Combine(layout.Artifacts.BundlePackagesRoot, $"{appAssemblyName}.bundle.zip");
        var bundleStagingDir = Path.Combine(layout.Artifacts.PackagesRoot, ".stage", "revit-bundles", $"{appAssemblyName}.bundle");
        var publishStagingRoot = layout.GetSdkInstallerRevitPayloadRoot();

        if (File.Exists(bundleZipPath))
            File.Delete(bundleZipPath);

        // A -p year list can only travel %3B-escaped (raw ; is MSB1006), and SDK <= beta.98
        // item-splits break on the escaped form (one mega-year, Configuration=Release.R2023;2024;…).
        // Multi-year here always means the full matrix, which Directory.Build.props already
        // declares with cleanly splitting semicolons — so only pass a single narrowed year.
        (string, string?)[] yearProperties = revitYears.Length == 1
            ? [("PeRevitYears", revitYears[0].ToString())]
            : [];
        await BuildDotNetCli.BuildTargetQuietAsync(
            context,
            appProjectPath,
            configurations[0],
            "PeCreateBundle",
            [
                ("PeIsolatedBuild", "true"),
                ("DeployAddin", "false"),
                ("LaunchRevit", "false"),
                .. yearProperties,
                ("PePublishStagingRoot", publishStagingRoot),
                ("PeBundleStagingDir", bundleStagingDir),
                ("PeBundleZipPath", bundleZipPath),
                ("VersionPrefix", versioning.VersionPrefix),
                ("VersionSuffix", versioning.VersionSuffix!),
                .. signing.BuildProperties
            ],
            cancellationToken
        ).ConfigureAwait(false);

        foreach (var year in revitYears)
            signing.VerifyPublishedAddin(Path.Combine(publishStagingRoot, year.ToString()));

        if (Directory.Exists(bundleStagingDir))
            Directory.Delete(bundleStagingDir, true);

        File.Exists(bundleZipPath).ShouldBeTrue($"SDK bundle target did not produce '{bundleZipPath}'.");
        context.Summary.KeyValue("Artifacts", "Bundle", bundleZipPath);
    }

    private static int ResolveRevitYear(string configuration) {
        if (RevitVersionCatalog.TryResolveFromConfiguration(configuration, out var spec))
            return spec.Year;

        throw new InvalidOperationException($"Could not resolve a Revit year from configuration '{configuration}'.");
    }
}
