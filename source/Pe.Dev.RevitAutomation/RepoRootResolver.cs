using System.IO;

namespace Pe.Dev.RevitAutomation;

public static class RepoRootResolver {
    private const string SolutionMarkerFileName = "Pe.Tools.slnx";

    public static string Resolve(string? repoRootOverride = null) {
        if (!string.IsNullOrWhiteSpace(repoRootOverride))
            return ValidateRepoRoot(repoRootOverride);

        if (TryResolve() is { } repoRoot)
            return repoRoot;

        throw new InvalidOperationException(
            "Could not locate the Pe.Tools repo root. Run from inside the repo or pass --repo-root."
        );
    }

    public static string? TryResolve() {
        var environmentRoot = Environment.GetEnvironmentVariable("PE_TOOLS_REPO_ROOT");
        if (!string.IsNullOrWhiteSpace(environmentRoot) && TryValidateRepoRoot(environmentRoot, out var validatedEnvironmentRoot))
            return validatedEnvironmentRoot;

        foreach (var candidate in EnumerateProbeRoots()) {
            if (FindRepoRoot(candidate) is { } discoveredRoot)
                return discoveredRoot;
        }

        return null;
    }

    private static IEnumerable<string> EnumerateProbeRoots() {
        yield return Directory.GetCurrentDirectory();
        yield return AppContext.BaseDirectory;
    }

    private static string? FindRepoRoot(string startDirectory) {
        var current = new DirectoryInfo(Path.GetFullPath(startDirectory));
        while (current is not null) {
            if (File.Exists(Path.Combine(current.FullName, SolutionMarkerFileName)))
                return current.FullName;

            current = current.Parent;
        }

        return null;
    }

    private static bool TryValidateRepoRoot(string repoRoot, out string? fullPath) {
        fullPath = Path.GetFullPath(repoRoot);
        return File.Exists(Path.Combine(fullPath, SolutionMarkerFileName));
    }

    private static string ValidateRepoRoot(string repoRoot) {
        var fullPath = Path.GetFullPath(repoRoot);
        if (!File.Exists(Path.Combine(fullPath, SolutionMarkerFileName))) {
            throw new InvalidOperationException(
                $"Repo root '{fullPath}' does not contain {SolutionMarkerFileName}."
            );
        }

        return fullPath;
    }
}
