using System.IO.Compression;
using System.Security.Cryptography;
using System.Text.Json;
using Microsoft.Extensions.Logging;
using ModularPipelines.Attributes;
using ModularPipelines.Context;
using ModularPipelines.FileSystem;
using ModularPipelines.Git.Extensions;
using ModularPipelines.Modules;
using ModularPipelines.Options;
using Pe.Shared.Product;
using Shouldly;
using File = ModularPipelines.FileSystem.File;

namespace Build.Modules;

/// <summary>
///     Create the versioned pea app payload and stable launcher bootstrap.
/// </summary>
[DependsOn<ResolveVersioningModule>]
[DependsOn<ResolveBuildLayoutModule>]
[DependsOn<CleanProjectModule>(Optional = true)]
public sealed class CreatePeaPayloadModule : Module<PeaPayloadArtifacts> {
    private static readonly JsonSerializerOptions JsonOptions = new() {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        WriteIndented = true
    };

    protected override async Task<PeaPayloadArtifacts?> ExecuteAsync(
        IModuleContext context,
        CancellationToken cancellationToken
    ) {
        var versioningResult = await context.GetModule<ResolveVersioningModule>();
        var layoutResult = await context.GetModule<ResolveBuildLayoutModule>();
        var versioning = versioningResult.ValueOrDefault!;
        var layout = layoutResult.ValueOrDefault!;
        var version = PeaCliIdentity.NormalizePayloadVersion(versioning.Version);
        var rootDirectory = context.Git().RootDirectory;
        var peaAppDirectory = rootDirectory.GetFolder("source").GetFolder("pea").GetFolder("app");
        var peaNodeExecutable = rootDirectory.GetFolder("source").GetFolder("pea").GetFolder("runtime").GetFolder("node").GetFile("node.exe");
        var payloadDirectory = new Folder(layout.GetPeaPayloadStagingDirectory("Release", version));
        var bootstrapDirectory = new Folder(layout.GetPeaBootstrapStagingDirectory("Release"));

        DeleteDirectoryIfExists(payloadDirectory.Path);
        DeleteDirectoryIfExists(bootstrapDirectory.Path);
        Directory.CreateDirectory(payloadDirectory.Path);
        Directory.CreateDirectory(bootstrapDirectory.Path);
        Directory.CreateDirectory(layout.Artifacts.PeaPackagesRoot);

        peaNodeExecutable.Exists.ShouldBeTrue($"Node runtime was not found for pea packaging: {peaNodeExecutable.Path}");

        context.Logger.LogInformation("Installing pea app dependencies with pnpm: {Directory}", peaAppDirectory.Path);
        await context.Shell.Command.ExecuteCommandLineTool(
            new GenericCommandLineToolOptions("pnpm") { Arguments = ["install", "--no-frozen-lockfile"] },
            new CommandExecutionOptions { WorkingDirectory = peaAppDirectory.Path },
            cancellationToken
        );

        context.Logger.LogInformation("Type-checking pea app.");
        await context.Shell.Command.ExecuteCommandLineTool(
            new GenericCommandLineToolOptions("pnpm") { Arguments = ["run", "check"] },
            new CommandExecutionOptions { WorkingDirectory = peaAppDirectory.Path },
            cancellationToken
        );

        context.Logger.LogInformation("Building pea app.");
        await context.Shell.Command.ExecuteCommandLineTool(
            new GenericCommandLineToolOptions("pnpm") { Arguments = ["run", "build"] },
            new CommandExecutionOptions { WorkingDirectory = peaAppDirectory.Path },
            cancellationToken
        );

        System.IO.File.Copy(
            Path.Combine(peaAppDirectory.Path, "package.json"),
            Path.Combine(payloadDirectory.Path, "package.json"),
            true
        );
        context.Logger.LogInformation("Installing production pea dependencies into payload staging: {Directory}", payloadDirectory.Path);
        await context.Shell.Command.ExecuteCommandLineTool(
            new GenericCommandLineToolOptions("npm") {
                Arguments = ["install", "--omit=dev", "--ignore-scripts", "--package-lock=false"]
            },
            new CommandExecutionOptions { WorkingDirectory = payloadDirectory.Path },
            cancellationToken
        );

        CopyDirectory(Path.Combine(peaAppDirectory.Path, "dist"), Path.Combine(payloadDirectory.Path, "dist"));
        System.IO.File.Copy(peaNodeExecutable.Path, Path.Combine(payloadDirectory.Path, PeaCliIdentity.NodeExecutableName), true);
        await System.IO.File.WriteAllTextAsync(
            Path.Combine(bootstrapDirectory.Path, PeaCliIdentity.LauncherName),
            CreatePeaLauncherContent(),
            cancellationToken
        );

        var archivePath = Path.Combine(layout.Artifacts.PeaPackagesRoot, PeaCliIdentity.CreatePayloadArchiveFileName(version));
        var manifestPath = Path.Combine(layout.Artifacts.PeaPackagesRoot, PeaCliIdentity.CreatePayloadManifestFileName(version));
        if (System.IO.File.Exists(archivePath))
            System.IO.File.Delete(archivePath);
        if (System.IO.File.Exists(manifestPath))
            System.IO.File.Delete(manifestPath);

        context.Logger.LogInformation("Creating pea payload archive: {Archive}", archivePath);
        ZipFile.CreateFromDirectory(payloadDirectory.Path, archivePath, CompressionLevel.Optimal, false);
        var archiveFile = new File(archivePath);
        var sha256 = await ComputeSha256Async(archivePath, cancellationToken);
        var manifest = PeaPayloadManifest.Create(
            version,
            Path.GetFileName(archivePath),
            sha256,
            new FileInfo(archivePath).Length,
            DateTimeOffset.UtcNow.ToString("O"),
            context.Git().Information.LastCommitSha
        );
        await System.IO.File.WriteAllTextAsync(
            manifestPath,
            JsonSerializer.Serialize(manifest, JsonOptions),
            cancellationToken
        );

        archiveFile.Exists.ShouldBeTrue("Failed to create pea payload archive.");
        new File(manifestPath).Exists.ShouldBeTrue("Failed to create pea payload manifest.");
        context.Summary.KeyValue("Artifacts", "pea payload", archiveFile.Path);
        context.Summary.KeyValue("Artifacts", "pea manifest", manifestPath);

        return new PeaPayloadArtifacts(version, bootstrapDirectory, archiveFile, new File(manifestPath));
    }

    private static string CreatePeaLauncherContent() =>
        """
        @echo off
        setlocal
        set "PEA_ROOT=%~dp0"
        set "PEA_CURRENT=%PEA_ROOT%current.txt"
        if not exist "%PEA_CURRENT%" (
          echo pea is installed, but no active payload version is configured. 1>&2
          echo Reinstall Pe.Tools or run pea runtime update from a repaired installation. 1>&2
          exit /b 1
        )
        set /p PEA_VERSION=<"%PEA_CURRENT%"
        set "PEA_VERSION_ROOT=%PEA_ROOT%versions\%PEA_VERSION%"
        set "PEA_NODE=%PEA_VERSION_ROOT%\node.exe"
        set "PEA_MAIN=%PEA_VERSION_ROOT%\dist\main.js"
        if not exist "%PEA_NODE%" (
          echo pea payload '%PEA_VERSION%' is missing node.exe. 1>&2
          exit /b 1
        )
        if not exist "%PEA_MAIN%" (
          echo pea payload '%PEA_VERSION%' is missing dist\main.js. 1>&2
          exit /b 1
        )
        "%PEA_NODE%" "%PEA_MAIN%" %*
        exit /b %ERRORLEVEL%
        """;

    private static void CopyDirectory(string sourceDirectory, string targetDirectory) {
        Directory.Exists(sourceDirectory).ShouldBeTrue($"Directory was not found: {sourceDirectory}");
        Directory.CreateDirectory(targetDirectory);

        foreach (var directory in Directory.EnumerateDirectories(sourceDirectory, "*", SearchOption.AllDirectories))
            Directory.CreateDirectory(directory.Replace(sourceDirectory, targetDirectory, StringComparison.OrdinalIgnoreCase));

        foreach (var file in Directory.EnumerateFiles(sourceDirectory, "*", SearchOption.AllDirectories))
            System.IO.File.Copy(
                file,
                file.Replace(sourceDirectory, targetDirectory, StringComparison.OrdinalIgnoreCase),
                true
            );
    }

    private static void DeleteDirectoryIfExists(string path) {
        if (!Directory.Exists(path))
            return;

        foreach (var file in Directory.EnumerateFiles(path, "*", SearchOption.AllDirectories))
            System.IO.File.SetAttributes(file, FileAttributes.Normal);

        Directory.Delete(path, true);
    }

    private static async Task<string> ComputeSha256Async(string path, CancellationToken cancellationToken) {
        await using var stream = System.IO.File.OpenRead(path);
        var hash = await SHA256.HashDataAsync(stream, cancellationToken);
        return Convert.ToHexString(hash).ToLowerInvariant();
    }
}
