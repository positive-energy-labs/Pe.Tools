using Pe.Dev.RevitAutomation;

namespace Pe.Dev.Cli;

internal static class HostTypeGenerationProjection {
    public static async Task<int> RunAsync(bool check, string? repoRootOverride, CancellationToken cancellationToken) {
        string repoRoot;
        try {
            repoRoot = RepoRootResolver.Resolve(repoRootOverride);
        } catch (Exception ex) {
            Console.Error.WriteLine(ex.Message);
            return 10;
        }

        var buildExit = await HostTypeGenerationModelProvider.EnsureFreshBuildAsync(repoRoot, cancellationToken);
        if (buildExit != 0)
            return buildExit;

        HostTypeGenerationModelProvider.GeneratedHostTypeModel generatedModel;
        try {
            generatedModel = HostTypeGenerationModelProvider.Load(repoRoot);
        } catch (Exception ex) {
            Console.Error.WriteLine($"Host TypeScript type generation failed: {ex.Message}");
            return 1;
        }

        return check
            ? await CheckAsync(repoRoot, generatedModel.Files, cancellationToken)
            : await SyncAsync(repoRoot, generatedModel.Files, cancellationToken);
    }

    private static async Task<int> CheckAsync(
        string repoRoot,
        IReadOnlyList<HostTypeGenerationModelProvider.GeneratedProjectionFile> generatedFiles,
        CancellationToken cancellationToken
    ) {
        var staleFiles = new List<string>();
        var expectedPaths = generatedFiles.Select(file => file.Path).ToHashSet(StringComparer.OrdinalIgnoreCase);
        foreach (var generatedFile in generatedFiles) {
            var relativePath = Path.GetRelativePath(repoRoot, generatedFile.Path);
            if (!File.Exists(generatedFile.Path)) {
                staleFiles.Add($"{relativePath} (missing)");
                continue;
            }

            var existingContent = await File.ReadAllTextAsync(generatedFile.Path, cancellationToken);
            if (!string.Equals(existingContent, generatedFile.Content, StringComparison.Ordinal))
                staleFiles.Add(relativePath);
        }

        foreach (var extraFile in EnumerateCommittedHostTypeFiles(repoRoot).Where(path => !expectedPaths.Contains(path)))
            staleFiles.Add($"{Path.GetRelativePath(repoRoot, extraFile)} (extra)");

        if (staleFiles.Count == 0) {
            Console.WriteLine("Generated Host TypeScript types are current.");
            return 0;
        }

        Console.Error.WriteLine("Generated Host TypeScript types are stale:");
        foreach (var staleFile in staleFiles)
            Console.Error.WriteLine($"  {staleFile}");
        Console.Error.WriteLine("Run `pe-dev codegen sync --target host-types` to update them.");
        return 1;
    }

    private static async Task<int> SyncAsync(
        string repoRoot,
        IReadOnlyList<HostTypeGenerationModelProvider.GeneratedProjectionFile> generatedFiles,
        CancellationToken cancellationToken
    ) {
        var expectedPaths = generatedFiles.Select(file => file.Path).ToHashSet(StringComparer.OrdinalIgnoreCase);
        foreach (var extraFile in EnumerateCommittedHostTypeFiles(repoRoot).Where(path => !expectedPaths.Contains(path))) {
            File.Delete(extraFile);
            Console.WriteLine($"Deleted {Path.GetRelativePath(repoRoot, extraFile)}");
        }

        foreach (var generatedFile in generatedFiles) {
            Directory.CreateDirectory(Path.GetDirectoryName(generatedFile.Path)!);
            await File.WriteAllTextAsync(generatedFile.Path, generatedFile.Content, cancellationToken);
            Console.WriteLine($"Generated {Path.GetRelativePath(repoRoot, generatedFile.Path)}");
        }

        return 0;
    }

    private static IEnumerable<string> EnumerateCommittedHostTypeFiles(string repoRoot) {
        var outputDirectory = Path.Combine(repoRoot, "source", "pea", "app", "generated", "host-types");
        return Directory.Exists(outputDirectory)
            ? Directory.EnumerateFiles(outputDirectory, "*.ts", SearchOption.AllDirectories).Select(Path.GetFullPath)
            : [];
    }
}
