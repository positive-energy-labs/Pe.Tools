using System.Diagnostics.CodeAnalysis;
using System.Text.RegularExpressions;
using WixSharp;

namespace Installer;

public static partial class InstallerComponentUtilities {
    public static WixEntity[] BuildDirectoryEntities(Feature feature, string directory, HarvestProgress progress) {
        progress.ReportDirectory(directory);
        var entities = Directory.EnumerateFiles(directory)
            .Select(file => new WixSharp.File(feature, file))
            .Cast<WixEntity>()
            .ToList();
        entities.AddRange(Directory.EnumerateDirectories(directory)
            .Select(childDirectory => new Dir(
                Path.GetFileName(childDirectory),
                BuildDirectoryEntities(feature, childDirectory, progress)
            )));
        return entities.ToArray();
    }

    public static bool TryParseRevitYear(string input, [NotNullWhen(true)] out string? year) {
        year = null;
        var match = VersionRegex().Match(input);
        if (!match.Success) return false;

        switch (match.Value.Length) {
        case 4:
            year = match.Value;
            return true;
        case 2:
            year = $"20{match.Value}";
            return true;
        default:
            return false;
        }
    }

    public static void LogFeatureFiles(string directory, string fileVersion) {
        var assemblies = Directory.GetFiles(directory, "*", SearchOption.AllDirectories);
        InstallerLog.WriteLine($"Installer files for version {fileVersion}: {assemblies.Length}");

        foreach (var assembly in assemblies) InstallerLog.WriteLine($"- {assembly}");
    }

    [GeneratedRegex(@"(\d+)(?!.*\d)")]
    private static partial Regex VersionRegex();
}

public sealed class HarvestProgress(string label) {
    private int directoryCount;

    public void ReportDirectory(string directory) {
        this.directoryCount++;
        if (this.directoryCount <= 20 || this.directoryCount % 250 == 0)
            InstallerLog.WriteLine($"Harvesting {label} directories: {this.directoryCount} ({directory})");
    }
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
