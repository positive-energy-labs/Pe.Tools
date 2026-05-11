using Autodesk.PackageBuilder;
using Build.Options;
using Microsoft.Extensions.Options;
using ModularPipelines.Attributes;
using ModularPipelines.Context;
using ModularPipelines.FileSystem;
using ModularPipelines.Modules;
using Pe.Shared.HostContracts;
using Pe.Shared.Product;
using Shouldly;
using Sourcy.DotNet;
using System.Diagnostics.CodeAnalysis;
using System.Text.RegularExpressions;
using File = ModularPipelines.FileSystem.File;

namespace Build.Modules;

/// <summary>
///     Create the Autodesk .bundle package.
/// </summary>
[DependsOn<ResolveVersioningModule>]
[DependsOn<ResolveBuildMatrixModule>]
[DependsOn<ResolveBuildLayoutModule>]
[DependsOn<PublishRevitAddinModule>]
public sealed partial class CreateBundleModule(
    IOptions<BuildOptions> buildOptions,
    IOptions<BundleOptions> bundleOptions) : Module {
    protected override async Task ExecuteModuleAsync(IModuleContext context, CancellationToken cancellationToken) {
        var versioningResult = await context.GetModule<ResolveVersioningModule>();
        var matrixResult = await context.GetModule<ResolveBuildMatrixModule>();
        var layoutResult = await context.GetModule<ResolveBuildLayoutModule>();
        var versioning = versioningResult.ValueOrDefault!;
        var matrix = matrixResult.ValueOrDefault!;
        var layout = layoutResult.ValueOrDefault!;

        var bundleTarget = new File(Projects.Pe_App.FullName);
        var targetDirectories = matrix.ResolveConfigurations(BuildConfigurationGroup.Pack, buildOptions.Value.Configuration)
            .Select(layout.GetRevitPublishDirectory)
            .Select(path => new Folder(path))
            .Where(folder => folder.Exists)
            .ToArray();

        targetDirectories.ShouldNotBeEmpty("No content were found to create a bundle");

        Directory.CreateDirectory(layout.Artifacts.BundlePackagesRoot);
        var outputFolder = new Folder(layout.Artifacts.BundlePackagesRoot);
        var bundleFolder = outputFolder.GetFolder($"{bundleTarget.NameWithoutExtension}.bundle");
        if (bundleFolder.Exists)
            await bundleFolder.DeleteAsync(cancellationToken);

        bundleFolder = outputFolder.CreateFolder(bundleFolder.Name);
        var contentFolder = bundleFolder.CreateFolder("Contents");
        var manifestFile = bundleFolder.GetFile("PackageContents.xml");

        PackFiles(targetDirectories, contentFolder);
        this.GenerateManifest(bundleTarget, targetDirectories, manifestFile, versioning);

        var outputFile = outputFolder.GetFile($"{bundleFolder.Name}.zip");
        if (outputFile.Exists)
            await outputFile.DeleteAsync(cancellationToken);

        context.Files.Zip.ZipFolder(bundleFolder, outputFile.Path);
        await bundleFolder.DeleteAsync(cancellationToken);

        context.Summary.KeyValue("Artifacts", "Bundle", outputFile.Path);
    }

    private static void PackFiles(Folder[] targetDirectories, Folder contentFolder) {
        foreach (var targetDirectory in targetDirectories) {
            TryParseVersion(targetDirectory.Path, out var version)
                .ShouldBeTrue($"Could not parse version from directory name: {targetDirectory.Path}");

            var versionFolder = contentFolder.CreateFolder(version);
            foreach (var filePath in targetDirectory.GetFiles(file => file.Exists)) {
                var relativePath = Path.GetRelativePath(targetDirectory.Path, filePath.Path);
                var destinationPath = versionFolder.GetFile(relativePath);
                if (!destinationPath.Folder!.Exists)
                    destinationPath.Folder!.Create();

                filePath.CopyTo(destinationPath.Path);
            }
        }
    }

    private void GenerateManifest(
        File bundleTarget,
        Folder[] targetDirectories,
        File manifestDirectory,
        ResolveVersioningResult versioning
    ) => BuilderUtils.Build<PackageContentsBuilder>(builder => {
        builder.ApplicationPackage.Create()
            .ProductType(ProductTypes.Application)
            .AutodeskProduct(AutodeskProducts.Revit)
            .Name(bundleTarget.NameWithoutExtension)
            .AppVersion(versioning.Version);

        builder.CompanyDetails.Create(ProductIdentity.VendorName)
            .Email(bundleOptions.Value.VendorEmail)
            .Url(bundleOptions.Value.VendorUrl);

        foreach (var targetDirectory in targetDirectories) {
            TryParseVersion(targetDirectory.Path, out var version)
                .ShouldBeTrue($"Could not parse version from directory name: {targetDirectory.Path}");

            var addinManifests = targetDirectory.GetFiles(file => file.Extension == ".addin");
            foreach (var addinManifest in addinManifests) {
                var relativePath = Path.GetRelativePath(targetDirectory.Path, addinManifest.Path);

                builder.Components.CreateEntry($"Revit {version}")
                    .RevitPlatform(int.Parse(version))
                    .AppName(bundleTarget.NameWithoutExtension)
                    .ModuleName($"./Contents/{version}/{relativePath}");
            }
        }
    }, manifestDirectory);

    private static bool TryParseVersion(string input, [NotNullWhen(true)] out string? version) {
        version = null;
        var match = VersionRegex().Match(input);
        if (!match.Success)
            return false;

        switch (match.Value.Length) {
        case 4:
            version = match.Value;
            return true;
        case 2:
            version = $"20{match.Value}";
            return true;
        default:
            return false;
        }
    }

    [GeneratedRegex(@"(\d+)(?!.*\d)")]
    private static partial Regex VersionRegex();
}

// PE_HOT_RELOAD_NUDGE
