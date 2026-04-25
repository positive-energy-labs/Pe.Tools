using Build.Options;
using Microsoft.Extensions.Options;
using ModularPipelines.Attributes;
using ModularPipelines.Context;
using ModularPipelines.DotNet.Extensions;
using ModularPipelines.DotNet.Options;
using ModularPipelines.FileSystem;
using ModularPipelines.Git.Extensions;
using ModularPipelines.Modules;
using ModularPipelines.Options;
using Pe.Shared.HostContracts.Protocol;
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
public sealed class CreateInstallerModule(
    IOptions<BuildOptions> buildOptions,
    IOptions<InstallerOptions> installerOptions) : Module {
    protected override async Task ExecuteModuleAsync(IModuleContext context, CancellationToken cancellationToken) {
        var versioningResult = await context.GetModule<ResolveVersioningModule>();
        var matrixResult = await context.GetModule<ResolveBuildMatrixModule>();
        var layoutResult = await context.GetModule<ResolveBuildLayoutModule>();
        var versioning = versioningResult.ValueOrDefault!;
        var matrix = matrixResult.ValueOrDefault!;
        var layout = layoutResult.ValueOrDefault!;
        var rootDirectory = context.Git().RootDirectory;

        var hostProject = rootDirectory.GetFolder("source").GetFolder("Pe.Host").GetFile("Pe.Host.csproj");
        var cliProject = rootDirectory.GetFolder("source").GetFolder("Pe.Dev.Cli").GetFile("Pe.Dev.Cli.csproj");
        var wixInstaller = new File(Projects.Installer.FullName);
        var wixToolFolder = await InstallWixAsync(context, cancellationToken);

        ValidateInstallerAssets(rootDirectory, installerOptions.Value);

        await context.DotNet()
            .Build(new DotNetBuildOptions { ProjectSolution = wixInstaller.Path, Configuration = "Release" },
                cancellationToken: cancellationToken);

        var builderFile = wixInstaller.Folder!
            .GetFolder("bin")
            .GetFolder("Release")
            .GetFolder("net10.0-windows")
            .GetFile($"{wixInstaller.NameWithoutExtension}.exe");

        builderFile.Exists.ShouldBeTrue(
            $"No installer builder was found for the project: {wixInstaller.NameWithoutExtension}");

        var targetDirectories = matrix.ResolveConfigurations(BuildConfigurationGroup.Pack, buildOptions.Value.Configuration)
            .Select(layout.GetRevitPublishDirectory)
            .Where(Directory.Exists)
            .ToArray();

        targetDirectories.ShouldNotBeEmpty("No content were found to create an installer");

        var runtimePublishDirectory = await PublishRuntimeAsync(
            context,
            hostProject,
            cliProject,
            layout,
            cancellationToken
        );

        Directory.CreateDirectory(layout.InstallerPackagesRoot);
        foreach (var existingInstallerPath in Directory.EnumerateFiles(layout.InstallerPackagesRoot, "*.msi"))
            System.IO.File.Delete(existingInstallerPath);

        await context.Shell.Command.ExecuteCommandLineTool(
            new GenericCommandLineToolOptions(builderFile.Path) {
                Arguments = [versioning.Version, "--runtime", runtimePublishDirectory.Path, ..targetDirectories]
            },
            new CommandExecutionOptions {
                WorkingDirectory = wixInstaller.Folder,
                EnvironmentVariables =
                    new Dictionary<string, string?> {
                        { "PATH", $"{Environment.GetEnvironmentVariable("PATH")};{wixToolFolder}" }
                    }
            }, cancellationToken);

        var outputFiles = Directory.EnumerateFiles(layout.InstallerPackagesRoot, "*.msi", SearchOption.TopDirectoryOnly)
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
        File cliProject,
        BuildLayout layout,
        CancellationToken cancellationToken
    ) {
        if (Directory.Exists(layout.GetHostPublishDirectory("Release")))
            Directory.Delete(layout.GetHostPublishDirectory("Release"), true);

        Directory.CreateDirectory(layout.GetHostPublishDirectory("Release"));
        var runtimePublishDirectory = new Folder(layout.GetHostPublishDirectory("Release"));

        foreach (var project in new[] { hostProject, cliProject }) {
            await context.Shell.Command.ExecuteCommandLineTool(
                new GenericCommandLineToolOptions("dotnet") {
                    Arguments = [
                        "publish",
                        project.Path,
                        "-c",
                        "Release",
                        "-r",
                        "win-x64",
                        "--self-contained",
                        "false",
                        "-p:PeIsolatedBuild=true",
                        "-o",
                        runtimePublishDirectory.Path
                    ]
                },
                cancellationToken: cancellationToken
            );
        }

        runtimePublishDirectory.GetFiles(file => file.Exists)
            .ShouldNotBeEmpty("Failed to publish the shared runtime for installer packaging.");
        runtimePublishDirectory.GetFile(SettingsEditorRuntime.HostExecutableName).Exists
            .ShouldBeTrue("Failed to publish Pe.Host for installer packaging.");
        runtimePublishDirectory.GetFile(SettingsEditorRuntime.CliExecutableName).Exists
            .ShouldBeTrue("Failed to publish pe-dev for installer packaging.");

        return runtimePublishDirectory;
    }

    private static async Task<Folder> InstallWixAsync(IModuleContext context, CancellationToken cancellationToken) {
        var wixToolFolder = Folder.CreateTemporaryFolder();
        await context.DotNet().Tool
            .Execute(
                new DotNetToolOptions {
                    Arguments = ["install", "wix", "--version", "7.*", "--tool-path", wixToolFolder.Path]
                }, cancellationToken: cancellationToken);

        var wixExe = wixToolFolder.GetFile("wix.exe");
        await context.Shell.Command.ExecuteCommandLineTool(
            new GenericCommandLineToolOptions(wixExe.Path) { Arguments = ["eula", "accept", "wix7"] },
            cancellationToken: cancellationToken);

        await context.Shell.Command.ExecuteCommandLineTool(
            new GenericCommandLineToolOptions(wixExe.Path) {
                Arguments = ["extension", "add", "-g", "WixToolset.UI.wixext"]
            }, cancellationToken: cancellationToken);

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
