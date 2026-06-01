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
            new GenericCommandLineToolOptions("pnpm") { Arguments = ["install", "--frozen-lockfile"] },
            new CommandExecutionOptions { WorkingDirectory = peaAppDirectory.Path },
            cancellationToken
        );

        context.Logger.LogInformation("Building pea app.");
        await context.Shell.Command.ExecuteCommandLineTool(
            new GenericCommandLineToolOptions("pnpm") { Arguments = ["run", "build"] },
            new CommandExecutionOptions { WorkingDirectory = peaAppDirectory.Path },
            cancellationToken
        );

        context.Logger.LogInformation("Deploying production pea dependencies into payload staging: {Directory}", payloadDirectory.Path);
        await context.Shell.Command.ExecuteCommandLineTool(
            new GenericCommandLineToolOptions("pnpm") {
                Arguments = [
                    "--filter",
                    ".",
                    "deploy",
                    "--legacy",
                    "--prod",
                    payloadDirectory.Path
                ]
            },
            new CommandExecutionOptions {
                WorkingDirectory = peaAppDirectory.Path,
                EnvironmentVariables = new Dictionary<string, string?> {
                    { "NODE_OPTIONS", "--max-old-space-size=8192" }
                }
            },
            cancellationToken
        );

        DeleteDirectoryIfExists(Path.Combine(payloadDirectory.Path, "node_modules"));
        System.IO.File.Copy(
            Path.Combine(peaAppDirectory.Path, "pnpm-lock.yaml"),
            Path.Combine(payloadDirectory.Path, "pnpm-lock.yaml"),
            true
        );
        context.Logger.LogInformation("Reinstalling pea production dependencies as a portable hoisted tree: {Directory}", payloadDirectory.Path);
        await context.Shell.Command.ExecuteCommandLineTool(
            new GenericCommandLineToolOptions("pnpm") {
                Arguments = ["install", "--prod", "--frozen-lockfile", "--config.node-linker=hoisted"]
            },
            new CommandExecutionOptions { WorkingDirectory = payloadDirectory.Path },
            cancellationToken
        );

        PruneDeployOnlyFiles(payloadDirectory.Path);
        ValidatePortableNodeModules(payloadDirectory.Path);
        System.IO.File.Copy(peaNodeExecutable.Path, Path.Combine(payloadDirectory.Path, PeaCliIdentity.NodeExecutableName), true);
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

    private static void PruneDeployOnlyFiles(string payloadDirectory) {
        Directory.Exists(Path.Combine(payloadDirectory, "dist"))
            .ShouldBeTrue($"pea deploy did not include compiled output: {Path.Combine(payloadDirectory, "dist")}");
        Directory.Exists(Path.Combine(payloadDirectory, "node_modules"))
            .ShouldBeTrue($"pea deploy did not include production dependencies: {Path.Combine(payloadDirectory, "node_modules")}");

        foreach (var fileName in new[] {
                     "agent.ts",
                     "host-client-runtime.ts",
                     "host-client.ts",
                     ".env",
                     "beta-auth-bootstrap.ts",
                     "main.ts",
                     "pe-host.ts",
                     "pnpm-lock.yaml",
                     "README.md",
                     "tsconfig.build.json",
                     "tsconfig.json"
                 }) {
            var path = Path.Combine(payloadDirectory, fileName);
            if (System.IO.File.Exists(path))
                System.IO.File.Delete(path);
        }

        DeleteDirectoryIfExists(Path.Combine(payloadDirectory, "generated"));
    }

    private static void ValidatePortableNodeModules(string payloadDirectory) {
        var nodeModulesDirectory = Path.Combine(payloadDirectory, "node_modules");
        foreach (var packagePath in new[] {
                     Path.Combine(nodeModulesDirectory, "mastracode"),
                     Path.Combine(nodeModulesDirectory, "@mastra", "core"),
                     Path.Combine(nodeModulesDirectory, "@mastra", "duckdb")
                 }) {
            Directory.Exists(packagePath)
                .ShouldBeTrue($"pea payload is missing required production dependency: {packagePath}");
        }

        var linkedEntries = Directory
            .EnumerateFileSystemEntries(nodeModulesDirectory, "*", SearchOption.AllDirectories)
            .Where(path => (System.IO.File.GetAttributes(path) & FileAttributes.ReparsePoint) != 0)
            .Take(10)
            .ToArray();
        linkedEntries.ShouldBeEmpty(
            "pea payload node_modules must be a portable physical tree before zipping. " +
            "Use pnpm deploy with node-linker=hoisted. Linked entries: " +
            string.Join(", ", linkedEntries)
        );
    }

    private static async Task<string> ComputeSha256Async(string path, CancellationToken cancellationToken) {
        await using var stream = System.IO.File.OpenRead(path);
        var hash = await SHA256.HashDataAsync(stream, cancellationToken);
        return Convert.ToHexString(hash).ToLowerInvariant();
    }
}
