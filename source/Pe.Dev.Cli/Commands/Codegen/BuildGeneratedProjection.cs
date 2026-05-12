using Pe.Dev.RevitAutomation;

namespace Pe.Dev.Cli;

internal static class BuildGeneratedProjection {
    public static async Task<int> RunAsync(bool check, string? repoRootOverride, CancellationToken cancellationToken) {
        string repoRoot;
        try {
            repoRoot = RepoRootResolver.Resolve(repoRootOverride);
        } catch (Exception ex) {
            Console.Error.WriteLine(ex.Message);
            return 10;
        }

        var args = new List<string> {
            "run",
            "--project",
            Path.Combine(repoRoot, "build", "Build.csproj"),
            "-c",
            "Release",
            "/p:NoWarn=ConsoleUse",
            "/p:WarningsNotAsErrors=ConsoleUse",
            "--",
            "sync-contracts"
        };
        if (check)
            args.Add("--check");

        return await ForegroundProcessRunner.RunAsync(
            SafeDotNetProcess.Create(repoRoot, args.ToArray()),
            cancellationToken
        );
    }
}
