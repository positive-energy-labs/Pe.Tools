using System.Text.Json;
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
///     Create the .msi installer.
/// </summary>
[DependsOn<ResolveVersioningModule>]
[DependsOn<ResolveBuildMatrixModule>]
[DependsOn<ResolveBuildLayoutModule>]
[DependsOn<PublishRevitAddinModule>]
[DependsOn<CreatePeaPayloadModule>]
public sealed class CreateInstallerModule(IOptions<BuildOptions> buildOptions) : Module {
    private static readonly JsonSerializerOptions JsonOptions = new() {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        WriteIndented = true
    };

    protected override async Task ExecuteModuleAsync(IModuleContext context, CancellationToken cancellationToken) {
        var versioningResult = await context.GetModule<ResolveVersioningModule>();
        var matrixResult = await context.GetModule<ResolveBuildMatrixModule>();
        var layoutResult = await context.GetModule<ResolveBuildLayoutModule>();
        var peaPayloadResult = await context.GetModule<CreatePeaPayloadModule>();
        var versioning = versioningResult.ValueOrDefault!;
        var matrix = matrixResult.ValueOrDefault!;
        var layout = layoutResult.ValueOrDefault!;
        var peaPayload = peaPayloadResult.ValueOrDefault!;
        var rootDirectory = context.Git().RootDirectory;

        var hostPackageDirectory = rootDirectory.GetFolder("source").GetFolder("pe-tools").GetFolder("apps").GetFolder("host");
        var appAssemblyName = BuildProjectDiscovery.AssemblyName(
            BuildProjectDiscovery.FindSingleProjectByKind(rootDirectory.Path, "RevitAddin")
        );
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
        var revitPayloadRoot = StageRevitPayload(context, layout, configurations);

        var runtimePublishDirectory = await PublishRuntimeAsync(
            context,
            hostPackageDirectory,
            layout,
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

        var installerPayloadManifestPath = await WriteSdkInstallerPayloadManifestAsync(
            layout,
            versioning.Version,
            runtimePublishDirectory.Path,
            peaPayload,
            appAssemblyName,
            revitPayloadRoot.Path,
            cancellationToken
        );

        context.Logger.LogInformation(
            "Running SDK MSI helper. Manifest={Manifest}; output={Output}",
            installerPayloadManifestPath,
            sdkInstallerOutputRoot
        );
        var msiArguments = new List<string> {
            "tool",
            "run",
            "pe-revit",
            "--",
            "msi",
            "--manifest",
            installerPayloadManifestPath,
            "--version",
            versioning.Version
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

    private static async Task<Folder> PublishRuntimeAsync(
        IModuleContext context,
        Folder hostPackageDirectory,
        ProductLayoutAuthority layout,
        CancellationToken cancellationToken
    ) {
        if (Directory.Exists(layout.GetHostPublishDirectory("Release")))
            Directory.Delete(layout.GetHostPublishDirectory("Release"), true);

        Directory.CreateDirectory(layout.GetHostPublishDirectory("Release"));
        var runtimePublishDirectory = new Folder(layout.GetHostPublishDirectory("Release"));

        context.Logger.LogInformation("Building TS host runtime for installer packaging: {Output}", runtimePublishDirectory.Path);
        await context.Shell.Command.ExecuteCommandLineTool(
            new GenericCommandLineToolOptions("vp") { Arguments = ["pack"] },
            new CommandExecutionOptions { WorkingDirectory = hostPackageDirectory.Path },
            cancellationToken
        );

        var builtHostExecutable = Path.Combine(hostPackageDirectory.Path, "dist-installed", HostProcessIdentity.ExecutableName);
        System.IO.File.Exists(builtHostExecutable)
            .ShouldBeTrue($"TS host executable build did not create {builtHostExecutable}");
        System.IO.File.Copy(
            builtHostExecutable,
            runtimePublishDirectory.GetFile(HostProcessIdentity.ExecutableName).Path,
            true
        );

        runtimePublishDirectory.GetFiles(file => file.Exists)
            .ShouldNotBeEmpty("Failed to publish the shared runtime for installer packaging.");
        runtimePublishDirectory.GetFile(HostProcessIdentity.ExecutableName).Exists
            .ShouldBeTrue("Failed to publish TS host for installer packaging.");
        runtimePublishDirectory.GetFile(PeDevCliIdentity.ExecutableName).Exists
            .ShouldBeFalse("Installer runtime publish should not include pe-dev.");

        context.Logger.LogInformation("Finished publishing TS host runtime for installer packaging.");
        return runtimePublishDirectory;
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

    private static async Task<string> WriteSdkInstallerPayloadManifestAsync(
        ProductLayoutAuthority layout,
        string version,
        string runtimePublishDirectory,
        PeaPayloadArtifacts peaPayload,
        string appAssemblyName,
        string revitPayloadRoot,
        CancellationToken cancellationToken
    ) {
        var peaPayloadDirectory = layout.GetPeaPayloadStagingDirectory("Release", peaPayload.Version);
        Directory.Exists(peaPayloadDirectory)
            .ShouldBeTrue($"No pea versioned payload was found for installer packaging: {peaPayloadDirectory}");

        var manifest = new SdkInstallManifest(
            ProductIdentity.ProductName,
            ProductIdentity.VendorName,
            [
                new("RevitAddin", appAssemblyName, revitPayloadRoot),
                new("Exe", HostProcessIdentity.DirectoryName, runtimePublishDirectory),
                new("VersionedApp", PeaCliIdentity.DirectoryName, peaPayloadDirectory),
                new(
                    "PathShim",
                    Path.GetFileNameWithoutExtension(PeaCliIdentity.LauncherName),
                    Target: $"versionedApp:{PeaCliIdentity.DirectoryName}",
                    Entry: Path.Combine(PeaCliIdentity.AppDirectoryName, PeaCliIdentity.InstalledExecutableName)
                )
            ]
        );

        var manifestPath = layout.GetSdkInstallerPayloadManifestPath(version);
        Directory.CreateDirectory(Path.GetDirectoryName(manifestPath)!);
        await System.IO.File.WriteAllTextAsync(
            manifestPath,
            JsonSerializer.Serialize(manifest, JsonOptions),
            cancellationToken
        );
        return manifestPath;
    }

    private static void CopyDirectory(string source, string destination) {
        Directory.CreateDirectory(destination);
        foreach (var directory in Directory.EnumerateDirectories(source, "*", SearchOption.AllDirectories))
            Directory.CreateDirectory(Path.Combine(destination, Path.GetRelativePath(source, directory)));

        foreach (var file in Directory.EnumerateFiles(source, "*", SearchOption.AllDirectories))
            System.IO.File.Copy(file, Path.Combine(destination, Path.GetRelativePath(source, file)), true);
    }

    private sealed record SdkInstallManifest(
        string Product,
        string Vendor,
        IReadOnlyList<SdkInstallPayload> Payloads
    );

    private sealed record SdkInstallPayload(
        string Type,
        string Name,
        string? Source = null,
        string? Target = null,
        string? Entry = null
    );
}
