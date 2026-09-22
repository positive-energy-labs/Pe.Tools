using System.Security.Cryptography;
using System.Text;
using System.IO;

namespace Pe.Dev.RevitAutomation;

internal sealed class AutomationStatePaths {
    public AutomationStatePaths(string repoRoot) {
        this.RepoRoot = repoRoot;
    }

    public string RepoRoot { get; }
    public string AutomationRoot => Path.Combine(this.RepoRoot, ".artifacts", "automation");
    public string CacheRoot => Path.Combine(this.AutomationRoot, "cache");
    public string StateRoot => Path.Combine(this.AutomationRoot, "state");
    public string ReceiptsRoot => Path.Combine(this.AutomationRoot, "receipts");
    public string StagingInputsRoot => Path.Combine(this.AutomationRoot, "staging-inputs");
    public string BrowseContextPath => Path.Combine(this.StateRoot, "browse-context.json");
    public string HubsCachePath => Path.Combine(this.CacheRoot, "hubs.json");
    public string ProjectsCacheRoot => Path.Combine(this.CacheRoot, "projects");
    public string ContentsCacheRoot => Path.Combine(this.CacheRoot, "contents");
    public string ModelsCacheRoot => Path.Combine(this.CacheRoot, "models");

    public string GetProjectsCachePath(string hubId) =>
        Path.Combine(this.ProjectsCacheRoot, Hash(hubId) + ".json");

    public string GetContentsCachePath(string projectId, string scopePath) =>
        Path.Combine(this.ContentsCacheRoot, Hash(projectId), Hash(scopePath) + ".json");

    public string GetModelsCachePath(string projectId, string scopePath, bool recurse) =>
        Path.Combine(
            this.ModelsCacheRoot,
            Hash(projectId),
            Hash(scopePath + "|" + recurse) + ".json"
        );

    public string GetReceiptPath(string manifestPath) {
        var timestamp = DateTime.UtcNow.ToString("yyyyMMdd-HHmmss");
        var manifestName = Path.GetFileNameWithoutExtension(manifestPath);
        var safeName = string.IsNullOrWhiteSpace(manifestName) ? "schedule-submit" : SanitizeFileName(manifestName);
        return Path.Combine(this.ReceiptsRoot, $"{timestamp}-{safeName}.json");
    }

    private static string Hash(string value) {
        var bytes = SHA256.HashData(Encoding.UTF8.GetBytes(value.Trim()));
        return Convert.ToHexString(bytes).ToLowerInvariant();
    }

    private static string SanitizeFileName(string value) {
        var invalid = Path.GetInvalidFileNameChars();
        return new string(value.Select(ch => invalid.Contains(ch) ? '-' : ch).ToArray());
    }
}
