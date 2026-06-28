using Pe.Dev.RevitAutomation;

namespace Pe.Dev.Cli.Codegen;

internal static class BuildGeneratedProjection {
    public static async Task<int> RunAsync(CodegenPaths paths, CancellationToken cancellationToken) {
        string[] args = [
            "run",
            "--project",
            paths.BuildProjectPath,
            "-c",
            "Release",
            "/p:NoWarn=ConsoleUse",
            "/p:WarningsNotAsErrors=ConsoleUse",
            "--",
            "sync-contracts"
        ];

        return await ForegroundProcessRunner.RunAsync(
            SafeDotNetProcess.Create(paths.RepoRoot, args),
            cancellationToken
        );
    }
}
