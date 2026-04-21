using Autodesk.PackageBuilder;
using Build.Options;
using Microsoft.Extensions.Options;
using Microsoft.Extensions.Logging;
using ModularPipelines.Attributes;
using ModularPipelines.Context;
using ModularPipelines.DotNet.Extensions;
using ModularPipelines.DotNet.Options;
using ModularPipelines.Git.Extensions;
using ModularPipelines.Modules;
using System.Diagnostics.CodeAnalysis;
using System.IO.Compression;
using System.Text.RegularExpressions;

namespace Build.Modules;

[DependsOn<ResolveVersioningModule>]
[DependsOn<ResolveConfigurationsModule>]
[DependsOn<CompileProjectModule>]
[DependsOn<CleanProjectModule>(Optional = true)]
public sealed partial class CreateAutomationBundleModule(
    IOptions<BuildOptions> buildOptions) : Module {
    private const string WorkerAssemblyName = "Pe.Dev.RevitAutomation.Worker";
    private const string WorkerClassName = "Pe.Dev.RevitAutomation.Worker.RevitAutomationShellApp";
    private const string WorkerClientId = "11A07E95-68DE-4E58-A699-59B27F9600D2";
    private const string WorkerProjectPath = "source/Pe.Dev.RevitAutomation.Worker/Pe.Dev.RevitAutomation.Worker.csproj";
    private const string WorkerTargetFramework = "net8.0-windows";

    protected override async Task ExecuteModuleAsync(IModuleContext context, CancellationToken cancellationToken) {
        var versioningResult = await context.GetModule<ResolveVersioningModule>();
        var configurationsResult = await context.GetModule<ResolveConfigurationsModule>();
        var versioning = versioningResult.ValueOrDefault!;
        var configurations = configurationsResult.ValueOrDefault!
            .Where(configuration => TryResolveAutomationYear(configuration, out _))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToArray();

        if (configurations.Length == 0) {
            context.Logger.LogInformation("Skipping automation appbundle packaging because no supported automation configuration was requested.");
            return;
        }

        var repoRoot = context.Git().RootDirectory.Path;
        var outputRoot = Path.Combine(repoRoot, buildOptions.Value.OutputDirectory, "automation");
        _ = Directory.CreateDirectory(outputRoot);

        foreach (var configuration in configurations) {
            await context.SubModule(configuration, async () => {
                await BuildWorkerAsync(context, versioning, configuration, cancellationToken).ConfigureAwait(false);
                CreateBundleArtifact(repoRoot, outputRoot, configuration, versioning.Version, context);
            });
        }
    }

    private static async Task BuildWorkerAsync(
        IModuleContext context,
        ResolveVersioningResult versioning,
        string configuration,
        CancellationToken cancellationToken
    ) =>
        await context.DotNet().Build(new DotNetBuildOptions {
            ProjectSolution = Path.Combine(context.Git().RootDirectory.Path, WorkerProjectPath),
            Configuration = configuration,
            Properties = [
                ("VersionPrefix", versioning.VersionPrefix),
                ("VersionSuffix", versioning.VersionSuffix!)
            ]
        }, cancellationToken: cancellationToken);

    private static void CreateBundleArtifact(
        string repoRoot,
        string outputRoot,
        string configuration,
        string version,
        IModuleContext context
    ) {
        if (!TryResolveAutomationYear(configuration, out var revitYear))
            return;

        var outputDirectory = Path.Combine(
            repoRoot,
            "source",
            "Pe.Dev.RevitAutomation.Worker",
            "bin",
            configuration,
            WorkerTargetFramework
        );
        var workerAssemblyPath = Path.Combine(outputDirectory, $"{WorkerAssemblyName}.dll");
        if (!File.Exists(workerAssemblyPath))
            throw new FileNotFoundException(
                $"Automation worker assembly '{workerAssemblyPath}' was not produced by the build.",
                workerAssemblyPath
            );

        var stagingRoot = Path.Combine(repoRoot, ".artifacts", "automation-pack", configuration, $"{WorkerAssemblyName}.bundle");
        if (Directory.Exists(stagingRoot))
            Directory.Delete(stagingRoot, true);

        var contentsDirectory = Path.Combine(stagingRoot, "Contents");
        _ = Directory.CreateDirectory(contentsDirectory);

        BuildPackageContents(Path.Combine(stagingRoot, "PackageContents.xml"), version, revitYear);
        BuildAddinManifest(Path.Combine(contentsDirectory, $"{WorkerAssemblyName}.addin"));

        foreach (var filePath in Directory.EnumerateFiles(outputDirectory)) {
            if (string.Equals(Path.GetExtension(filePath), ".pdb", StringComparison.OrdinalIgnoreCase))
                continue;

            File.Copy(filePath, Path.Combine(contentsDirectory, Path.GetFileName(filePath)), true);
        }

        var zipPath = Path.Combine(outputRoot, $"{WorkerAssemblyName}.{revitYear}.appbundle.zip");
        if (File.Exists(zipPath))
            File.Delete(zipPath);

        ZipFile.CreateFromDirectory(stagingRoot, zipPath, CompressionLevel.Optimal, true);
        context.Summary.KeyValue("Artifacts", $"Automation AppBundle {revitYear}", zipPath);
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

    private static bool TryResolveAutomationYear(string configuration, out int revitYear) {
        revitYear = 0;
        var match = RevitConfigurationRegex().Match(configuration);
        if (!match.Success)
            return false;

        var value = match.Groups["year"].Value;
        var normalized = value.Length == 2 ? $"20{value}" : value;
        if (!int.TryParse(normalized, out var parsedYear))
            return false;

        if (parsedYear is not (2025 or 2026))
            return false;

        revitYear = parsedYear;
        return true;
    }

    [GeneratedRegex(@"\.R(?<year>\d{2}|\d{4})(?:\.|$)", RegexOptions.IgnoreCase)]
    private static partial Regex RevitConfigurationRegex();
}
