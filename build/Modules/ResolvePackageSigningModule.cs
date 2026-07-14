using System.Diagnostics;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using System.Text.Json;
using Microsoft.Extensions.Logging;
using ModularPipelines.Context;
using ModularPipelines.Git.Extensions;
using ModularPipelines.Modules;

namespace Build.Modules;

/// <summary>
///     Resolves signing inputs for locally packaged Revit payloads. Certificate creation and trust
///     remain SDK responsibilities; this module only invokes the pinned SDK CLI and forwards its
///     result to the SDK build targets.
/// </summary>
public sealed class ResolvePackageSigningModule : Module<PackageSigningResult> {
    protected override async Task<PackageSigningResult?> ExecuteAsync(
        IModuleContext context,
        CancellationToken cancellationToken
    ) {
        var configuredThumbprint = Environment.GetEnvironmentVariable("PeCodeSignThumbprint");
        var configuredPfx = Environment.GetEnvironmentVariable("PeCodeSignPfx");
        if (!string.IsNullOrWhiteSpace(configuredThumbprint) || !string.IsNullOrWhiteSpace(configuredPfx)) {
            context.Logger.LogInformation("Using explicitly configured package signing identity.");
            return PackageSigningResult.Configured(configuredThumbprint, configuredPfx);
        }

        var rootDirectory = context.Git().RootDirectory.Path;
        await RunDotNetAsync(rootDirectory, ["tool", "restore"], cancellationToken);
        var output = await RunDotNetAsync(
            rootDirectory,
            ["tool", "run", "pe-revit", "--", "dev-sign", "init", "--json"],
            cancellationToken
        );

        using var json = JsonDocument.Parse(output);
        var result = json.RootElement.GetProperty("result");
        var thumbprint = result.GetProperty("thumbprint").GetString();
        var signToolPath = result.GetProperty("signToolPath").GetString();
        if (string.IsNullOrWhiteSpace(thumbprint) || string.IsNullOrWhiteSpace(signToolPath))
            throw new InvalidOperationException("The SDK dev-sign command did not return a thumbprint and signtool path.");

        context.Logger.LogInformation("Using SDK development signing identity {Thumbprint} for local package output.", thumbprint);
        context.Summary.KeyValue("Build", "Package signing", $"SDK dev certificate {thumbprint}");
        return PackageSigningResult.Development(thumbprint, signToolPath);
    }

    private static async Task<string> RunDotNetAsync(
        string workingDirectory,
        IReadOnlyCollection<string> arguments,
        CancellationToken cancellationToken
    ) {
        var startInfo = new ProcessStartInfo("dotnet") {
            WorkingDirectory = workingDirectory,
            UseShellExecute = false,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            CreateNoWindow = true
        };
        foreach (var argument in arguments)
            startInfo.ArgumentList.Add(argument);

        using var process = new Process { StartInfo = startInfo };
        if (!process.Start())
            throw new InvalidOperationException("Failed to start the pinned SDK CLI.");

        var standardOutput = process.StandardOutput.ReadToEndAsync(cancellationToken);
        var standardError = process.StandardError.ReadToEndAsync(cancellationToken);
        await process.WaitForExitAsync(cancellationToken);
        var output = await standardOutput;
        var error = await standardError;
        if (process.ExitCode != 0)
            throw new InvalidOperationException($"dotnet {string.Join(' ', arguments)} failed ({process.ExitCode}): {error.Trim()}");

        return output;
    }
}

public sealed record PackageSigningResult(
    string? Thumbprint,
    string? SignToolPath,
    IReadOnlyCollection<(string Name, string? Value)> BuildProperties
) {
    public static PackageSigningResult Development(string thumbprint, string signToolPath) => new(
        thumbprint,
        signToolPath,
        [
            ("PeCodeSignThumbprint", thumbprint),
            ("PeSignToolPath", signToolPath),
            ("PeSignTimestamp", "false")
        ]
    );

    public static PackageSigningResult Configured(string? thumbprint, string? pfx) {
        var properties = new List<(string Name, string? Value)>();
        var signToolPath = ResolveSignToolPath();
        AddEnvironmentProperty(properties, "PeCodeSignThumbprint", thumbprint);
        AddEnvironmentProperty(properties, "PeCodeSignPfx", pfx);
        AddEnvironmentProperty(properties, "PeSignToolPath", signToolPath);
        AddEnvironmentProperty(properties, "PeSignTimestamp", Environment.GetEnvironmentVariable("PeSignTimestamp"));
        return new PackageSigningResult(
            thumbprint,
            signToolPath,
            properties
        );
    }

    private static string? ResolveSignToolPath() {
        var configured = Environment.GetEnvironmentVariable("PeSignToolPath");
        if (!string.IsNullOrWhiteSpace(configured))
            return Path.GetFullPath(configured);

        var kitsRoot = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86),
            "Windows Kits",
            "10",
            "bin"
        );
        if (Directory.Exists(kitsRoot)) {
            var discovered = Directory.EnumerateDirectories(kitsRoot)
                .OrderByDescending(path => path, StringComparer.OrdinalIgnoreCase)
                .SelectMany(path => new[] {
                    Path.Combine(path, "x64", "signtool.exe"),
                    Path.Combine(path, "x86", "signtool.exe")
                })
                .FirstOrDefault(File.Exists);
            if (discovered != null)
                return discovered;
        }

        var pathDirectories = (Environment.GetEnvironmentVariable("PATH") ?? string.Empty)
            .Split(Path.PathSeparator, StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        return pathDirectories
            .Select(directory => Path.Combine(directory, "signtool.exe"))
            .FirstOrDefault(File.Exists);
    }

    public void VerifyPublishedAddin(string publishDirectory) {
        var appDirectory = Path.Combine(publishDirectory, "Pe.App");
        var payload = Path.Combine(appDirectory, "Pe.App.dll");
        var selectors = Directory.Exists(appDirectory)
            ? Directory.EnumerateFiles(appDirectory, "Pe.Revit.Loader.*.dll", SearchOption.TopDirectoryOnly).ToArray()
            : [];

        if (!File.Exists(payload) || selectors.Length != 1)
            throw new InvalidOperationException($"Expected one published Pe.App payload and selector under '{appDirectory}'.");

        VerifySignedFile(payload);
        VerifySignedFile(selectors[0]);
    }

    private void VerifySignedFile(string path) {
        if (string.IsNullOrWhiteSpace(SignToolPath) || !File.Exists(SignToolPath))
            throw new InvalidOperationException(
                $"PeSignToolPath must identify signtool.exe before packaged signatures can be verified: '{SignToolPath}'."
            );

        var startInfo = new ProcessStartInfo(SignToolPath) {
            UseShellExecute = false,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            CreateNoWindow = true
        };
        startInfo.ArgumentList.Add("verify");
        startInfo.ArgumentList.Add("/pa");
        startInfo.ArgumentList.Add("/q");
        startInfo.ArgumentList.Add(path);
        using (var process = Process.Start(startInfo)
               ?? throw new InvalidOperationException($"Failed to start signtool verification for '{path}'.")) {
            var output = process.StandardOutput.ReadToEnd();
            var error = process.StandardError.ReadToEnd();
            process.WaitForExit();
            if (process.ExitCode != 0)
                throw new InvalidOperationException(
                    $"Authenticode verification failed for '{path}' ({process.ExitCode}): {error.Trim()} {output.Trim()}"
                );
        }

        X509Certificate2 certificate;
        try {
#pragma warning disable SYSLIB0057 // Authenticode extraction has no X509CertificateLoader equivalent.
            certificate = new X509Certificate2(X509Certificate.CreateFromSignedFile(path));
#pragma warning restore SYSLIB0057
        } catch (Exception exception) when (exception is CryptographicException or ArgumentException) {
            throw new InvalidOperationException($"Packaged Revit binary is not Authenticode signed: {path}", exception);
        }

        using (certificate) {
            if (!string.IsNullOrWhiteSpace(Thumbprint)
                && !string.Equals(certificate.Thumbprint, Thumbprint, StringComparison.OrdinalIgnoreCase))
                throw new InvalidOperationException(
                    $"Packaged Revit binary '{path}' was signed by '{certificate.Thumbprint}', expected '{Thumbprint}'."
                );
        }
    }

    private static void AddEnvironmentProperty(
        ICollection<(string Name, string? Value)> properties,
        string name,
        string? value
    ) {
        if (!string.IsNullOrWhiteSpace(value))
            properties.Add((name, value));
    }
}
