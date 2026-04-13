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

namespace Build.Modules;

/// <summary>
///     Create the .msi installer.
/// </summary>
[DependsOn<ResolveVersioningModule>]
[DependsOn<CompileProjectModule>]
public sealed class CreateInstallerModule(
    IOptions<BuildOptions> buildOptions,
    IOptions<Build.Options.InstallerOptions> installerOptions) : Module {
    protected override async Task ExecuteModuleAsync(IModuleContext context, CancellationToken cancellationToken) {
        var versioningResult = await context.GetModule<ResolveVersioningModule>();
        var versioning = versioningResult.ValueOrDefault!;
        var rootDirectory = context.Git().RootDirectory;

        var wixTarget = new File(Projects.Pe_App.FullName);
        var hostProject = rootDirectory.GetFolder("source").GetFolder("Pe.Host").GetFile("Pe.Host.csproj");
        var wixInstaller = new File(Projects.Installer.FullName);
        var wixToolFolder = await InstallWixAsync(context, cancellationToken);

        ValidateInstallerAssets(rootDirectory, installerOptions.Value);

        await context.DotNet()
            .Build(new DotNetBuildOptions { ProjectSolution = wixInstaller.Path, Configuration = "Release" },
                cancellationToken: cancellationToken);

        var builderFile = wixInstaller.Folder!
            .GetFolder("bin")
            .FindFile(file =>
                file.NameWithoutExtension == wixInstaller.NameWithoutExtension && file.Extension == ".exe");

        builderFile.ShouldNotBeNull(
            $"No installer builder was found for the project: {wixInstaller.NameWithoutExtension}");

        var targetDirectories = wixTarget.Folder!
            .GetFolder("bin")
            .GetFolders(folder => folder.Name == "publish")
            .Select(folder => folder.Path)
            .ToArray();

        targetDirectories.ShouldNotBeEmpty("No content were found to create an installer");

        var hostPublishDirectory = await PublishHostAsync(context, hostProject, cancellationToken);

        await context.Shell.Command.ExecuteCommandLineTool(
            new GenericCommandLineToolOptions(builderFile.Path) {
                Arguments = [versioning.Version, "--host", hostPublishDirectory.Path, ..targetDirectories]
            },
            new CommandExecutionOptions {
                WorkingDirectory = wixInstaller.Folder,
                EnvironmentVariables =
                    new Dictionary<string, string?> {
                        { "PATH", $"{Environment.GetEnvironmentVariable("PATH")};{wixToolFolder}" }
                    }
            }, cancellationToken);

        var outputFolder = rootDirectory.GetFolder(buildOptions.Value.OutputDirectory);
        var outputFiles = outputFolder.GetFiles(file => file.Extension == ".msi").ToArray();
        outputFiles.ShouldNotBeEmpty("Failed to create an installer");

        foreach (var outputFile in outputFiles) context.Summary.KeyValue("Artifacts", "Installer", outputFile.Path);
    }

    private static async Task<Folder> PublishHostAsync(
        IModuleContext context,
        File hostProject,
        CancellationToken cancellationToken
    ) {
        var hostPublishDirectory = hostProject.Folder!
            .GetFolder("bin")
            .CreateFolder("Release")
            .CreateFolder("publish")
            .CreateFolder(SettingsEditorRuntime.HostFolderName);

        await context.Shell.Command.ExecuteCommandLineTool(
            new GenericCommandLineToolOptions("dotnet") {
                Arguments = [
                    "publish",
                    hostProject.Path,
                    "-c",
                    "Release",
                    "-r",
                    "win-x64",
                    "--self-contained",
                    "false",
                    "-o",
                    hostPublishDirectory.Path
                ]
            },
            cancellationToken: cancellationToken
        );

        hostPublishDirectory.GetFiles(file => file.Exists)
            .ShouldNotBeEmpty("Failed to publish Pe.Host for installer packaging.");

        return hostPublishDirectory;
    }

    /// <summary>
    ///     Installs the WiX toolset required for building installers.
    /// </summary>
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

    private static void ValidateInstallerAssets(Folder rootDirectory, Build.Options.InstallerOptions options) {
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
