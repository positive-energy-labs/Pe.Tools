using Build.Options;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using ModularPipelines.Attributes;
using ModularPipelines.Context;
using ModularPipelines.DotNet.Extensions;
using ModularPipelines.DotNet.Options;
using ModularPipelines.FileSystem;
using ModularPipelines.Git.Extensions;
using ModularPipelines.Modules;
using ModularPipelines.Options;
using Pe.Shared.Product;
using Shouldly;
using Sourcy.DotNet;
using File = ModularPipelines.FileSystem.File;
using InstallerOptions = Build.Options.InstallerOptions;

namespace Build.Modules;

/// <summary>
///     Create the .msi installer.
/// </summary>
[DependsOn<ResolveVersioningModule>]
[DependsOn<ResolveBuildMatrixModule>]
[DependsOn<ResolveBuildLayoutModule>]
[DependsOn<PublishRevitAddinModule>]
[DependsOn<CreatePeaPayloadModule>]
public sealed class CreateInstallerModule(
    IOptions<BuildOptions> buildOptions,
    IOptions<InstallerOptions> installerOptions) : Module {
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

        var hostProject = rootDirectory.GetFolder("source").GetFolder("Pe.Host").GetFile("Pe.Host.csproj");
        var peDevProject = rootDirectory.GetFolder("source").GetFolder("Pe.Dev.Cli").GetFile("Pe.Dev.Cli.csproj");
        var wixInstaller = new File(Projects.Installer.FullName);
        context.Logger.LogInformation("Preparing WiX toolchain for installer packaging.");
        var wixToolFolder = await InstallWixAsync(context, layout, cancellationToken);

        context.Logger.LogInformation("Validating installer assets.");
        ValidateInstallerAssets(rootDirectory, installerOptions.Value);

        context.Logger.LogInformation("Building installer authoring executable: {Project}", wixInstaller.Path);
        await BuildDotNetCli.BuildQuietAsync(
            context,
            wixInstaller.Path,
            "Release",
            [],
            cancellationToken
        );

        var builderFile = wixInstaller.Folder!
            .GetFolder("bin")
            .GetFolder("Release")
            .GetFolder("net8.0-windows")
            .GetFile($"{wixInstaller.NameWithoutExtension}.exe");

        builderFile.Exists.ShouldBeTrue(
            $"No installer builder was found for the project: {wixInstaller.NameWithoutExtension}");

        var targetDirectories = matrix.ResolveConfigurations(BuildConfigurationGroup.Pack, buildOptions.Value.Configuration)
            .Select(layout.GetRevitPublishDirectory)
            .Where(Directory.Exists)
            .ToArray();

        targetDirectories.ShouldNotBeEmpty("No content were found to create an installer");
        context.Logger.LogInformation(
            "Installer will include {Count} Revit publish directories: {Directories}",
            targetDirectories.Length,
            string.Join(", ", targetDirectories)
        );

        var runtimePublishDirectory = await PublishRuntimeAsync(
            context,
            hostProject,
            layout,
            cancellationToken
        );
        var peDevPublishDirectory = await PublishPeDevAsync(
            context,
            peDevProject,
            layout,
            cancellationToken
        );
        Directory.CreateDirectory(layout.Artifacts.InstallerPackagesRoot);
        foreach (var existingInstallerPath in Directory.EnumerateFiles(layout.Artifacts.InstallerPackagesRoot, "*.msi"))
            System.IO.File.Delete(existingInstallerPath);

        var installerPayloadManifestPath = await layout.WriteInstallerPayloadManifestAsync(
            versioning.Version,
            runtimePublishDirectory.Path,
            peaPayload,
            peDevPublishDirectory.Path,
            targetDirectories,
            cancellationToken
        );

        context.Logger.LogInformation(
            "Running installer authoring executable. Manifest={Manifest}; output={Output}",
            installerPayloadManifestPath,
            layout.Artifacts.InstallerPackagesRoot
        );
        context.Logger.LogInformation(
            "Installer authoring will write incremental details to {LogPath}",
            Path.Combine(layout.Artifacts.InstallerPackagesRoot, "Pe.Tools.Installer.latest.log")
        );
        await context.Shell.Command.ExecuteCommandLineTool(
            new GenericCommandLineToolOptions(builderFile.Path) {
                Arguments = ["--manifest", installerPayloadManifestPath]
            },
            new CommandExecutionOptions {
                WorkingDirectory = wixInstaller.Folder,
                EnvironmentVariables =
                    new Dictionary<string, string?> {
                        { "PATH", $"{Environment.GetEnvironmentVariable("PATH")};{wixToolFolder}" }
                    }
            }, cancellationToken);

        context.Logger.LogInformation("Installer authoring executable finished. Scanning output directory.");
        var outputFiles = Directory.EnumerateFiles(layout.Artifacts.InstallerPackagesRoot, "*.msi", SearchOption.TopDirectoryOnly)
            .Where(path => Path.GetFileName(path).Contains(versioning.Version, StringComparison.OrdinalIgnoreCase))
            .Select(path => new File(path))
            .ToArray();
        outputFiles.ShouldNotBeEmpty("Failed to create an installer");

        foreach (var outputFile in outputFiles)
            context.Summary.KeyValue("Artifacts", "Installer", outputFile.Path);
    }

    private static async Task<Folder> PublishRuntimeAsync(
        IModuleContext context,
        File hostProject,
        ProductLayoutAuthority layout,
        CancellationToken cancellationToken
    ) {
        if (Directory.Exists(layout.GetHostPublishDirectory("Release")))
            Directory.Delete(layout.GetHostPublishDirectory("Release"), true);

        Directory.CreateDirectory(layout.GetHostPublishDirectory("Release"));
        var runtimePublishDirectory = new Folder(layout.GetHostPublishDirectory("Release"));

        context.Logger.LogInformation("Publishing Pe.Host runtime for installer packaging: {Output}", runtimePublishDirectory.Path);
        await BuildDotNetCli.PublishQuietAsync(
            context,
            hostProject.Path,
            "Release",
            [
                "-r",
                "win-x64",
                "--self-contained",
                "false",
                "-o",
                runtimePublishDirectory.Path
            ],
            [("PeIsolatedBuild", "true")],
            cancellationToken
        );

        runtimePublishDirectory.GetFiles(file => file.Exists)
            .ShouldNotBeEmpty("Failed to publish the shared runtime for installer packaging.");
        runtimePublishDirectory.GetFile(HostProcessIdentity.ExecutableName).Exists
            .ShouldBeTrue("Failed to publish Pe.Host for installer packaging.");
        runtimePublishDirectory.GetFile(PeDevCliIdentity.ExecutableName).Exists
            .ShouldBeFalse("Installer runtime publish should not include pe-dev.");

        context.Logger.LogInformation("Finished publishing Pe.Host runtime for installer packaging.");
        return runtimePublishDirectory;
    }

    private static async Task<Folder> PublishPeDevAsync(
        IModuleContext context,
        File peDevProject,
        ProductLayoutAuthority layout,
        CancellationToken cancellationToken
    ) {
        if (Directory.Exists(layout.GetPeDevPublishDirectory("Release")))
            Directory.Delete(layout.GetPeDevPublishDirectory("Release"), true);

        Directory.CreateDirectory(layout.GetPeDevPublishDirectory("Release"));
        var peDevPublishDirectory = new Folder(layout.GetPeDevPublishDirectory("Release"));

        context.Logger.LogInformation("Publishing pe-dev for installer packaging: {Output}", peDevPublishDirectory.Path);
        await BuildDotNetCli.PublishQuietAsync(
            context,
            peDevProject.Path,
            "Release",
            [
                "-r",
                "win-x64",
                "--self-contained",
                "false",
                "-o",
                peDevPublishDirectory.Path
            ],
            [("PeIsolatedBuild", "true")],
            cancellationToken
        );

        peDevPublishDirectory.GetFiles(file => file.Exists)
            .ShouldNotBeEmpty("Failed to publish pe-dev for installer packaging.");
        peDevPublishDirectory.GetFile(PeDevCliIdentity.ExecutableName).Exists
            .ShouldBeTrue("Failed to publish pe-dev for installer packaging.");

        context.Logger.LogInformation("Finished publishing pe-dev for installer packaging.");
        return peDevPublishDirectory;
    }

    private static async Task<Folder> InstallWixAsync(
        IModuleContext context,
        ProductLayoutAuthority layout,
        CancellationToken cancellationToken
    ) {
        var wixToolFolder = new Folder(Path.Combine(layout.Artifacts.ToolsRoot, "wix-7"));
        var wixExe = wixToolFolder.GetFile("wix.exe");

        if (!wixExe.Exists) {
            _ = Directory.CreateDirectory(wixToolFolder.Path);
            context.Logger.LogInformation("Installing WiX CLI into cached tool folder: {Folder}", wixToolFolder.Path);
            _ = await context.DotNet().Tool
                .Execute(
                    new DotNetToolOptions {
                        Arguments = ["install", "wix", "--version", "7.*", "--tool-path", wixToolFolder.Path]
                    }, cancellationToken: cancellationToken);
        } else {
            context.Logger.LogInformation("Using cached WiX CLI: {Path}", wixExe.Path);
        }

        context.Logger.LogInformation("Accepting WiX EULA.");
        _ = await context.Shell.Command.ExecuteCommandLineTool(
            new GenericCommandLineToolOptions(wixExe.Path) { Arguments = ["eula", "accept", "wix7"] },
            cancellationToken: cancellationToken);

        context.Logger.LogInformation("Ensuring WiX UI extension is available.");
        _ = await context.Shell.Command.ExecuteCommandLineTool(
            new GenericCommandLineToolOptions(wixExe.Path) {
                Arguments = ["extension", "add", "-g", "WixToolset.UI.wixext"]
            }, cancellationToken: cancellationToken);

        context.Logger.LogInformation("WiX toolchain is ready.");
        return wixToolFolder;
    }

    private static void ValidateInstallerAssets(Folder rootDirectory, InstallerOptions options) {
        var requiredFiles = new[] { options.BannerImagePath, options.BackgroundImagePath, options.ProductIconPath };

        foreach (var relativeOrAbsolutePath in requiredFiles) {
            var resolvedPath = Path.IsPathRooted(relativeOrAbsolutePath)
                ? relativeOrAbsolutePath
                : Path.Combine(rootDirectory.Path, relativeOrAbsolutePath);

            System.IO.File.Exists(resolvedPath)
                .ShouldBeTrue($"Installer asset was not found: {resolvedPath}");
        }
    }
}

// PE_HOT_RELOAD_NUDGE
