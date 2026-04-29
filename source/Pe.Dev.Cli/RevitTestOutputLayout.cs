namespace Pe.Dev.Cli;

internal sealed record RevitTestOutputLayout(string AssemblyPath, string OutputDirectory) {
    public static RevitTestOutputLayout Resolve(string repoRoot, string configuration) {
        var configurationRoot = Path.Combine(
            repoRoot,
            ".artifacts",
            "build",
            "Pe.Revit.Tests",
            configuration,
            "bin",
            configuration
        );

        if (!Directory.Exists(configurationRoot)) {
            throw new InvalidOperationException(
                $"Could not find isolated test outputs for configuration '{configuration}' at '{configurationRoot}'."
            );
        }

        var assemblyPath = Directory.EnumerateFiles(configurationRoot, "Pe.Revit.Tests.dll", SearchOption.AllDirectories)
            .Where(path => !path.Contains($"{Path.DirectorySeparatorChar}ref{Path.DirectorySeparatorChar}", StringComparison.OrdinalIgnoreCase))
            .OrderBy(path => path.Length)
            .FirstOrDefault();

        if (string.IsNullOrWhiteSpace(assemblyPath)) {
            throw new InvalidOperationException(
                $"Could not locate Pe.Revit.Tests.dll under '{configurationRoot}'."
            );
        }

        var outputDirectory = Path.GetDirectoryName(assemblyPath)
            ?? throw new InvalidOperationException($"Could not resolve output directory for '{assemblyPath}'.");

        return new RevitTestOutputLayout(assemblyPath, outputDirectory);
    }
}
