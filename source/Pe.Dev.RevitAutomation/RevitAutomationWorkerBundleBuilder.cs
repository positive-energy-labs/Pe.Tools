using Autodesk.PackageBuilder;
using Pe.Shared.RevitVersions;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;

namespace Pe.Dev.RevitAutomation;

internal sealed class RevitAutomationWorkerBundleBuilder {
    private const string WorkerAssemblyName = "Pe.Dev.RevitAutomation.Worker";
    private const string WorkerClassName = "Pe.Dev.RevitAutomation.Worker.RevitAutomationShellApp";
    private const string WorkerClientId = "11A07E95-68DE-4E58-A699-59B27F9600D2";
    private const string WorkerProjectPath = "source/Pe.Dev.RevitAutomation.Worker/Pe.Dev.RevitAutomation.Worker.csproj";

    public async Task<WorkerBundleArtifact> BuildAsync(
        string repoRoot,
        string engine,
        Action<string>? log,
        CancellationToken cancellationToken
    ) {
        var spec = RevitVersionCatalog.RequireByAutomationEngine(engine);
        var buildConfiguration = $"Debug.{spec.ConfigurationSuffix}";
        var projectPath = Path.Combine(repoRoot, WorkerProjectPath);
        if (!File.Exists(projectPath))
            throw new FileNotFoundException($"Worker project was not found at '{projectPath}'.", projectPath);

        var outputDirectory = Path.Combine(
            repoRoot,
            ".artifacts",
            "build",
            WorkerAssemblyName,
            buildConfiguration,
            "bin",
            buildConfiguration,
            spec.TargetFramework
        );

        var workerAssemblyPath = Path.Combine(outputDirectory, $"{WorkerAssemblyName}.dll");
        if (File.Exists(workerAssemblyPath)) {
            log?.Invoke($"Using existing worker build ({buildConfiguration})");
        } else {
            log?.Invoke($"Building worker project ({buildConfiguration})");
            await RunDotNetBuildAsync(projectPath, buildConfiguration, repoRoot, cancellationToken).ConfigureAwait(false);
        }

        if (!File.Exists(workerAssemblyPath))
            throw new FileNotFoundException(
                $"Worker assembly '{workerAssemblyPath}' was not produced by the build.",
                workerAssemblyPath
            );

        var artifactsRoot = Path.Combine(repoRoot, ".artifacts", "automation", $"{spec.Year}");
        _ = Directory.CreateDirectory(artifactsRoot);
        var bundleRoot = Path.Combine(artifactsRoot, $"{WorkerAssemblyName}.bundle");
        var contentsDirectory = Path.Combine(bundleRoot, "Contents");
        if (Directory.Exists(bundleRoot))
            Directory.Delete(bundleRoot, true);

        _ = Directory.CreateDirectory(contentsDirectory);
        BuildPackageContents(Path.Combine(bundleRoot, "PackageContents.xml"), spec.Year);
        BuildAddinManifest(Path.Combine(contentsDirectory, $"{WorkerAssemblyName}.addin"));

        foreach (var filePath in Directory.EnumerateFiles(outputDirectory)) {
            var extension = Path.GetExtension(filePath);
            if (string.Equals(extension, ".pdb", StringComparison.OrdinalIgnoreCase))
                continue;

            File.Copy(
                filePath,
                Path.Combine(contentsDirectory, Path.GetFileName(filePath)),
                true
            );
        }

        var zipPath = Path.Combine(artifactsRoot, $"{WorkerAssemblyName}.bundle.zip");
        if (File.Exists(zipPath))
            File.Delete(zipPath);

        ZipFile.CreateFromDirectory(bundleRoot, zipPath, CompressionLevel.Optimal, true);
        return new WorkerBundleArtifact {
            ZipPath = zipPath,
            PackageContents = await File.ReadAllBytesAsync(zipPath, cancellationToken).ConfigureAwait(false)
        };
    }

    private static async Task RunDotNetBuildAsync(
        string projectPath,
        string configuration,
        string repoRoot,
        CancellationToken cancellationToken
    ) {
        var startInfo = new ProcessStartInfo("dotnet") {
            WorkingDirectory = repoRoot,
            RedirectStandardOutput = true,
            RedirectStandardError = true
        };
        startInfo.ArgumentList.Add("build");
        startInfo.ArgumentList.Add(projectPath);
        startInfo.ArgumentList.Add("-c");
        startInfo.ArgumentList.Add(configuration);
        if (File.Exists(Path.Combine(repoRoot, ".artifacts", "build", WorkerAssemblyName, configuration, "obj", "project.assets.json")))
            startInfo.ArgumentList.Add("--no-restore");
        startInfo.ArgumentList.Add("/p:PeIsolatedBuild=true");
        startInfo.ArgumentList.Add("/p:WarningLevel=0");

        using var process = Process.Start(startInfo)
                            ?? throw new InvalidOperationException("Failed to start dotnet build.");
        var standardOutputTask = process.StandardOutput.ReadToEndAsync(cancellationToken);
        var standardErrorTask = process.StandardError.ReadToEndAsync(cancellationToken);

        await process.WaitForExitAsync(cancellationToken).ConfigureAwait(false);
        var standardOutput = await standardOutputTask.ConfigureAwait(false);
        var standardError = await standardErrorTask.ConfigureAwait(false);

        if (process.ExitCode != 0)
            throw new InvalidOperationException(
                $"Worker project build failed with exit code {process.ExitCode}.{Environment.NewLine}" +
                standardOutput + Environment.NewLine + standardError
            );
    }

    private static void BuildPackageContents(string packageContentsPath, int revitYear) => _ = BuilderUtils.Build<PackageContentsBuilder>(builder => {
        _ = builder.ApplicationPackage.Create()
            .ProductType(ProductTypes.Application)
            .AutodeskProduct(AutodeskProducts.Revit)
            .Name(WorkerAssemblyName)
            .Description("Pe.Tools Revit automation shell")
            .AppVersion("1.0.0");

        var componentEntry = builder.Components.CreateEntry("Pe.Tools Revit automation shell")
            .RevitPlatform(revitYear)
            .AppName(WorkerAssemblyName)
            .Version("1.0.0")
            .ModuleName($"./Contents/{WorkerAssemblyName}.addin")
            .AppDescription("Pe.Tools Revit automation shell");

        _ = componentEntry.DataBuilder.CreateAttribute("LoadOnCommandInvocation", false);
        _ = componentEntry.DataBuilder.CreateAttribute("LoadOnRevitStartup", true);
    }, packageContentsPath);

    private static void BuildAddinManifest(string addinManifestPath) => _ = BuilderUtils.Build<RevitAddInsBuilder>(builder => {
        var addInEntry = builder.AddIn.CreateEntry("DBApplication")
            .Name("Pe.Tools Revit Automation Shell")
            .Assembly($"{WorkerAssemblyName}.dll")
            .AddInId(WorkerClientId)
            .FullClassName(WorkerClassName)
            .VendorId("PE")
            .VendorDescription("Positive Energy");

        _ = addInEntry.DataBuilder.CreateElement("Description", "Pe.Tools Revit automation shell");
    }, addinManifestPath);
}

internal sealed class WorkerBundleArtifact {
    public string ZipPath { get; init; } = "";
    public byte[] PackageContents { get; init; } = [];
}
