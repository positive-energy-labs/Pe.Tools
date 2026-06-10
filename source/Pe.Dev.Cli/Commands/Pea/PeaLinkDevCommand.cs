using Pe.Dev.RevitAutomation;
using Pe.Shared.Product;

namespace Pe.Dev.Cli;

internal static class PeaLinkDevCommand {
    private const string PecoLauncherName = "peco.cmd";

    public static int Run(IReadOnlyList<string> args, string? repoRootOverride) {
        if (args.Count > 0) {
            Console.Error.WriteLine("`pe-dev pea link-dev` does not accept additional arguments.");
            return 10;
        }

        string repoRoot;
        try {
            repoRoot = RepoRootResolver.Resolve(repoRootOverride);
        } catch (Exception ex) {
            Console.Error.WriteLine(ex.Message);
            return 10;
        }

        var peToolsDirectory = Path.Combine(repoRoot, "source", "pe-tools");
        var peaMainPath = Path.Combine(peToolsDirectory, "apps", "pea", "src", "main.ts");
        var pecoMainPath = Path.Combine(peToolsDirectory, "apps", "pe-code", "src", "main.ts");
        var workspacePath = Path.Combine(peToolsDirectory, "pnpm-workspace.yaml");
        var lockPath = Path.Combine(peToolsDirectory, "pnpm-lock.yaml");

        if (!File.Exists(peaMainPath) || !File.Exists(pecoMainPath) || !File.Exists(workspacePath) || !File.Exists(lockPath)) {
            Console.Error.WriteLine(
                $"Could not locate required source-linked Pea/Peco inputs under '{peToolsDirectory}'. Ensure source/pe-tools is installed and main.ts files plus pnpm workspace files exist."
            );
            return 10;
        }

        var installedRuntime = ProductRuntimeLayout.ForCurrentUser();
        Directory.CreateDirectory(installedRuntime.Binaries.PeaDirectoryPath);
        File.WriteAllText(installedRuntime.Binaries.PeaLauncherPath, PeaLauncherContent.Create("pea"));
        File.WriteAllText(
            Path.Combine(installedRuntime.Binaries.PeaDirectoryPath, PecoLauncherName),
            PeaLauncherContent.Create("peco")
        );
        File.WriteAllText(
            Path.Combine(installedRuntime.Binaries.PeaDirectoryPath, PeaCliIdentity.DevSourceFileName),
            repoRoot
        );

        Console.WriteLine($"pea/peco source linked to '{repoRoot}'.");
        Console.WriteLine($"PATH-visible pea launcher updated at '{installedRuntime.Binaries.PeaLauncherPath}'.");
        Console.WriteLine($"PATH-visible peco launcher updated at '{Path.Combine(installedRuntime.Binaries.PeaDirectoryPath, PecoLauncherName)}'.");
        Console.WriteLine("Use `pea` or `peco` for source-linked agent TUIs.");
        Console.WriteLine("Use `pea --installed ...` for the installed payload.");
        return 0;
    }
}
