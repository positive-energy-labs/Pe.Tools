using Pe.Dev.RevitAutomation;
using Pe.Shared.Product;
using System.Diagnostics;
using System.Text.Json;

namespace Pe.Dev.Cli;

internal static class PeaInstallDevCommand {
    public static async Task<int> RunAsync(
        IReadOnlyList<string> args,
        string? repoRootOverride,
        CancellationToken cancellationToken
    ) {
        if (args.Count > 0) {
            Console.Error.WriteLine("`pe-dev pea install-dev` does not accept additional arguments.");
            return 10;
        }

        string repoRoot;
        try {
            repoRoot = RepoRootResolver.Resolve(repoRootOverride);
        } catch (Exception ex) {
            Console.Error.WriteLine(ex.Message);
            return 10;
        }

        var peaAppDirectory = Path.Combine(repoRoot, "source", "pea", "app");
        var runtimeNodePath = Path.Combine(repoRoot, "source", "pea", "runtime", "node", PeaCliIdentity.NodeExecutableName);
        var packageJsonPath = Path.Combine(peaAppDirectory, "package.json");
        var nodeModulesPath = Path.Combine(peaAppDirectory, "node_modules");
        var distPath = Path.Combine(peaAppDirectory, "dist");

        if (!File.Exists(packageJsonPath) || !Directory.Exists(nodeModulesPath) || !File.Exists(runtimeNodePath)) {
            Console.Error.WriteLine(
                $"Could not locate required pea runtime inputs under '{peaAppDirectory}'. Ensure package.json, node_modules, and node.exe exist."
            );
            return 10;
        }

        var buildExitCode = await ForegroundProcessRunner.RunAsync(
            CreateProcessStartInfo(peaAppDirectory, "pnpm", "run", "build"),
            cancellationToken
        );
        if (buildExitCode != 0)
            return buildExitCode;

        if (!Directory.Exists(distPath)) {
            Console.Error.WriteLine($"pea build did not produce dist output at '{distPath}'.");
            return 1;
        }

        var installedRuntime = ProductRuntimeLayout.ForCurrentUser();
        Directory.CreateDirectory(installedRuntime.Binaries.PeaDirectoryPath);
        Directory.CreateDirectory(installedRuntime.Binaries.PeaVersionsDirectoryPath);
        Directory.CreateDirectory(installedRuntime.Binaries.PeaPackagesDirectoryPath);

        const string devVersion = "dev";
        var versionRootPath = installedRuntime.Binaries.ResolvePeaVersionDirectoryPath(devVersion);
        if (Directory.Exists(versionRootPath))
            Directory.Delete(versionRootPath, true);

        Directory.CreateDirectory(versionRootPath);
        CopyDirectory(distPath, Path.Combine(versionRootPath, "dist"));
        CopyDirectory(nodeModulesPath, Path.Combine(versionRootPath, "node_modules"));
        File.Copy(packageJsonPath, Path.Combine(versionRootPath, "package.json"), true);
        File.Copy(runtimeNodePath, Path.Combine(versionRootPath, PeaCliIdentity.NodeExecutableName), true);
        File.WriteAllText(
            Path.Combine(versionRootPath, PeaCliIdentity.PayloadManifestFileName),
            JsonSerializer.Serialize(
                PeaPayloadManifest.Create(
                    devVersion,
                    "dev",
                    "dev",
                    0,
                    DateTimeOffset.UtcNow.ToString("O"),
                    null
                )
            )
        );

        File.WriteAllText(installedRuntime.Binaries.PeaCurrentVersionPath, devVersion);
        File.WriteAllText(installedRuntime.Binaries.PeaLauncherPath, LauncherContent);

        Console.WriteLine(
            $"pea runtime synced to '{versionRootPath}'. PATH-visible launcher remains '{installedRuntime.Binaries.PeaLauncherPath}'."
        );
        return 0;
    }

    private static ProcessStartInfo CreateProcessStartInfo(string workingDirectory, string fileName, params string[] arguments) {
        var startInfo = new ProcessStartInfo(fileName) {
            WorkingDirectory = workingDirectory,
            UseShellExecute = false,
            RedirectStandardOutput = true,
            RedirectStandardError = true
        };
        foreach (var argument in arguments)
            startInfo.ArgumentList.Add(argument);
        return startInfo;
    }

    private static void CopyDirectory(string sourceDirectory, string destinationDirectory) {
        Directory.CreateDirectory(destinationDirectory);

        foreach (var directory in Directory.EnumerateDirectories(sourceDirectory, "*", SearchOption.AllDirectories)) {
            var relativeDirectory = Path.GetRelativePath(sourceDirectory, directory);
            Directory.CreateDirectory(Path.Combine(destinationDirectory, relativeDirectory));
        }

        foreach (var file in Directory.EnumerateFiles(sourceDirectory, "*", SearchOption.AllDirectories)) {
            var relativeFile = Path.GetRelativePath(sourceDirectory, file);
            var destinationPath = Path.Combine(destinationDirectory, relativeFile);
            Directory.CreateDirectory(Path.GetDirectoryName(destinationPath)!);
            File.Copy(file, destinationPath, true);
        }
    }

    private const string LauncherContent =
        """
        @echo off
        setlocal
        set "PEA_ROOT=%~dp0"
        set "PEA_CURRENT=%PEA_ROOT%current.txt"
        if not exist "%PEA_CURRENT%" (
          echo pea is installed, but no active payload version is configured. 1>&2
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
}
