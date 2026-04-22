using System.IO;

namespace Pe.Dev.RevitAutomation;

internal static class RiderHotReloadFileDiscovery {
    internal static IReadOnlyList<string> ParseUnstagedRuntimeFiles(string repoRoot, string porcelainOutput) =>
        porcelainOutput
            .Split(["\r\n", "\n"], StringSplitOptions.RemoveEmptyEntries)
            .Where(IsUnstagedWorktreeChange)
            .Select(ParsePorcelainPath)
            .Where(path => !string.IsNullOrWhiteSpace(path))
            .Select(path => Path.IsPathRooted(path) ? path : Path.GetFullPath(Path.Combine(repoRoot, path)))
            .Where(IsRuntimeHotReloadPath)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .OrderBy(path => path, StringComparer.OrdinalIgnoreCase)
            .ToArray();

    internal static bool IsUnstagedWorktreeChange(string line) {
        if (string.IsNullOrWhiteSpace(line) || line.Length < 2)
            return false;

        if (line.StartsWith("??", StringComparison.Ordinal))
            return true;

        return line[1] != ' ';
    }

    internal static string ParsePorcelainPath(string line) {
        var trimmed = line.Length >= 4 ? line[3..].Trim() : string.Empty;
        var renameSeparatorIndex = trimmed.IndexOf(" -> ", StringComparison.Ordinal);
        return renameSeparatorIndex >= 0
            ? trimmed[(renameSeparatorIndex + 4)..].Trim()
            : trimmed;
    }

    private static bool IsRuntimeHotReloadPath(string path) {
        if (!path.EndsWith(".cs", StringComparison.OrdinalIgnoreCase))
            return false;

        if (!File.Exists(path))
            return false;

        if (IsTestPath(path))
            return false;

        return !IsBuildArtifactPath(path);
    }

    private static bool IsTestPath(string path) {
        var segments = path.Split(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
        return segments.Any(segment => segment.Contains("test", StringComparison.OrdinalIgnoreCase));
    }

    private static bool IsBuildArtifactPath(string path) {
        var segments = path.Split(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
        return segments.Any(segment =>
            string.Equals(segment, "bin", StringComparison.OrdinalIgnoreCase)
            || string.Equals(segment, "obj", StringComparison.OrdinalIgnoreCase)
        );
    }
}