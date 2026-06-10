using Pe.Dev.RevitAutomation;

namespace Pe.Dev.Cli.Codegen;

internal static class BuildGeneratedProjection {
    public static async Task<int> RunAsync(bool check, CodegenPaths paths, CancellationToken cancellationToken) {
        var args = new List<string> {
            "run",
            "--project",
            paths.BuildProjectPath,
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
            SafeDotNetProcess.Create(paths.RepoRoot, args.ToArray()),
            cancellationToken
        );
    }
}
