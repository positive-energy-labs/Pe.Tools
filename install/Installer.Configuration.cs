using Microsoft.Extensions.Configuration;
using Pe.Shared.Product;

namespace Installer;

public static class InstallerConfiguration {
    public static ResolvedInstallerConfiguration Load(string outputDirectory) {
        var repositoryRoot = FindRepositoryRoot();
        var configuration = new ConfigurationBuilder()
            .AddJsonFile(Path.Combine(repositoryRoot, "build", "appsettings.json"), false)
            .AddEnvironmentVariables()
            .Build();

        var installerOptions = configuration.GetRequiredSection("Installer").Get<InstallerConfigurationSection>()
                               ?? throw new InvalidOperationException("Installer configuration could not be loaded.");

        var layoutProjection = ProductBuildLayoutProjection.CreateDefault();
        return new ResolvedInstallerConfiguration {
            ProductName = ProductIdentity.ProductName,
            UpgradeCode = ParseGuid(RequireValue(installerOptions.UpgradeCode, "Installer:UpgradeCode"), "Installer:UpgradeCode"),
            OutputDirectory = Path.GetFullPath(outputDirectory),
            BannerImagePath = ResolveRepositoryPath(repositoryRoot,
                RequireValue(installerOptions.BannerImagePath, "Installer:BannerImagePath")),
            BackgroundImagePath = ResolveRepositoryPath(repositoryRoot,
                RequireValue(installerOptions.BackgroundImagePath, "Installer:BackgroundImagePath")),
            ProductIconPath = ResolveRepositoryPath(repositoryRoot,
                RequireValue(installerOptions.ProductIconPath, "Installer:ProductIconPath")),
            Manufacturer = ProductIdentity.VendorName,
            LayoutProjection = layoutProjection
        };
    }

    private static string FindRepositoryRoot() {
        var startingDirectories = new[] { Directory.GetCurrentDirectory(), AppContext.BaseDirectory }
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .Select(path => new DirectoryInfo(path));

        foreach (var startingDirectory in startingDirectories) {
            for (var current = startingDirectory; current is not null; current = current.Parent) {
                var appSettingsPath = Path.Combine(current.FullName, "build", "appsettings.json");
                if (System.IO.File.Exists(appSettingsPath))
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
    public required ProductBuildLayoutProjection LayoutProjection { get; init; }

    public string GetSingleUserHostInstallDirectory() =>
        ToWixFolderPath("%LocalAppDataFolder%", this.LayoutProjection.Runtime.Binaries.HostDirectoryRelativePath);

    public string GetSingleUserPeaInstallDirectory() =>
        ToWixFolderPath("%LocalAppDataFolder%", this.LayoutProjection.Runtime.Binaries.PeaDirectoryRelativePath);

    public string GetSingleUserRevitAddinsInstallDirectory() =>
        ToWixFolderPath("%AppDataFolder%", this.LayoutProjection.Revit.AddinsRootRelativePath);

    private static string ToWixFolderPath(string wixFolder, string relativePath) =>
        $@"{wixFolder}\{relativePath.Replace('/', '\\')}";
}

public sealed record InstallerConfigurationSection {
    public string? UpgradeCode { get; init; }
    public string? BannerImagePath { get; init; }
    public string? BackgroundImagePath { get; init; }
    public string? ProductIconPath { get; init; }
}

// PE_HOT_RELOAD_NUDGE
