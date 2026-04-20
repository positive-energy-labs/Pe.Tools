namespace Pe.Dev.Cli;

internal sealed record RepoLayout(
    string RepoRoot,
    string AppDirectory,
    string RevitTestsDirectory,
    string AppAutoApproveScript,
    string RevitTestAutoApproveScript,
    string RevitTestPrepareHotReloadScript
)
{
    private const string SolutionMarkerFileName = "Pe.Tools.slnx";

    public static RepoLayout Create(string? repoRootOverride)
    {
        var repoRoot = ResolveRepoRoot(repoRootOverride);
        var appDirectory = Path.Combine(repoRoot, "source", "Pe.App");
        var revitTestsDirectory = Path.Combine(repoRoot, "source", "Pe.Revit.Tests");

        return new RepoLayout(
            repoRoot,
            appDirectory,
            revitTestsDirectory,
            Path.Combine(appDirectory, "AutoApproveAddin.ps1"),
            Path.Combine(revitTestsDirectory, "AutoApproveAddin.ps1"),
            Path.Combine(revitTestsDirectory, "PrepareRiderHotReload.ps1")
        );
    }

    private static string ResolveRepoRoot(string? repoRootOverride)
    {
        if (!string.IsNullOrWhiteSpace(repoRootOverride))
        {
            return ValidateRepoRoot(repoRootOverride);
        }

        var environmentRoot = Environment.GetEnvironmentVariable("PE_TOOLS_REPO_ROOT");
        if (!string.IsNullOrWhiteSpace(environmentRoot))
        {
            return ValidateRepoRoot(environmentRoot);
        }

        foreach (var candidate in EnumerateProbeRoots())
        {
            var discoveredRoot = FindRepoRoot(candidate);
            if (discoveredRoot is not null)
            {
                return discoveredRoot;
            }
        }

        throw new InvalidOperationException(
            "Could not locate the Pe.Tools repo root. Run from inside the repo or pass --repo-root."
        );
    }

    private static IEnumerable<string> EnumerateProbeRoots()
    {
        yield return Directory.GetCurrentDirectory();
        yield return AppContext.BaseDirectory;
    }

    private static string? FindRepoRoot(string startDirectory)
    {
        var current = new DirectoryInfo(Path.GetFullPath(startDirectory));
        while (current is not null)
        {
            if (File.Exists(Path.Combine(current.FullName, SolutionMarkerFileName)))
            {
                return current.FullName;
            }

            current = current.Parent;
        }

        return null;
    }

    private static string ValidateRepoRoot(string repoRoot)
    {
        var fullPath = Path.GetFullPath(repoRoot);
        if (!File.Exists(Path.Combine(fullPath, SolutionMarkerFileName)))
        {
            throw new InvalidOperationException(
                $"Repo root '{fullPath}' does not contain {SolutionMarkerFileName}."
            );
        }

        return fullPath;
    }
}
