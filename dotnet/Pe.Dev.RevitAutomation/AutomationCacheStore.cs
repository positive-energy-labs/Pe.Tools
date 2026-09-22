using Newtonsoft.Json;
using System.IO;

namespace Pe.Dev.RevitAutomation;

public enum AutomationCacheScope {
    All,
    Hubs,
    Projects,
    Contents,
    Models
}

internal sealed class AutomationCacheStore {
    public bool TryReadHubs(string repoRoot, out AutomationHubCatalogResult result) =>
        TryRead(new AutomationStatePaths(repoRoot).HubsCachePath, out result);

    public void WriteHubs(string repoRoot, AutomationHubCatalogResult result) =>
        Write(new AutomationStatePaths(repoRoot).HubsCachePath, result);

    public bool TryReadProjects(string repoRoot, string hubId, out AutomationProjectCatalogResult result) =>
        TryRead(new AutomationStatePaths(repoRoot).GetProjectsCachePath(hubId), out result);

    public void WriteProjects(string repoRoot, string hubId, AutomationProjectCatalogResult result) =>
        Write(new AutomationStatePaths(repoRoot).GetProjectsCachePath(hubId), result);

    public bool TryReadContents(
        string repoRoot,
        string projectId,
        string scopePath,
        out AutomationContentCatalogResult result
    ) =>
        TryRead(new AutomationStatePaths(repoRoot).GetContentsCachePath(projectId, scopePath), out result);

    public void WriteContents(
        string repoRoot,
        string projectId,
        string scopePath,
        AutomationContentCatalogResult result
    ) =>
        Write(new AutomationStatePaths(repoRoot).GetContentsCachePath(projectId, scopePath), result);

    public bool TryReadModels(
        string repoRoot,
        string projectId,
        string scopePath,
        bool recurse,
        out AutomationModelInventoryResult result
    ) =>
        TryRead(new AutomationStatePaths(repoRoot).GetModelsCachePath(projectId, scopePath, recurse), out result);

    public void WriteModels(
        string repoRoot,
        string projectId,
        string scopePath,
        bool recurse,
        AutomationModelInventoryResult result
    ) =>
        Write(new AutomationStatePaths(repoRoot).GetModelsCachePath(projectId, scopePath, recurse), result);

    public void Clear(string repoRoot, AutomationCacheScope scope) {
        var paths = new AutomationStatePaths(repoRoot);
        switch (scope) {
        case AutomationCacheScope.All:
            DeleteDirectory(paths.CacheRoot);
            break;
        case AutomationCacheScope.Hubs:
            DeleteFile(paths.HubsCachePath);
            break;
        case AutomationCacheScope.Projects:
            DeleteDirectory(paths.ProjectsCacheRoot);
            break;
        case AutomationCacheScope.Contents:
            DeleteDirectory(paths.ContentsCacheRoot);
            break;
        case AutomationCacheScope.Models:
            DeleteDirectory(paths.ModelsCacheRoot);
            break;
        default:
            throw new ArgumentOutOfRangeException(nameof(scope), scope, null);
        }
    }

    public AutomationCacheStatus GetStatus(string repoRoot) {
        var paths = new AutomationStatePaths(repoRoot);
        return new AutomationCacheStatus {
            RootPath = paths.CacheRoot,
            HubsExists = File.Exists(paths.HubsCachePath),
            ProjectCacheFileCount = CountFiles(paths.ProjectsCacheRoot),
            ContentsCacheFileCount = CountFiles(paths.ContentsCacheRoot),
            ModelsCacheFileCount = CountFiles(paths.ModelsCacheRoot)
        };
    }

    private static bool TryRead<T>(string path, out T result) where T : new() {
        result = new T();
        if (!File.Exists(path))
            return false;

        var content = File.ReadAllText(path);
        if (string.IsNullOrWhiteSpace(content))
            return false;

        var deserialized = JsonConvert.DeserializeObject<T>(content);
        if (deserialized == null)
            return false;

        result = deserialized;
        return true;
    }

    private static void Write<T>(string path, T result) {
        var directory = Path.GetDirectoryName(path);
        if (!string.IsNullOrWhiteSpace(directory))
            Directory.CreateDirectory(directory);

        File.WriteAllText(path, JsonConvert.SerializeObject(result, Formatting.Indented));
    }

    private static void DeleteDirectory(string path) {
        if (Directory.Exists(path))
            Directory.Delete(path, true);
    }

    private static void DeleteFile(string path) {
        if (File.Exists(path))
            File.Delete(path);
    }

    private static int CountFiles(string path) =>
        Directory.Exists(path)
            ? Directory.EnumerateFiles(path, "*.json", SearchOption.AllDirectories).Count()
            : 0;
}

public sealed class AutomationCacheStatus {
    public string RootPath { get; init; } = "";
    public bool HubsExists { get; init; }
    public int ProjectCacheFileCount { get; init; }
    public int ContentsCacheFileCount { get; init; }
    public int ModelsCacheFileCount { get; init; }
}
