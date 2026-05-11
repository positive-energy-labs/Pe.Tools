using System.Diagnostics.CodeAnalysis;
using System.Text.RegularExpressions;
using Pe.Shared.Product;
using WixSharp;

namespace Installer;

public sealed record InstallerLayout(
    WixEntity[] RevitEntities,
    WixEntity[] HostEntities,
    WixEntity[] PeaEntities
);

public static partial class Generator {
    /// <summary>
    ///     Generates Wix entities, features and directories for the installer.
    /// </summary>
    public static InstallerLayout GenerateWixEntities(InstallerPayloadManifest payload) {
        InstallerLog.WriteLine("Harvesting installer payloads.");
        var versionStorages = new Dictionary<string, List<WixEntity>>();
        var revitFeature = new Feature {
            Name = "Revit Add-in", Description = "Revit add-in installation files", Display = FeatureDisplay.expand
        };

        foreach (var directory in payload.RevitPublishDirectories) {
            var directoryInfo = new DirectoryInfo(directory);
            InstallerLog.WriteLine($"Harvesting Revit payload: {directoryInfo.FullName}");
            if (!TryParseVersion(directoryInfo.FullName, out var fileVersion))
                throw new Exception($"Could not parse version from directory name: {directoryInfo.FullName}");

            var feature = new Feature {
                Name = fileVersion,
                Description = $"Install add-in for Revit {fileVersion}",
                ConfigurableDir = $"INSTALL{fileVersion}"
            };

            revitFeature.Add(feature);

            var files = new Files(feature, $@"{directory}\*.*");
            if (versionStorages.TryGetValue(fileVersion, out var storage))
                storage.Add(files);
            else
                versionStorages.Add(fileVersion, [files]);

            LogFeatureFiles(directory, fileVersion);
        }

        var hostFeature = new Feature {
            Name = "Shared Runtime",
            Description = "Install the shared external host used by connected Revit sessions."
        };
        var peaFeature = new Feature {
            Name = "Pe Agent CLI",
            Description = "Install the pea command-line agent entrypoint."
        };

        InstallerLog.WriteLine($"Harvesting runtime payload: {payload.RuntimePublishDirectory}");
        var hostEntities = new WixEntity[] { new Files(hostFeature, $@"{payload.RuntimePublishDirectory}\*.*") };
        InstallerLog.WriteLine($"Harvesting pea payload: {payload.PeaBootstrapDirectory}");
        var peaEntities = BuildPeaEntities(
                peaFeature,
                payload.PeaBootstrapDirectory,
                payload.PeaPayloadArchivePath,
                payload.PeaPayloadManifestPath
            )
            .Append(new EnvironmentVariable("PATH", "[INSTALLPEA]") {
                Part = EnvVarPart.last,
                Action = EnvVarAction.set
            })
            .ToArray();

        LogFeatureFiles(payload.RuntimePublishDirectory, "Runtime");
        LogFeatureFiles(payload.PeaBootstrapDirectory, "pea");
        InstallerLog.WriteLine($"Installer pea payload archive: {payload.PeaPayloadArchivePath}");
        InstallerLog.WriteLine($"Installer pea payload manifest: {payload.PeaPayloadManifestPath}");

        return new InstallerLayout(
            versionStorages
                .Select(storage => new Dir(new Id($"INSTALL{storage.Key}"), storage.Key, storage.Value.ToArray()))
                .Cast<WixEntity>()
                .ToArray(),
            hostEntities,
            peaEntities
        );
    }

    private static WixEntity[] BuildPeaEntities(
        Feature feature,
        string peaPublishDirectory,
        string peaPayloadArchivePath,
        string peaPayloadManifestPath
    ) =>
        BuildDirectoryEntities(feature, peaPublishDirectory, new HarvestProgress("pea"))
            .Append(new Dir(
                new Id("INSTALLPEAPACKAGES"),
                PeaCliIdentity.PackagesDirectoryName,
                new WixSharp.File(feature, peaPayloadArchivePath),
                new WixSharp.File(feature, peaPayloadManifestPath)
            ))
            .ToArray();

    private static WixEntity[] BuildDirectoryEntities(Feature feature, string directory, HarvestProgress progress) {
        progress.ReportDirectory(directory);
        var entities = new List<WixEntity> { new Files(feature, Path.Combine(directory, "*.*")) };
        entities.AddRange(Directory.EnumerateDirectories(directory)
            .Select(childDirectory => new Dir(
                Path.GetFileName(childDirectory),
                BuildDirectoryEntities(feature, childDirectory, progress)
            )));
        return entities.ToArray();
    }

    /// <summary>
    ///     Parse a version string from the given input.
    /// </summary>
    private static bool TryParseVersion(string input, [NotNullWhen(true)] out string? version) {
        version = null;
        var match = VersionRegex().Match(input);
        if (!match.Success) return false;

        switch (match.Value.Length) {
        case 4:
            version = match.Value;
            return true;
        case 2:
            version = $"20{match.Value}";
            return true;
        default:
            return false;
        }
    }

    /// <summary>
    ///     Write a list of installer files.
    /// </summary>
    private static void LogFeatureFiles(string directory, string fileVersion) {
        var assemblies = Directory.GetFiles(directory, "*", SearchOption.AllDirectories);
        InstallerLog.WriteLine($"Installer files for version {fileVersion}: {assemblies.Length}");

        foreach (var assembly in assemblies) InstallerLog.WriteLine($"- {assembly}");
    }

    private sealed class HarvestProgress(string label) {
        private int directoryCount;

        public void ReportDirectory(string directory) {
            this.directoryCount++;
            if (this.directoryCount <= 20 || this.directoryCount % 250 == 0)
                InstallerLog.WriteLine($"Harvesting {label} directories: {this.directoryCount} ({directory})");
        }
    }

    /// <summary>
    ///     A regular expression to match the last sequence of numeric characters in a string.
    /// </summary>
    [GeneratedRegex(@"(\d+)(?!.*\d)")]
    private static partial Regex VersionRegex();
}

public static class InstallerLog {
    public const string LatestLogFileName = "Pe.Tools.Installer.latest.log";

    private static readonly object SyncRoot = new();
    private static StreamWriter? writer;

    public static void Configure(string outputDirectory) {
        Directory.CreateDirectory(outputDirectory);
        var logPath = Path.Combine(outputDirectory, LatestLogFileName);
        lock (SyncRoot) {
            writer?.Dispose();
            writer = new StreamWriter(logPath, false) { AutoFlush = true };
        }

        WriteLine($"Installer log: {logPath}");
    }

    public static void WriteLine(string message) {
        var line = $"[{DateTimeOffset.Now:HH:mm:ss}] {message}";
        Console.WriteLine(line);
        lock (SyncRoot) {
            writer?.WriteLine(line);
        }
    }
}
