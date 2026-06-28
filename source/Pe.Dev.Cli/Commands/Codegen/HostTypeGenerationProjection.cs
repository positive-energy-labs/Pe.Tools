namespace Pe.Dev.Cli.Codegen;

internal static class HostTypeGenerationProjection {
    public static async Task<int> RunAsync(
        CodegenPaths paths,
        CancellationToken cancellationToken
    ) {
        var buildExit = await HostTypeGenerationModelProvider.EnsureFreshBuildAsync(paths, cancellationToken);
        if (buildExit != 0)
            return buildExit;

        HostTypeGenerationModelProvider.GeneratedHostTypeModel generatedModel;
        try {
            generatedModel = HostTypeGenerationModelProvider.Load(paths);
        } catch (Exception ex) {
            Console.Error.WriteLine($"Host TypeScript type generation failed: {ex.Message}");
            return 1;
        }

        return await SyncAsync(paths, generatedModel.Files, cancellationToken);
    }

    private static async Task<int> SyncAsync(
        CodegenPaths paths,
        IReadOnlyList<HostTypeGenerationModelProvider.GeneratedProjectionFile> generatedFiles,
        CancellationToken cancellationToken
    ) {
        var expectedPaths = generatedFiles.Select(file => file.Path).ToHashSet(StringComparer.OrdinalIgnoreCase);
        foreach (var extraFile in EnumerateCommittedHostTypeFiles(paths).Where(path => !expectedPaths.Contains(path))) {
            File.Delete(extraFile);
            Console.WriteLine($"Deleted {Path.GetRelativePath(paths.RepoRoot, extraFile)}");
        }

        foreach (var generatedFile in generatedFiles) {
            Directory.CreateDirectory(Path.GetDirectoryName(generatedFile.Path)!);
            await File.WriteAllTextAsync(generatedFile.Path, generatedFile.Content, cancellationToken);
            Console.WriteLine($"Generated {Path.GetRelativePath(paths.RepoRoot, generatedFile.Path)}");
        }

        return 0;
    }

    private static IEnumerable<string> EnumerateCommittedHostTypeFiles(CodegenPaths paths) =>
        Directory.Exists(paths.HostTypeGenDirectory)
            ? Directory.EnumerateFiles(paths.HostTypeGenDirectory, "*.ts", SearchOption.AllDirectories).Select(Path.GetFullPath)
            : [];
}
