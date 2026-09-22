using Build.Options;
using System.Diagnostics;
using System.Reflection.PortableExecutable;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using ModularPipelines.Attributes;
using ModularPipelines.Context;
using ModularPipelines.FileSystem;
using ModularPipelines.Git.Extensions;
using ModularPipelines.Modules;
using ModularPipelines.Options;
using Pe.Shared.RevitVersions;
using Shouldly;
using File = ModularPipelines.FileSystem.File;

namespace Build.Modules;

/// <summary>
///     Build the product-specific Host and Pea sources, consume the Revit payload from
///     CreateBundleModule, then delegate both installer transports to the SDK.
/// </summary>
[DependsOn<ResolveVersioningModule>]
[DependsOn<ResolveBuildMatrixModule>]
[DependsOn<ResolveBuildLayoutModule>]
[DependsOn<CreateBundleModule>]
[DependsOn<ResolvePackageSigningModule>]
public sealed class CreateInstallerModule(IOptions<BuildOptions> buildOptions) : Module {
    private const string SourceManifestFileName = "product.payloads.json";

    protected override async Task ExecuteModuleAsync(IModuleContext context, CancellationToken cancellationToken) {
        var versioningResult = await context.GetModule<ResolveVersioningModule>();
        var matrixResult = await context.GetModule<ResolveBuildMatrixModule>();
        var layoutResult = await context.GetModule<ResolveBuildLayoutModule>();
        var signingResult = await context.GetModule<ResolvePackageSigningModule>();
        var versioning = versioningResult.ValueOrDefault!;
        var matrix = matrixResult.ValueOrDefault!;
        var layout = layoutResult.ValueOrDefault!;
        var signing = signingResult.ValueOrDefault!;
        var rootDirectory = context.Git().RootDirectory;

        // Presence check only: the payload name/entry now come from the checked-in manifest, but the
        // build still asserts the repo has exactly one RevitAddin project to stage.
        _ = BuildProjectDiscovery.AssemblyName(
            BuildProjectDiscovery.FindSingleProjectByKind(rootDirectory.Path, "RevitAddin")
        );
        var sourceManifestPath = Path.Combine(rootDirectory.Path, SourceManifestFileName);
        System.IO.File.Exists(sourceManifestPath)
            .ShouldBeTrue($"Checked-in payload manifest not found: {sourceManifestPath}");

        if (!string.IsNullOrWhiteSpace(buildOptions.Value.Configuration))
            throw new InvalidOperationException(
                "Installer packaging always requires the complete Revit-year matrix; omit --configuration."
            );
        var configurations = matrix.PackConfigurations.ToArray();
        ValidateManifestYears(sourceManifestPath, configurations);
        var revitPayloadRoot = layout.GetSdkInstallerRevitPayloadRoot();
        var targetDirectories = configurations.Select(configuration => {
            RevitVersionCatalog.TryResolveFromConfiguration(configuration, out var spec)
                .ShouldBeTrue($"Installer configuration '{configuration}' does not map to a Revit year.");
            return Path.Combine(revitPayloadRoot, spec.Year.ToString());
        }).ToArray();

        var missingDirectories = targetDirectories.Where(path => !Directory.Exists(path)).ToArray();
        missingDirectories.ShouldBeEmpty(
            $"Installer packaging requires every Revit publish directory. Missing: {string.Join(", ", missingDirectories)}"
        );
        context.Logger.LogInformation(
            "Installer will include {Count} Revit publish directories: {Directories}",
            targetDirectories.Length,
            string.Join(", ", targetDirectories)
        );
        var unsignedNode = PrepareUnsignedNode(signing);
        try {
            await Task.WhenAll(
                PublishRuntimeAsync(context, rootDirectory, sourceManifestPath, signing, unsignedNode, cancellationToken),
                PublishPeaAsync(context, rootDirectory, sourceManifestPath, signing, unsignedNode, cancellationToken)
            );
        } finally {
            Directory.Delete(Path.GetDirectoryName(unsignedNode)!, recursive: true);
        }

        Directory.CreateDirectory(layout.Artifacts.InstallerPackagesRoot);
        foreach (var existingInstallerPath in Directory.EnumerateFiles(layout.Artifacts.InstallerPackagesRoot, "*.msi"))
            System.IO.File.Delete(existingInstallerPath);

        var sdkInstallerOutputRoot = layout.GetSdkInstallerOutputRoot();
        if (Directory.Exists(sdkInstallerOutputRoot)) {
            foreach (var existingInstallerPath in Directory.EnumerateFiles(sdkInstallerOutputRoot, "*.msi"))
                System.IO.File.Delete(existingInstallerPath);
        }

        var installPackagePath = layout.GetInstallPackagePath(versioning.Version);
        var installPackageTask = context.Shell.Command.ExecuteCommandLineTool(
            new GenericCommandLineToolOptions("dotnet") {
                Arguments = [
                    "tool", "run", "pe-revit", "--", "install", "package",
                    "--manifest", sourceManifestPath, "--output", installPackagePath
                ]
            },
            new CommandExecutionOptions { WorkingDirectory = rootDirectory.Path },
            cancellationToken
        );

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

        var msiTask = context.Shell.Command.ExecuteCommandLineTool(
            new GenericCommandLineToolOptions("dotnet") {
                Arguments = [.. msiArguments]
            },
            new CommandExecutionOptions {
                WorkingDirectory = rootDirectory.Path
            },
            cancellationToken
        );
        await Task.WhenAll(installPackageTask, msiTask);
        context.Summary.KeyValue("Artifacts", "Install package", installPackagePath);

        context.Logger.LogInformation("SDK MSI helper finished. Scanning output directory.");
        var outputFiles = Directory.EnumerateFiles(sdkInstallerOutputRoot, "*.msi", SearchOption.TopDirectoryOnly)
            .Where(path => Path.GetFileName(path).Contains(versioning.Version, StringComparison.OrdinalIgnoreCase))
            .ToArray();
        outputFiles.ShouldNotBeEmpty("SDK MSI helper did not create an installer");

        foreach (var outputFile in outputFiles) {
            signing.SignAndVerifyFile(outputFile);
            RefreshInstallerReceiptHash(layout.GetInstallerReceiptPath(versioning.Version), outputFile);
            var packagePath = Path.Combine(layout.Artifacts.InstallerPackagesRoot, Path.GetFileName(outputFile));
            System.IO.File.Copy(outputFile, packagePath, true);
            context.Summary.KeyValue("Artifacts", "Installer", new File(packagePath).Path);
        }
    }

    private static async Task PublishRuntimeAsync(
        IModuleContext context,
        Folder rootDirectory,
        string manifestPath,
        PackageSigningResult signing,
        string unsignedNode,
        CancellationToken cancellationToken
    ) {
        context.Logger.LogInformation("Building TS host runtime for installer packaging.");
        var host = ReadVersionedApp(manifestPath, "host");
        await RunPayloadBuildAsync(context, rootDirectory, host, cancellationToken);

        var builtHostDirectory = Path.Combine(rootDirectory.Path, host.Source);
        var runtimePublishDirectory = new Folder(builtHostDirectory);
        var hostExecutableName = host.Entry;
        var builtHostExecutable = Path.Combine(builtHostDirectory, hostExecutableName);
        await BuildSignableSeaAsync(
            context,
            Path.Combine(builtHostDirectory, "bundle", "index.mjs"),
            builtHostExecutable,
            unsignedNode,
            cancellationToken
        );
        System.IO.File.Exists(builtHostExecutable)
            .ShouldBeTrue($"TS host executable build did not create {builtHostExecutable}");
        signing.SignAndVerifyFile(builtHostExecutable);
        Directory.Delete(Path.Combine(builtHostDirectory, "bundle"), recursive: true);

        runtimePublishDirectory.GetFiles(file => file.Exists)
            .ShouldNotBeEmpty("Failed to publish the shared runtime for installer packaging.");
        runtimePublishDirectory.GetFile(hostExecutableName).Exists
            .ShouldBeTrue("Failed to publish TS host for installer packaging.");
        runtimePublishDirectory.GetFile("web/client/index.html").Exists
            .ShouldBeTrue("Installer runtime publish should include the staged web SPA.");
        StageUsageIndex(context, rootDirectory, builtHostDirectory);
        context.Logger.LogInformation("Finished publishing TS host runtime for installer packaging.");
    }

    /// <summary>
    ///     Ship the usage-index next to the Host executable. The installed layout is fixed, so
    ///     local-docs findExamplesPath reads bin/host/examples.json — the same directory the bundle
    ///     lands in. Absent index is not fatal: the API docs degrade to no examples.
    /// </summary>
    private static void StageUsageIndex(IModuleContext context, Folder rootDirectory, string builtHostDirectory) {
        var examplesPath = Path.Combine(rootDirectory.Path, ".artifacts", "usage-index", "examples.json");
        if (!System.IO.File.Exists(examplesPath)) {
            context.Logger.LogWarning(
                "No usage index at {Path}; the installed Host ships without API examples.", examplesPath);
            return;
        }

        System.IO.File.Copy(examplesPath, Path.Combine(builtHostDirectory, "examples.json"), true);
        context.Logger.LogInformation("Staged the usage index beside the installed Host.");
    }

    private static async Task PublishPeaAsync(
        IModuleContext context,
        Folder rootDirectory,
        string manifestPath,
        PackageSigningResult signing,
        string unsignedNode,
        CancellationToken cancellationToken
    ) {
        context.Logger.LogInformation("Building TS pea runtime for installer packaging.");
        var pea = ReadVersionedApp(manifestPath, "pea");
        await RunPayloadBuildAsync(context, rootDirectory, pea, cancellationToken);

        var builtPeaDirectory = Path.Combine(rootDirectory.Path, pea.Source);
        var peaPublishDirectory = new Folder(builtPeaDirectory);
        var peaExecutableName = pea.Entry;
        var builtPeaExecutable = Path.Combine(builtPeaDirectory, peaExecutableName);
        await BuildSignableSeaAsync(
            context,
            Path.Combine(builtPeaDirectory, "bundle", "main.mjs"),
            builtPeaExecutable,
            unsignedNode,
            cancellationToken
        );
        System.IO.File.Exists(builtPeaExecutable)
            .ShouldBeTrue($"TS pea executable build did not create {builtPeaExecutable}");
        signing.SignAndVerifyFile(builtPeaExecutable);
        Directory.Delete(Path.Combine(builtPeaDirectory, "bundle"), recursive: true);

        peaPublishDirectory.GetFiles(file => file.Exists)
            .ShouldNotBeEmpty("Failed to publish the pea runtime for installer packaging.");
        peaPublishDirectory.GetFile(peaExecutableName).Exists
            .ShouldBeTrue("Failed to publish TS pea for installer packaging.");

        context.Logger.LogInformation("Finished publishing TS pea runtime for installer packaging.");
    }

    private static string PrepareUnsignedNode(PackageSigningResult signing) {
        var startInfo = new ProcessStartInfo("node") {
            UseShellExecute = false,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            CreateNoWindow = true
        };
        startInfo.ArgumentList.Add("-p");
        startInfo.ArgumentList.Add("process.execPath");
        using var process = Process.Start(startInfo)
            ?? throw new InvalidOperationException("Failed to resolve the Node executable.");
        var nodePath = process.StandardOutput.ReadToEnd().Trim();
        var error = process.StandardError.ReadToEnd();
        process.WaitForExit();
        if (process.ExitCode != 0 || !System.IO.File.Exists(nodePath))
            throw new InvalidOperationException($"Failed to resolve the Node executable: {error.Trim()}");

        var directory = Path.Combine(Path.GetTempPath(), "pe-tools-sea-node", Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(directory);
        var copy = Path.Combine(directory, "node.exe");
        System.IO.File.Copy(nodePath, copy);
        bool hasSignature;
        using (var stream = System.IO.File.OpenRead(copy))
        using (var pe = new PEReader(stream))
            hasSignature = pe.PEHeaders.PEHeader?.CertificateTableDirectory.Size > 0;
        if (hasSignature)
            signing.RemoveSignature(copy);
        return copy;
    }

    private static async Task BuildSignableSeaAsync(
        IModuleContext context,
        string main,
        string output,
        string unsignedNode,
        CancellationToken cancellationToken
    ) {
        var config = Path.Combine(Path.GetTempPath(), $"pe-sea-{Guid.NewGuid():N}.json");
        try {
            System.IO.File.WriteAllText(config, JsonSerializer.Serialize(new {
                main,
                mainFormat = "module",
                executable = unsignedNode,
                output,
                disableExperimentalSEAWarning = true
            }));
            await context.Shell.Command.ExecuteCommandLineTool(
                new GenericCommandLineToolOptions("node") { Arguments = ["--build-sea", config] },
                new CommandExecutionOptions { WorkingDirectory = Path.GetDirectoryName(main)! },
                cancellationToken
            );
        } finally {
            if (System.IO.File.Exists(config)) System.IO.File.Delete(config);
        }
    }

    /// <summary>
    ///     The executable a VersionedApp payload lands as, read from product.payloads.json — the
    ///     single authority for the installed layout. The build never restates these names.
    /// </summary>
    /// <summary>A VersionedApp payload as the checked-in manifest declares it; the manifest owns its paths.</summary>
    private sealed record VersionedApp(string Name, string Entry, string Source, string Build);

    private static VersionedApp ReadVersionedApp(string manifestPath, string payloadName) {
        using var document = JsonDocument.Parse(System.IO.File.ReadAllText(manifestPath));
        foreach (var payload in document.RootElement.GetProperty("payloads").EnumerateArray()) {
            if (payload.GetProperty("type").GetString() != "VersionedApp") continue;
            if (payload.GetProperty("name").GetString() != payloadName) continue;
            string Required(string property) => payload.TryGetProperty(property, out var value) && value.GetString() is { Length: > 0 } text
                ? text
                : throw new InvalidOperationException($"Payload '{payloadName}' has no {property} in {manifestPath}.");
            return new VersionedApp(payloadName, Required("entry"), Required("source"), Required("build"));
        }

        throw new InvalidOperationException($"No VersionedApp payload named '{payloadName}' in {manifestPath}.");
    }

    /// <summary>Runs the payload's manifest build command from the checkout root, where its paths are rooted.</summary>
    private static Task RunPayloadBuildAsync(IModuleContext context, Folder rootDirectory, VersionedApp payload, CancellationToken cancellationToken) {
        // ponytail: space split; the manifest build commands carry no quoted arguments.
        var parts = payload.Build.Split(' ', StringSplitOptions.RemoveEmptyEntries);
        return context.Shell.Command.ExecuteCommandLineTool(
            new GenericCommandLineToolOptions(parts[0]) { Arguments = parts[1..] },
            new CommandExecutionOptions { WorkingDirectory = rootDirectory.Path },
            cancellationToken
        );
    }

    private static void ValidateManifestYears(string manifestPath, IReadOnlyCollection<string> configurations) {
        using var document = JsonDocument.Parse(System.IO.File.ReadAllText(manifestPath));
        var declared = document.RootElement.GetProperty("years").EnumerateArray()
            .Select(value => value.GetString()).Where(value => value is not null).Select(value => value!).Order().ToArray();
        var expected = configurations.Select(configuration => {
                RevitVersionCatalog.TryResolveFromConfiguration(configuration, out var spec)
                    .ShouldBeTrue($"Installer configuration '{configuration}' does not map to a Revit year.");
                return spec.Year.ToString();
            })
            .Distinct(StringComparer.Ordinal).Order().ToArray();
        declared.ShouldBe(expected, "product.payloads.json years must equal the Directory.Build.props pack matrix");
    }

    private static void RefreshInstallerReceiptHash(string receiptPath, string msiPath) {
        if (!System.IO.File.Exists(receiptPath))
            throw new InvalidOperationException($"SDK MSI receipt was not found after packaging: {receiptPath}");
        var receipt = JsonNode.Parse(System.IO.File.ReadAllText(receiptPath))?.AsObject()
            ?? throw new InvalidOperationException($"SDK MSI receipt is not a JSON object: {receiptPath}");
        receipt["sha256"] = Convert.ToHexString(SHA256.HashData(System.IO.File.ReadAllBytes(msiPath)));
        System.IO.File.WriteAllText(receiptPath,
            receipt.ToJsonString(new System.Text.Json.JsonSerializerOptions { WriteIndented = true }));
    }

}
