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
        var peaAppSourceDirectory = Path.Combine(peToolsDirectory.Path, "apps", "pea");
        Directory.CreateDirectory(appDirectory);

        context.Logger.LogInformation("Building installed pea executable with Vite+: {Directory}", peaAppSourceDirectory);
        await context.Shell.Command.ExecuteCommandLineTool(
            new GenericCommandLineToolOptions("vp") { Arguments = ["pack"] },
            new CommandExecutionOptions { WorkingDirectory = peaAppSourceDirectory },
            cancellationToken
        );

        var executablePath = Path.Combine(peaAppSourceDirectory, "dist-installed", PeaCliIdentity.InstalledExecutableName);
        System.IO.File.Exists(executablePath)
            .ShouldBeTrue($"pea executable build did not create {executablePath}");
        System.IO.File.Copy(
            executablePath,
            Path.Combine(appDirectory, PeaCliIdentity.InstalledExecutableName),
            true
        );

        await BuildWebStaticAsync(context, peToolsDirectory.Path, payloadDirectory.Path, cancellationToken);
        CopyNativeSidecars(peToolsDirectory.Path, payloadDirectory.Path);
        ValidateInstalledNodePayload(payloadDirectory.Path);
        await SmokeInstalledNodePayload(context, payloadDirectory.Path, cancellationToken);

        // No launcher bake-in: the installer's SDK PathShim (ShimContent) is the one pea.cmd
        // generator now. The pea payload ships only the versioned app + web static + sidecars.

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

    private static async Task BuildWebStaticAsync(
        IModuleContext context,
        string peToolsDirectory,
        string payloadDirectory,
        CancellationToken cancellationToken
    ) {
        var webAppSourceDirectory = Path.Combine(peToolsDirectory, "apps", "web");
        context.Logger.LogInformation("Building installed web static client: {Directory}", webAppSourceDirectory);
        await context.Shell.Command.ExecuteCommandLineTool(
            new GenericCommandLineToolOptions("vp") { Arguments = ["build"] },
            new CommandExecutionOptions { WorkingDirectory = webAppSourceDirectory },
            cancellationToken
        );

        var staticSource = Path.Combine(webAppSourceDirectory, "dist", "client");
        Directory.Exists(staticSource)
            .ShouldBeTrue($"web static build did not create {staticSource}");
        var staticTarget = Path.Combine(payloadDirectory, "web", "client");
        CopyDirectory(staticSource, staticTarget);
        WriteStaticIndexHtml(staticTarget);
    }

    private static void WriteStaticIndexHtml(string staticDirectory) {
        var assetsDirectory = Path.Combine(staticDirectory, "assets");
        Directory.Exists(assetsDirectory).ShouldBeTrue($"web static build is missing assets directory: {assetsDirectory}");

        var script = Directory.GetFiles(assetsDirectory, "index-*.js", SearchOption.TopDirectoryOnly)
            .Select(Path.GetFileName)
            .SingleOrDefault();
        script.ShouldNotBeNull($"web static build is missing an index script in {assetsDirectory}");

        var styles = Directory.GetFiles(assetsDirectory, "*.css", SearchOption.TopDirectoryOnly)
            .Select(Path.GetFileName)
            .Order(StringComparer.OrdinalIgnoreCase)
            .Select(file => $"    <link rel=\"stylesheet\" href=\"/assets/{file}\">");

        var html = string.Join(Environment.NewLine, [
            "<!doctype html>",
            "<html lang=\"en\">",
            "  <head>",
            "    <meta charset=\"UTF-8\">",
            "    <meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\">",
            "    <title>Positive Energy</title>",
            .. styles,
            $"    <script type=\"module\" src=\"/assets/{script}\"></script>",
            "  </head>",
            "  <body>",
            "    <div id=\"root\"></div>",
            "  </body>",
            "</html>",
            ""
        ]);
        System.IO.File.WriteAllText(Path.Combine(staticDirectory, "index.html"), html);
    }

    private static void CopyNativeSidecars(string peToolsDirectory, string payloadDirectory) {
        var pnpmStoreDirectory = Path.Combine(peToolsDirectory, "node_modules", ".pnpm");
        Directory.Exists(pnpmStoreDirectory).ShouldBeTrue(
            $"pea native sidecar packaging requires an installed pe-tools dependency store: {pnpmStoreDirectory}"
        );

        // These are deliberate native sidecars: the Node executable bundles the JS graph, but these
        // packages load platform-native binaries from real file paths at runtime. Keep this list
        // explicit so any future compatibility cost is visible in packaging and docs.
        CopyPackageSidecar(
            pnpmStoreDirectory,
            "@duckdb+node-bindings-win32-x64@*",
            Path.Combine("node_modules", "@duckdb", "node-bindings-win32-x64"),
            Path.Combine(payloadDirectory, "node_modules", "@duckdb", "node-bindings-win32-x64")
        );
        CopyPackageSidecar(
            pnpmStoreDirectory,
            "@anush008+tokenizers-win32-x64-msvc@*",
            Path.Combine("node_modules", "@anush008", "tokenizers-win32-x64-msvc"),
            Path.Combine(payloadDirectory, "node_modules", "@anush008", "tokenizers-win32-x64-msvc")
        );
        CopyPackageSidecar(
            pnpmStoreDirectory,
            "@libsql+win32-x64-msvc@*",
            Path.Combine("node_modules", "@libsql", "win32-x64-msvc"),
            Path.Combine(payloadDirectory, "node_modules", "@libsql", "win32-x64-msvc")
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

    private static void ValidateInstalledNodePayload(string payloadDirectory) {
        System.IO.File.Exists(Path.Combine(
                payloadDirectory,
                PeaCliIdentity.AppDirectoryName,
                PeaCliIdentity.InstalledExecutableName
            ))
            .ShouldBeTrue("pea payload is missing app/pea.exe.");
        Directory.Exists(Path.Combine(payloadDirectory, "node_modules", "@duckdb", "node-bindings-win32-x64"))
            .ShouldBeTrue("pea payload is missing DuckDB win32-x64 native sidecar.");
        Directory.Exists(Path.Combine(payloadDirectory, "node_modules", "@anush008", "tokenizers-win32-x64-msvc"))
            .ShouldBeTrue("pea payload is missing tokenizers win32-x64 native sidecar.");
        Directory.Exists(Path.Combine(payloadDirectory, "node_modules", "@libsql", "win32-x64-msvc"))
            .ShouldBeTrue("pea payload is missing libsql win32-x64 native sidecar.");
        Directory.Exists(Path.Combine(payloadDirectory, "bin", "napi-v6", "win32", "x64"))
            .ShouldBeTrue("pea payload is missing onnxruntime win32-x64 native sidecar.");
    }

    private static async Task SmokeInstalledNodePayload(
        IModuleContext context,
        string payloadDirectory,
        CancellationToken cancellationToken
    ) {
        var executablePath = Path.Combine(
            payloadDirectory,
            PeaCliIdentity.AppDirectoryName,
            PeaCliIdentity.InstalledExecutableName
        );

        context.Logger.LogInformation("Smoke testing installed pea executable: {Executable}", executablePath);
        await context.Shell.Command.ExecuteCommandLineTool(
            new GenericCommandLineToolOptions(executablePath) { Arguments = ["--help"] },
            new CommandExecutionOptions { WorkingDirectory = payloadDirectory },
            cancellationToken
        );
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
