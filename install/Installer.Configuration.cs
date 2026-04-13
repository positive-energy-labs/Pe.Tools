using Microsoft.Extensions.Configuration;
using Pe.Shared.HostContracts.Protocol;

namespace Installer;

public static class InstallerConfiguration {
    public static ResolvedInstallerConfiguration Load() {
        var repositoryRoot = FindRepositoryRoot();
        var configuration = new ConfigurationBuilder()
            .AddJsonFile(Path.Combine(repositoryRoot, "build", "appsettings.json"), optional: false)
            .AddEnvironmentVariables()
            .Build();

        var buildOptions = configuration.GetRequiredSection("Build").Get<BuildConfiguration>()
            ?? throw new InvalidOperationException("Build configuration could not be loaded.");
        var installerOptions = configuration.GetRequiredSection("Installer").Get<InstallerConfigurationSection>()
            ?? throw new InvalidOperationException("Installer configuration could not be loaded.");

        return new ResolvedInstallerConfiguration {
            ProductName = SettingsEditorRuntime.ProductName,
            UpgradeCode = ParseGuid(installerOptions.UpgradeCode, "Installer:UpgradeCode"),
            OutputDirectory = ResolveRepositoryPath(repositoryRoot,
                RequireValue(buildOptions.OutputDirectory, "Build:OutputDirectory")),
            BannerImagePath = ResolveRepositoryPath(repositoryRoot,
                RequireValue(installerOptions.BannerImagePath, "Installer:BannerImagePath")),
            BackgroundImagePath = ResolveRepositoryPath(repositoryRoot,
                RequireValue(installerOptions.BackgroundImagePath, "Installer:BackgroundImagePath")),
            ProductIconPath = ResolveRepositoryPath(repositoryRoot,
                RequireValue(installerOptions.ProductIconPath, "Installer:ProductIconPath")),
            Manufacturer = SettingsEditorRuntime.VendorName
        };
    }

    private static string FindRepositoryRoot() {
        var startingDirectories = new[] { Directory.GetCurrentDirectory(), AppContext.BaseDirectory }
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .Select(path => new DirectoryInfo(path));

        foreach (var startingDirectory in startingDirectories) {
            for (var current = startingDirectory; current is not null; current = current.Parent) {
                var appSettingsPath = Path.Combine(current.FullName, "build", "appsettings.json");
                if (File.Exists(appSettingsPath))
                    return current.FullName;
            }
        }

        throw new InvalidOperationException(
            "Could not locate the repository root containing build\\appsettings.json.");
    }

    private static string ResolveRepositoryPath(string repositoryRoot, string relativeOrAbsolutePath) =>
        Path.IsPathRooted(relativeOrAbsolutePath)
            ? relativeOrAbsolutePath
            : Path.GetFullPath(Path.Combine(repositoryRoot, relativeOrAbsolutePath));

    private static string RequireValue(string? value, string key) =>
        string.IsNullOrWhiteSpace(value)
            ? throw new InvalidOperationException($"Required configuration value '{key}' is missing.")
            : value;

    private static Guid ParseGuid(string value, string key) =>
        Guid.TryParse(value, out var guid)
            ? guid
            : throw new InvalidOperationException($"Configuration value '{key}' is not a valid GUID.");
}

public sealed record ResolvedInstallerConfiguration {
    public required string ProductName { get; init; }
    public required Guid UpgradeCode { get; init; }
    public required string OutputDirectory { get; init; }
    public required string BannerImagePath { get; init; }
    public required string BackgroundImagePath { get; init; }
    public required string ProductIconPath { get; init; }
    public required string Manufacturer { get; init; }

    public string GetSingleUserHostInstallDirectory() => SettingsEditorRuntime.GetSingleUserHostInstallDirectory();

    public string GetMultiUserHostInstallDirectory() => SettingsEditorRuntime.GetMultiUserHostInstallDirectory();
}

public sealed record BuildConfiguration {
    public string? OutputDirectory { get; init; }
}

public sealed record InstallerConfigurationSection {
    public string? UpgradeCode { get; init; }
    public string? BannerImagePath { get; init; }
    public string? BackgroundImagePath { get; init; }
    public string? ProductIconPath { get; init; }
}
