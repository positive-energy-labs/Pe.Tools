using Autodesk.PackageBuilder;
using Build.Options;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using ModularPipelines.Attributes;
using ModularPipelines.Context;
using ModularPipelines.Git.Extensions;
using ModularPipelines.Modules;
using Pe.Shared.RevitVersions;
using System.Diagnostics.CodeAnalysis;
using System.IO.Compression;

namespace Build.Modules;

[DependsOn<ResolveVersioningModule>]
[DependsOn<ResolveBuildMatrixModule>]
[DependsOn<ResolveBuildLayoutModule>]
[DependsOn<CleanProjectModule>(Optional = true)]
public sealed partial class CreateAutomationBundleModule(IOptions<BuildOptions> buildOptions) : Module {
    private const string WorkerAssemblyName = "Pe.Dev.RevitAutomation.Worker";
    private const string WorkerClassName = "Pe.Dev.RevitAutomation.Worker.RevitAutomationShellApp";
    private const string WorkerClientId = "11A07E95-68DE-4E58-A699-59B27F9600D2";
    private const string WorkerProjectPath = "source/Pe.Dev.RevitAutomation.Worker/Pe.Dev.RevitAutomation.Worker.csproj";

    protected override async Task ExecuteModuleAsync(IModuleContext context, CancellationToken cancellationToken) {
        var versioningResult = await context.GetModule<ResolveVersioningModule>();
        var matrixResult = await context.GetModule<ResolveBuildMatrixModule>();
        var layoutResult = await context.GetModule<ResolveBuildLayoutModule>();
        var versioning = versioningResult.ValueOrDefault!;
        var matrix = matrixResult.ValueOrDefault!;
        var layout = layoutResult.ValueOrDefault!;
        var configurations = matrix.ResolveConfigurations(BuildConfigurationGroup.AutomationPack, buildOptions.Value.Configuration);

        if (configurations.Length == 0) {
            context.Logger.LogInformation("Skipping automation appbundle packaging because no supported automation configuration was requested.");
            return;
        }

        Directory.CreateDirectory(layout.Artifacts.AutomationPackagesRoot);

        foreach (var configuration in configurations) {
            await context.SubModule(configuration, async () => {
                context.Logger.LogInformation("Building automation worker for {Configuration}.", configuration);
                await BuildWorkerAsync(context, versioning, configuration, cancellationToken).ConfigureAwait(false);
                CreateBundleArtifact(layout, configuration, versioning.Version, context);
            });
        }
    }

    private static Task BuildWorkerAsync(
        IModuleContext context,
        ResolveVersioningResult versioning,
        string configuration,
        CancellationToken cancellationToken
    ) => BuildDotNetCli.BuildQuietAsync(
        context,
        Path.Combine(context.Git().RootDirectory.Path, WorkerProjectPath),
        configuration,
        [
            ("PeIsolatedBuild", "true"),
            ("VersionPrefix", versioning.VersionPrefix),
            ("VersionSuffix", versioning.VersionSuffix!)
        ],
        cancellationToken
    );

    private static void CreateBundleArtifact(
        ProductLayoutAuthority layout,
        string configuration,
        string version,
        IModuleContext context
    ) {
        if (!RevitVersionCatalog.TryResolveFromConfiguration(configuration, out var spec) || !spec.SupportsDesignAutomation)
            throw new InvalidOperationException(
                $"Automation bundle packaging does not support configuration '{configuration}'.");

        var outputDirectory = layout.Artifacts.GetProjectBinDirectory(WorkerAssemblyName, configuration, spec.TargetFramework);
        var workerAssemblyPath = Path.Combine(outputDirectory, $"{WorkerAssemblyName}.dll");
        if (!File.Exists(workerAssemblyPath))
            throw new FileNotFoundException(
                $"Automation worker assembly '{workerAssemblyPath}' was not produced by the build.",
                workerAssemblyPath
            );

        var stagingRoot = layout.GetAutomationStagingDirectory(configuration, WorkerAssemblyName);
        if (Directory.Exists(stagingRoot))
            Directory.Delete(stagingRoot, true);

        var contentsDirectory = Path.Combine(stagingRoot, "Contents");
        Directory.CreateDirectory(contentsDirectory);

        BuildPackageContents(Path.Combine(stagingRoot, "PackageContents.xml"), version, spec.Year);
        BuildAddinManifest(Path.Combine(contentsDirectory, $"{WorkerAssemblyName}.addin"));

        foreach (var filePath in Directory.EnumerateFiles(outputDirectory)) {
            if (string.Equals(Path.GetExtension(filePath), ".pdb", StringComparison.OrdinalIgnoreCase))
                continue;

            File.Copy(filePath, Path.Combine(contentsDirectory, Path.GetFileName(filePath)), true);
        }

        var zipPath = Path.Combine(layout.Artifacts.AutomationPackagesRoot, $"{WorkerAssemblyName}.{spec.Year}.appbundle.zip");
        if (File.Exists(zipPath))
            File.Delete(zipPath);

        ZipFile.CreateFromDirectory(stagingRoot, zipPath, CompressionLevel.Optimal, true);
        context.Summary.KeyValue("Artifacts", $"Automation AppBundle {spec.Year}", zipPath);
    }

    private static void BuildPackageContents(string packageContentsPath, string version, int revitYear) => _ = BuilderUtils.Build<PackageContentsBuilder>(builder => {
        _ = builder.ApplicationPackage.Create()
            .ProductType(ProductTypes.Application)
            .AutodeskProduct(AutodeskProducts.Revit)
            .Name(WorkerAssemblyName)
            .Description("Pe.Tools Revit automation shell")
            .AppVersion(version);

        var componentEntry = builder.Components.CreateEntry("Pe.Tools Revit automation shell")
            .RevitPlatform(revitYear)
            .AppName(WorkerAssemblyName)
            .Version(version)
            .ModuleName($"./Contents/{WorkerAssemblyName}.addin")
            .AppDescription("Pe.Tools Revit automation shell");

        _ = componentEntry.DataBuilder.CreateAttribute("LoadOnCommandInvocation", false);
        _ = componentEntry.DataBuilder.CreateAttribute("LoadOnRevitStartup", true);
    }, packageContentsPath);

    private static void BuildAddinManifest(string addinManifestPath) => _ = BuilderUtils.Build<RevitAddInsBuilder>(builder => {
        var addInEntry = builder.AddIn.CreateEntry("DBApplication")
            .Name("Pe.Tools Revit Automation Shell")
            .Assembly($"{WorkerAssemblyName}.dll")
            .AddInId(WorkerClientId)
            .FullClassName(WorkerClassName)
            .VendorId("PE")
            .VendorDescription("Positive Energy");

        _ = addInEntry.DataBuilder.CreateElement("Description", "Pe.Tools Revit automation shell");
    }, addinManifestPath);

}
