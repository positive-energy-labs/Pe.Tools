using Build.Options;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using ModularPipelines.Attributes;
using ModularPipelines.Context;
using ModularPipelines.FileSystem;
using ModularPipelines.Git.Extensions;
using ModularPipelines.Modules;
using ModularPipelines.Options;
using Pe.Shared.Product;
using Pe.Shared.RevitVersions;
using Shouldly;
using File = ModularPipelines.FileSystem.File;

namespace Build.Modules;

/// <summary>
///     Build the product-specific host, Pea, and Revit payload sources, then delegate the portable
///     install package and MSI transports to the SDK from the checked-in manifest.
/// </summary>
[DependsOn<ResolveVersioningModule>]
[DependsOn<ResolveBuildMatrixModule>]
[DependsOn<ResolveBuildLayoutModule>]
[DependsOn<PublishRevitAddinModule>]
public sealed class CreateInstallerModule(IOptions<BuildOptions> buildOptions) : Module {
    private const string SourceManifestFileName = "product.payloads.json";

    protected override async Task ExecuteModuleAsync(IModuleContext context, CancellationToken cancellationToken) {
        var versioningResult = await context.GetModule<ResolveVersioningModule>();
        var matrixResult = await context.GetModule<ResolveBuildMatrixModule>();
        var layoutResult = await context.GetModule<ResolveBuildLayoutModule>();
        var versioning = versioningResult.ValueOrDefault!;
        var matrix = matrixResult.ValueOrDefault!;
        var layout = layoutResult.ValueOrDefault!;
        var rootDirectory = context.Git().RootDirectory;

        var hostPackageDirectory = rootDirectory.GetFolder("source").GetFolder("pe-tools").GetFolder("apps").GetFolder("host");
        // Presence check only: the payload name/entry now come from the checked-in manifest, but the
        // build still asserts the repo has exactly one RevitAddin project to stage.
        _ = BuildProjectDiscovery.AssemblyName(
            BuildProjectDiscovery.FindSingleProjectByKind(rootDirectory.Path, "RevitAddin")
        );
        var sourceManifestPath = Path.Combine(rootDirectory.Path, SourceManifestFileName);
        System.IO.File.Exists(sourceManifestPath)
            .ShouldBeTrue($"Checked-in payload manifest not found: {sourceManifestPath}");

        var configurations = matrix.ResolveConfigurations(BuildConfigurationGroup.Pack, buildOptions.Value.Configuration);
        var targetDirectories = configurations
            .Select(layout.GetRevitPublishDirectory)
            .Where(Directory.Exists)
            .ToArray();

        targetDirectories.ShouldNotBeEmpty("No content were found to create an installer");
        context.Logger.LogInformation(
            "Installer will include {Count} Revit publish directories: {Directories}",
            targetDirectories.Length,
            string.Join(", ", targetDirectories)
        );
        _ = StageRevitPayload(context, layout, configurations);

        await PublishRuntimeAsync(
            context,
            hostPackageDirectory,
            cancellationToken
        );

        var peaPackageDirectory = rootDirectory.GetFolder("source").GetFolder("pe-tools").GetFolder("apps").GetFolder("pea");
        await PublishPeaAsync(
            context,
            peaPackageDirectory,
            cancellationToken
        );

        Directory.CreateDirectory(layout.Artifacts.InstallerPackagesRoot);
        foreach (var existingInstallerPath in Directory.EnumerateFiles(layout.Artifacts.InstallerPackagesRoot, "*.msi"))
            System.IO.File.Delete(existingInstallerPath);

        var sdkInstallerOutputRoot = layout.GetSdkInstallerOutputRoot();
        if (Directory.Exists(sdkInstallerOutputRoot)) {
            foreach (var existingInstallerPath in Directory.EnumerateFiles(sdkInstallerOutputRoot, "*.msi"))
                System.IO.File.Delete(existingInstallerPath);
        }

        var installPackagePath = layout.GetInstallPackagePath(versioning.Version);
        await context.Shell.Command.ExecuteCommandLineTool(
            new GenericCommandLineToolOptions("dotnet") {
                Arguments = [
                    "tool", "run", "pe-revit", "--", "install", "package",
                    "--manifest", sourceManifestPath, "--output", installPackagePath
                ]
            },
            new CommandExecutionOptions { WorkingDirectory = rootDirectory.Path },
            cancellationToken
        );
        context.Summary.KeyValue("Artifacts", "Install package", installPackagePath);

        context.Logger.LogInformation(
            "Running SDK MSI helper. Manifest={Manifest}; output={Output}",
            sourceManifestPath,
            sdkInstallerOutputRoot
        );
        var msiArguments = new List<string> {
            "tool",
            "run",
            "pe-revit",
            "--",
            "msi",
            "--manifest",
            sourceManifestPath
        };
        if (versioning.IsPrerelease)
            msiArguments.Add("--allow-prerelease-msi");

        await context.Shell.Command.ExecuteCommandLineTool(
            new GenericCommandLineToolOptions("dotnet") {
                Arguments = [.. msiArguments]
            },
            new CommandExecutionOptions {
                WorkingDirectory = rootDirectory.Path
            },
            cancellationToken
        );

        context.Logger.LogInformation("SDK MSI helper finished. Scanning output directory.");
        var outputFiles = Directory.EnumerateFiles(sdkInstallerOutputRoot, "*.msi", SearchOption.TopDirectoryOnly)
            .Where(path => Path.GetFileName(path).Contains(versioning.Version, StringComparison.OrdinalIgnoreCase))
            .ToArray();
        outputFiles.ShouldNotBeEmpty("SDK MSI helper did not create an installer");

        foreach (var outputFile in outputFiles) {
            var packagePath = Path.Combine(layout.Artifacts.InstallerPackagesRoot, Path.GetFileName(outputFile));
            System.IO.File.Copy(outputFile, packagePath, true);
            context.Summary.KeyValue("Artifacts", "Installer", new File(packagePath).Path);
        }
    }

    private static async Task PublishRuntimeAsync(
        IModuleContext context,
        Folder hostPackageDirectory,
        CancellationToken cancellationToken
    ) {
        context.Logger.LogInformation("Building TS host runtime for installer packaging.");
        await context.Shell.Command.ExecuteCommandLineTool(
            new GenericCommandLineToolOptions("pnpm") { Arguments = ["--filter", "@pe/host", "build:payload"] },
            new CommandExecutionOptions { WorkingDirectory = hostPackageDirectory.Parent!.Parent!.Path },
            cancellationToken
        );

        var builtHostDirectory = Path.Combine(hostPackageDirectory.Path, "dist-installed");
        var runtimePublishDirectory = new Folder(builtHostDirectory);
        var builtHostExecutable = Path.Combine(builtHostDirectory, HostProcessIdentity.ExecutableName);
        System.IO.File.Exists(builtHostExecutable)
            .ShouldBeTrue($"TS host executable build did not create {builtHostExecutable}");

        runtimePublishDirectory.GetFiles(file => file.Exists)
            .ShouldNotBeEmpty("Failed to publish the shared runtime for installer packaging.");
        runtimePublishDirectory.GetFile(HostProcessIdentity.ExecutableName).Exists
            .ShouldBeTrue("Failed to publish TS host for installer packaging.");
        runtimePublishDirectory.GetFile("web/client/index.html").Exists
            .ShouldBeTrue("Installer runtime publish should include the staged web SPA.");
        runtimePublishDirectory.GetFile(PeDevCliIdentity.ExecutableName).Exists
            .ShouldBeFalse("Installer runtime publish should not include pe-dev.");

        context.Logger.LogInformation("Finished publishing TS host runtime for installer packaging.");
    }

    private static async Task PublishPeaAsync(
        IModuleContext context,
        Folder peaPackageDirectory,
        CancellationToken cancellationToken
    ) {
        context.Logger.LogInformation("Building TS pea runtime for installer packaging.");
        await context.Shell.Command.ExecuteCommandLineTool(
            new GenericCommandLineToolOptions("pnpm") { Arguments = ["--filter", "@pe/pea", "build:installed"] },
            new CommandExecutionOptions { WorkingDirectory = peaPackageDirectory.Parent!.Parent!.Path },
            cancellationToken
        );

        var builtPeaDirectory = Path.Combine(peaPackageDirectory.Path, "dist-installed");
        var peaPublishDirectory = new Folder(builtPeaDirectory);
        var builtPeaExecutable = Path.Combine(builtPeaDirectory, PeaCliIdentity.ExecutableName);
        System.IO.File.Exists(builtPeaExecutable)
            .ShouldBeTrue($"TS pea executable build did not create {builtPeaExecutable}");

        peaPublishDirectory.GetFiles(file => file.Exists)
            .ShouldNotBeEmpty("Failed to publish the pea runtime for installer packaging.");
        peaPublishDirectory.GetFile(PeaCliIdentity.ExecutableName).Exists
            .ShouldBeTrue("Failed to publish TS pea for installer packaging.");

        context.Logger.LogInformation("Finished publishing TS pea runtime for installer packaging.");
    }

    private static Folder StageRevitPayload(
        IModuleContext context,
        ProductLayoutAuthority layout,
        IReadOnlyCollection<string> configurations
    ) {
        var payloadRoot = new Folder(layout.GetSdkInstallerRevitPayloadRoot());
        if (Directory.Exists(payloadRoot.Path))
            Directory.Delete(payloadRoot.Path, true);

        Directory.CreateDirectory(payloadRoot.Path);
        foreach (var configuration in configurations) {
            RevitVersionCatalog.TryResolveFromConfiguration(configuration, out var spec)
                .ShouldBeTrue($"Installer configuration '{configuration}' does not map to a Revit year.");

            var source = layout.GetRevitPublishDirectory(configuration);
            Directory.Exists(source).ShouldBeTrue($"No Revit publish content was found for {configuration}: {source}");

            var destination = Path.Combine(payloadRoot.Path, spec.Year.ToString());
            CopyDirectory(source, destination);
            context.Logger.LogInformation(
                "Staged Revit add-in payload for {Configuration}: {Source} -> {Destination}",
                configuration,
                source,
                destination
            );
        }

        return payloadRoot;
    }

    private static void CopyDirectory(string source, string destination) {
        Directory.CreateDirectory(destination);
        foreach (var directory in Directory.EnumerateDirectories(source, "*", SearchOption.AllDirectories))
            Directory.CreateDirectory(Path.Combine(destination, Path.GetRelativePath(source, directory)));

        foreach (var file in Directory.EnumerateFiles(source, "*", SearchOption.AllDirectories))
            System.IO.File.Copy(file, Path.Combine(destination, Path.GetRelativePath(source, file)), true);
    }
}
