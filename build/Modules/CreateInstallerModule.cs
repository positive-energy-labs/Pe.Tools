using System.IO.Compression;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Nodes;
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
///     Create the .msi installer and the .install.zip package.
///     Both transports are byte-derived from the checked-in <c>product.payloads.json</c> — the one
///     source of truth for identity, payload set, entries, legacy paths, dev commands, and version.
///     The build only rewrites each payload's <c>source</c> to point at the transport's staged
///     artifacts (MSI: absolute staged paths; install.zip: package-relative <c>payloads/&lt;name&gt;</c>);
///     everything else passes through verbatim, so the two manifests can never drift from the SoT.
/// </summary>
[DependsOn<ResolveVersioningModule>]
[DependsOn<ResolveBuildMatrixModule>]
[DependsOn<ResolveBuildLayoutModule>]
[DependsOn<PublishRevitAddinModule>]
public sealed class CreateInstallerModule(IOptions<BuildOptions> buildOptions) : Module {
    private const string SourceManifestFileName = "product.payloads.json";

    private static readonly JsonSerializerOptions JsonOptions = new() {
        WriteIndented = true,
        // Emit embedded quotes in dev commands as \" (matching the checked-in manifest and the SDK's
        // regex field parser) rather than the default ".
        Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping
    };

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
        var revitPayloadRoot = StageRevitPayload(context, layout, configurations);

        var runtimePublishDirectory = await PublishRuntimeAsync(
            context,
            hostPackageDirectory,
            layout,
            cancellationToken
        );

        var peaPackageDirectory = rootDirectory.GetFolder("source").GetFolder("pe-tools").GetFolder("apps").GetFolder("pea");
        var peaPublishDirectory = await PublishPeaAsync(
            context,
            peaPackageDirectory,
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

        var installerPayloadManifestPath = await WriteMsiPayloadManifestAsync(
            layout,
            sourceManifestPath,
            versioning.Version,
            revitPayloadRoot.Path,
            runtimePublishDirectory.Path,
            peaPublishDirectory.Path,
            cancellationToken
        );
        var installPackagePath = await WriteInstallPackageAsync(
            layout,
            sourceManifestPath,
            versioning.Version,
            revitPayloadRoot.Path,
            runtimePublishDirectory.Path,
            peaPublishDirectory.Path,
            cancellationToken
        );
        context.Summary.KeyValue("Artifacts", "Install package", installPackagePath);

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
            new GenericCommandLineToolOptions("pnpm") { Arguments = ["--filter", "@pe/host", "build:payload"] },
            new CommandExecutionOptions { WorkingDirectory = hostPackageDirectory.Parent!.Parent!.Path },
            cancellationToken
        );

        // Copy the whole dist-installed tree, not just the exe: the TS host build places the web SPA
        // at dist-installed/web/client (contract: static root = <dir of Pe.Host.exe>/web/client), so it
        // must ride into the versioned host payload beside the executable.
        var builtHostDirectory = Path.Combine(hostPackageDirectory.Path, "dist-installed");
        var builtHostExecutable = Path.Combine(builtHostDirectory, HostProcessIdentity.ExecutableName);
        System.IO.File.Exists(builtHostExecutable)
            .ShouldBeTrue($"TS host executable build did not create {builtHostExecutable}");
        CopyDirectory(builtHostDirectory, runtimePublishDirectory.Path);

        runtimePublishDirectory.GetFiles(file => file.Exists)
            .ShouldNotBeEmpty("Failed to publish the shared runtime for installer packaging.");
        runtimePublishDirectory.GetFile(HostProcessIdentity.ExecutableName).Exists
            .ShouldBeTrue("Failed to publish TS host for installer packaging.");
        runtimePublishDirectory.GetFile("web/client/index.html").Exists
            .ShouldBeTrue("Installer runtime publish should include the staged web SPA.");
        runtimePublishDirectory.GetFile(PeDevCliIdentity.ExecutableName).Exists
            .ShouldBeFalse("Installer runtime publish should not include pe-dev.");

        context.Logger.LogInformation("Finished publishing TS host runtime for installer packaging.");
        return runtimePublishDirectory;
    }

    private static async Task<Folder> PublishPeaAsync(
        IModuleContext context,
        Folder peaPackageDirectory,
        ProductLayoutAuthority layout,
        CancellationToken cancellationToken
    ) {
        if (Directory.Exists(layout.GetPeaPublishDirectory("Release")))
            Directory.Delete(layout.GetPeaPublishDirectory("Release"), true);

        Directory.CreateDirectory(layout.GetPeaPublishDirectory("Release"));
        var peaPublishDirectory = new Folder(layout.GetPeaPublishDirectory("Release"));

        context.Logger.LogInformation("Building TS pea runtime for installer packaging: {Output}", peaPublishDirectory.Path);
        await context.Shell.Command.ExecuteCommandLineTool(
            new GenericCommandLineToolOptions("pnpm") { Arguments = ["--filter", "@pe/pea", "build:installed"] },
            new CommandExecutionOptions { WorkingDirectory = peaPackageDirectory.Parent!.Parent!.Path },
            cancellationToken
        );

        // Copy the whole dist-installed tree: the pea SEA build places its exe at the root and the
        // staged Mastra sidecars (drizzle-orm + get-stream(+2 deps) + the 3 natives) and the
        // mastracode package-root decoy under dist-installed, all of which must ride into the
        // versioned pea payload beside pea.exe (mirrors the host; docs/rework/SDK-LEDGER.md T5).
        var builtPeaDirectory = Path.Combine(peaPackageDirectory.Path, "dist-installed");
        var builtPeaExecutable = Path.Combine(builtPeaDirectory, PeaCliIdentity.ExecutableName);
        System.IO.File.Exists(builtPeaExecutable)
            .ShouldBeTrue($"TS pea executable build did not create {builtPeaExecutable}");
        CopyDirectory(builtPeaDirectory, peaPublishDirectory.Path);

        peaPublishDirectory.GetFiles(file => file.Exists)
            .ShouldNotBeEmpty("Failed to publish the pea runtime for installer packaging.");
        peaPublishDirectory.GetFile(PeaCliIdentity.ExecutableName).Exists
            .ShouldBeTrue("Failed to publish TS pea for installer packaging.");

        context.Logger.LogInformation("Finished publishing TS pea runtime for installer packaging.");
        return peaPublishDirectory;
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

    /// <summary>
    ///     MSI transport: rewrite each payload source to its absolute staged path. SDK beta.15's
    ///     MsiCommand lays the versioned layout for the real <c>VersionedAddin</c>/<c>VersionedApp</c>
    ///     types the manifest declares (ledger S2), so no type downgrade happens here.
    /// </summary>
    private static async Task<string> WriteMsiPayloadManifestAsync(
        ProductLayoutAuthority layout,
        string sourceManifestPath,
        string version,
        string revitPayloadRoot,
        string runtimePublishDirectory,
        string peaPublishDirectory,
        CancellationToken cancellationToken
    ) {
        var manifest = TransformManifest(
            sourceManifestPath,
            new Dictionary<string, string>(StringComparer.Ordinal) {
                ["Pe.App"] = revitPayloadRoot,
                ["host"] = runtimePublishDirectory,
                ["pea"] = peaPublishDirectory
            }
        );

        var manifestPath = layout.GetSdkInstallerPayloadManifestPath(version);
        Directory.CreateDirectory(Path.GetDirectoryName(manifestPath)!);
        await System.IO.File.WriteAllTextAsync(manifestPath, manifest, cancellationToken);
        return manifestPath;
    }

    /// <summary>
    ///     install.zip transport: copy each staged payload into the package under
    ///     <c>payloads/&lt;name&gt;</c> and rewrite its source to that package-relative path.
    /// </summary>
    private static async Task<string> WriteInstallPackageAsync(
        ProductLayoutAuthority layout,
        string sourceManifestPath,
        string version,
        string revitPayloadRoot,
        string runtimePublishDirectory,
        string peaPublishDirectory,
        CancellationToken cancellationToken
    ) {
        var packageRoot = Path.Combine(layout.Artifacts.InstallerPackagesRoot, "install-package");
        if (Directory.Exists(packageRoot))
            Directory.Delete(packageRoot, true);

        Directory.CreateDirectory(packageRoot);
        var payloadsRoot = Path.Combine(packageRoot, "payloads");

        // Name -> staged source. Copy the artifact to payloads/<name>; the manifest source is that
        // same package-relative path. Keyed by payload name so any drift fails TransformManifest.
        var stagedByName = new Dictionary<string, string>(StringComparer.Ordinal) {
            ["Pe.App"] = revitPayloadRoot,
            ["host"] = runtimePublishDirectory,
            ["pea"] = peaPublishDirectory
        };
        var sourceByName = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (var (name, stagedPath) in stagedByName) {
            CopyDirectory(stagedPath, Path.Combine(payloadsRoot, name));
            sourceByName[name] = $"payloads/{name}";
        }

        var manifest = TransformManifest(sourceManifestPath, sourceByName);
        await System.IO.File.WriteAllTextAsync(
            Path.Combine(packageRoot, SourceManifestFileName),
            manifest,
            cancellationToken
        );

        var packagePath = Path.Combine(
            layout.Artifacts.InstallerPackagesRoot,
            $"{ProductIdentity.ProductName}.{version}.install.zip"
        );
        if (System.IO.File.Exists(packagePath))
            System.IO.File.Delete(packagePath);
        ZipFile.CreateFromDirectory(packageRoot, packagePath, CompressionLevel.Optimal, false);
        return packagePath;
    }

    /// <summary>
    ///     Parse the checked-in manifest and rewrite ONLY each payload's <c>source</c> from
    ///     <paramref name="sourceByName"/>. Payloads without a source (Cli, PathShim) pass through.
    ///     A sourced payload with no mapping throws — the build refuses to emit a manifest that would
    ///     drop or dangle a payload the SoT declares.
    /// </summary>
    private static string TransformManifest(string sourceManifestPath, IReadOnlyDictionary<string, string> sourceByName) {
        var manifest = JsonNode.Parse(System.IO.File.ReadAllText(sourceManifestPath))
            ?? throw new InvalidOperationException($"Could not parse {sourceManifestPath}.");
        var payloads = manifest["payloads"]?.AsArray()
            ?? throw new InvalidOperationException($"{sourceManifestPath} has no payloads array.");

        foreach (var payloadNode in payloads) {
            if (payloadNode is not JsonObject payload || payload["source"] is null)
                continue;

            var name = (string?)payload["name"]
                ?? throw new InvalidOperationException($"A payload in {sourceManifestPath} has a source but no name.");
            if (!sourceByName.TryGetValue(name, out var rewritten))
                throw new InvalidOperationException(
                    $"Payload '{name}' declares a source but the build staged no artifact for it. " +
                    "Add its staged path in CreateInstallerModule, or drop its source in product.payloads.json.");

            payload["source"] = rewritten;
        }

        return manifest.ToJsonString(JsonOptions);
    }

    private static void CopyDirectory(string source, string destination) {
        Directory.CreateDirectory(destination);
        foreach (var directory in Directory.EnumerateDirectories(source, "*", SearchOption.AllDirectories))
            Directory.CreateDirectory(Path.Combine(destination, Path.GetRelativePath(source, directory)));

        foreach (var file in Directory.EnumerateFiles(source, "*", SearchOption.AllDirectories))
            System.IO.File.Copy(file, Path.Combine(destination, Path.GetRelativePath(source, file)), true);
    }
}
