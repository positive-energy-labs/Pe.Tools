using Pe.Dev.RevitAutomation;
using Pe.Shared.Product;

namespace Pe.Dev.Cli;

internal static class PeaLinkDevCommand {
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

        var peaAppDirectory = Path.Combine(repoRoot, "source", "pea", "app");
        var runtimeNodePath = Path.Combine(repoRoot, "source", "pea", "runtime", "node", PeaCliIdentity.NodeExecutableName);
        var mainPath = Path.Combine(peaAppDirectory, "main.ts");
        var tsxPath = Path.Combine(peaAppDirectory, "node_modules", "tsx", "dist", "cli.mjs");

        if (!File.Exists(mainPath) || !File.Exists(tsxPath) || !File.Exists(runtimeNodePath)) {
            Console.Error.WriteLine(
                $"Could not locate required source-linked pea inputs under '{peaAppDirectory}'. Ensure main.ts, node_modules, and node.exe exist."
            );
            return 10;
        }

        var installedRuntime = ProductRuntimeLayout.ForCurrentUser();
        Directory.CreateDirectory(installedRuntime.Binaries.PeaDirectoryPath);
        File.WriteAllText(installedRuntime.Binaries.PeaLauncherPath, PeaLauncherContent.Create());
        File.WriteAllText(
            Path.Combine(installedRuntime.Binaries.PeaDirectoryPath, PeaCliIdentity.DevSourceFileName),
            repoRoot
        );

        Console.WriteLine($"pea dev source linked to '{repoRoot}'.");
        Console.WriteLine($"PATH-visible launcher updated at '{installedRuntime.Binaries.PeaLauncherPath}'.");
        Console.WriteLine("Use `pea --installed ...` to force the installed payload.");
        return 0;
    }
}
