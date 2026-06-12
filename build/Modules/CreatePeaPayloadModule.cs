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
        var peToolsDirectory = rootDirectory.GetFolder("source").GetFolder("pe-tools");
        var payloadDirectory = new Folder(layout.GetPeaPayloadStagingDirectory("Release", version));
        var bootstrapDirectory = new Folder(layout.GetPeaBootstrapStagingDirectory("Release"));

        DeleteDirectoryIfExists(payloadDirectory.Path);
        DeleteDirectoryIfExists(bootstrapDirectory.Path);
        Directory.CreateDirectory(payloadDirectory.Path);
        Directory.CreateDirectory(bootstrapDirectory.Path);
        Directory.CreateDirectory(layout.Artifacts.PeaPackagesRoot);

        var appDirectory = Path.Combine(payloadDirectory.Path, PeaCliIdentity.AppDirectoryName);
        Directory.CreateDirectory(appDirectory);

        context.Logger.LogInformation("Bundling installed pea app with Bun: {Directory}", peToolsDirectory.Path);
        await context.Shell.Command.ExecuteCommandLineTool(
            new GenericCommandLineToolOptions("bun") {
                Arguments = [
                    "build",
                    "apps/pea/src/installed-main.ts",
                    "--target=bun",
                    "--external",
                    "@opentui/core-*",
                    "--external",
                    "@duckdb/node-bindings-*",
                    "--outdir",
                    appDirectory
                ]
            },
            new CommandExecutionOptions { WorkingDirectory = peToolsDirectory.Path },
            cancellationToken
        );

        var bunExecutablePath = ResolveExecutableFromPath(PeaCliIdentity.BunExecutableName);
        context.Logger.LogInformation("Copying Bun runtime into pea payload: {Path}", bunExecutablePath);
        System.IO.File.Copy(
            bunExecutablePath,
            Path.Combine(payloadDirectory.Path, PeaCliIdentity.BunExecutableName),
            true
        );

        CopyNativeSidecars(peToolsDirectory.Path, payloadDirectory.Path);
        ValidateInstalledBunPayload(payloadDirectory.Path);

        await System.IO.File.WriteAllTextAsync(
            Path.Combine(bootstrapDirectory.Path, PeaCliIdentity.LauncherName),
            PeaLauncherContent.Create(),
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

    private static string ResolveExecutableFromPath(string executableName) {
        var path = Environment.GetEnvironmentVariable("PATH");
        path.ShouldNotBeNullOrWhiteSpace($"PATH is required to locate {executableName} for pea packaging.");

        foreach (var directory in path.Split(Path.PathSeparator, StringSplitOptions.RemoveEmptyEntries)) {
            var candidate = Path.Combine(directory.Trim('"'), executableName);
            if (System.IO.File.Exists(candidate))
                return candidate;
        }

        throw new FileNotFoundException($"Could not find {executableName} on PATH for pea packaging.");
    }

    private static void CopyNativeSidecars(string peToolsDirectory, string payloadDirectory) {
        var pnpmStoreDirectory = Path.Combine(peToolsDirectory, "node_modules", ".pnpm");
        Directory.Exists(pnpmStoreDirectory).ShouldBeTrue(
            $"pea native sidecar packaging requires an installed pe-tools dependency store: {pnpmStoreDirectory}"
        );

        // These are deliberate native sidecars: Bun can bundle the JS graph, but these packages load
        // platform-native binaries from real file paths at runtime. Keep this list explicit so any
        // future compatibility cost is visible in packaging and docs instead of hidden in node_modules.
        CopyPackageSidecar(
            pnpmStoreDirectory,
            "@opentui+core-win32-x64@*",
            Path.Combine("node_modules", "@opentui", "core-win32-x64"),
            Path.Combine(payloadDirectory, "node_modules", "@opentui", "core-win32-x64")
        );
        CopyPackageSidecar(
            pnpmStoreDirectory,
            "@duckdb+node-bindings-win32-x64@*",
            Path.Combine("node_modules", "@duckdb", "node-bindings-win32-x64"),
            Path.Combine(payloadDirectory, "node_modules", "@duckdb", "node-bindings-win32-x64")
        );
        CopyPackageSidecar(
            pnpmStoreDirectory,
            "onnxruntime-node@*",
            Path.Combine("node_modules", "onnxruntime-node", "bin", "napi-v6", "win32", "x64"),
            Path.Combine(payloadDirectory, "bin", "napi-v6", "win32", "x64")
        );
    }

    private static void CopyPackageSidecar(
        string pnpmStoreDirectory,
        string packageDirectoryPattern,
        string packageRelativePath,
        string destinationPath
    ) {
        var packageDirectory = Directory.GetDirectories(pnpmStoreDirectory, packageDirectoryPattern, SearchOption.TopDirectoryOnly)
            .OrderBy(path => path, StringComparer.OrdinalIgnoreCase)
            .LastOrDefault();
        packageDirectory.ShouldNotBeNull($"Could not find required pea native sidecar package: {packageDirectoryPattern}");

        var sourcePath = Path.Combine(packageDirectory, packageRelativePath);
        Directory.Exists(sourcePath).ShouldBeTrue($"Required pea native sidecar directory was not found: {sourcePath}");
        CopyDirectory(sourcePath, destinationPath);
    }

    private static void CopyDirectory(string sourcePath, string destinationPath) {
        Directory.CreateDirectory(destinationPath);
        foreach (var directory in Directory.EnumerateDirectories(sourcePath, "*", SearchOption.AllDirectories)) {
            var relativePath = Path.GetRelativePath(sourcePath, directory);
            Directory.CreateDirectory(Path.Combine(destinationPath, relativePath));
        }

        foreach (var file in Directory.EnumerateFiles(sourcePath, "*", SearchOption.AllDirectories)) {
            var relativePath = Path.GetRelativePath(sourcePath, file);
            var destinationFile = Path.Combine(destinationPath, relativePath);
            Directory.CreateDirectory(Path.GetDirectoryName(destinationFile)!);
            System.IO.File.Copy(file, destinationFile, true);
        }
    }

    private static void ValidateInstalledBunPayload(string payloadDirectory) {
        System.IO.File.Exists(Path.Combine(payloadDirectory, PeaCliIdentity.BunExecutableName))
            .ShouldBeTrue("pea payload is missing bun.exe.");
        System.IO.File.Exists(Path.Combine(
                payloadDirectory,
                PeaCliIdentity.AppDirectoryName,
                PeaCliIdentity.InstalledMainFileName
            ))
            .ShouldBeTrue("pea payload is missing app/installed-main.js.");
        Directory.Exists(Path.Combine(payloadDirectory, "node_modules", "@opentui", "core-win32-x64"))
            .ShouldBeTrue("pea payload is missing OpenTUI win32-x64 native sidecar.");
        Directory.Exists(Path.Combine(payloadDirectory, "node_modules", "@duckdb", "node-bindings-win32-x64"))
            .ShouldBeTrue("pea payload is missing DuckDB win32-x64 native sidecar.");
        Directory.Exists(Path.Combine(payloadDirectory, "bin", "napi-v6", "win32", "x64"))
            .ShouldBeTrue("pea payload is missing onnxruntime win32-x64 native sidecar.");
    }

    private static void DeleteDirectoryIfExists(string path) {
        if (!Directory.Exists(path))
            return;

        DeleteDirectoryTree(new DirectoryInfo(path));
    }

    private static void DeleteDirectoryTree(DirectoryInfo directory) {
        directory.Attributes = FileAttributes.Normal;
        foreach (var entry in directory.EnumerateFileSystemInfos()) {
            var isReparsePoint = (entry.Attributes & FileAttributes.ReparsePoint) != 0;
            entry.Attributes = FileAttributes.Normal;
            if (entry is DirectoryInfo childDirectory) {
                if (isReparsePoint)
                    childDirectory.Delete(false);
                else
                    DeleteDirectoryTree(childDirectory);
            } else {
                entry.Delete();
            }
        }

        directory.Delete(false);
    }

    private static async Task<string> ComputeSha256Async(string path, CancellationToken cancellationToken) {
        await using var stream = System.IO.File.OpenRead(path);
        var hash = await SHA256.HashDataAsync(stream, cancellationToken);
        return Convert.ToHexString(hash).ToLowerInvariant();
    }
}
