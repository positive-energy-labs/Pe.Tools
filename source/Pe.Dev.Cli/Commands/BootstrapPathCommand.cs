using Pe.Dev.RevitAutomation;
using Pe.Shared.Product;

namespace Pe.Dev.Cli;

internal static class BootstrapPathCommand {
    public static int Run(IReadOnlyList<string> args, string? repoRootOverride) {
        if (args.Count > 0) {
            Console.Error.WriteLine("`pe-dev bootstrap-path` does not accept additional arguments.");
            return 10;
        }

        string repoRoot;
        try {
            repoRoot = RepoRootResolver.Resolve(repoRootOverride);
        } catch (Exception ex) {
            Console.Error.WriteLine(ex.Message);
            return 10;
        }

        var outputDirectory = Path.GetFullPath(AppContext.BaseDirectory).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
        var executablePath = Path.Combine(outputDirectory, PeDevCliIdentity.ExecutableName);
        if (!File.Exists(executablePath)) {
            Console.Error.WriteLine($"Could not locate '{PeDevCliIdentity.ExecutableName}' in the running output directory '{outputDirectory}'.");
            return 10;
        }

        var legacyProductDirectory = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            ProductIdentity.VendorName,
            ProductIdentity.ProductName,
            ProductPathNames.BinDirectoryName,
            PeDevCliIdentity.DirectoryName
        );
        var sourceBinRoot = Path.Combine(repoRoot, "source", "Pe.Dev.Cli", "bin");
        var existingUserPath = Environment.GetEnvironmentVariable("PATH", EnvironmentVariableTarget.User) ?? string.Empty;
        var preservedEntries = SplitPath(existingUserPath)
            .Where(entry =>
                !IsSamePath(entry, outputDirectory) &&
                !IsSamePath(entry, legacyProductDirectory) &&
                !IsSubPath(sourceBinRoot, entry)
            )
            .ToArray();
        var updatedUserPath = string.Join(Path.PathSeparator, preservedEntries.Prepend(outputDirectory));

        Environment.SetEnvironmentVariable("PATH", updatedUserPath, EnvironmentVariableTarget.User);
        Environment.SetEnvironmentVariable(
            "PATH",
            string.Join(Path.PathSeparator, SplitPath(Environment.GetEnvironmentVariable("PATH") ?? string.Empty)
                .Where(entry => !IsSamePath(entry, outputDirectory))
                .Prepend(outputDirectory)),
            EnvironmentVariableTarget.Process
        );

        Console.WriteLine($"pe-dev PATH bootstrapped to '{outputDirectory}'.");
        Console.WriteLine("Open a new terminal for the user PATH change to be picked up by shells and tools.");
        return 0;
    }

    private static IEnumerable<string> SplitPath(string pathValue) =>
        pathValue.Split(Path.PathSeparator, StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);

    private static bool IsSamePath(string left, string right) =>
        string.Equals(NormalizePath(left), NormalizePath(right), StringComparison.OrdinalIgnoreCase);

    private static bool IsSubPath(string rootPath, string candidatePath) {
        var normalizedRoot = NormalizePath(rootPath) + Path.DirectorySeparatorChar;
        var normalizedCandidate = NormalizePath(candidatePath) + Path.DirectorySeparatorChar;
        return normalizedCandidate.StartsWith(normalizedRoot, StringComparison.OrdinalIgnoreCase);
    }

    private static string NormalizePath(string path) =>
        Path.GetFullPath(Environment.ExpandEnvironmentVariables(path))
            .TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
}
