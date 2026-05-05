using Newtonsoft.Json;
using System.IO;

namespace Pe.Dev.RevitAutomation;

public sealed class AutomationBrowseContext {
    [JsonProperty("hubId")]
    public string? HubId { get; init; }

    [JsonProperty("hubName")]
    public string? HubName { get; init; }

    [JsonProperty("projectId")]
    public string? ProjectId { get; init; }

    [JsonProperty("projectName")]
    public string? ProjectName { get; init; }

    [JsonProperty("scopePath")]
    public string ScopePath { get; init; } = "";

    [JsonProperty("updatedAtUtc")]
    public DateTime UpdatedAtUtc { get; init; } = DateTime.UtcNow;
}

internal sealed class AutomationBrowseContextStore {
    public AutomationBrowseContext Load(string repoRoot) {
        var paths = new AutomationStatePaths(repoRoot);
        if (!File.Exists(paths.BrowseContextPath))
            return new AutomationBrowseContext();

        var content = File.ReadAllText(paths.BrowseContextPath);
        return JsonConvert.DeserializeObject<AutomationBrowseContext>(content) ?? new AutomationBrowseContext();
    }

    public void Save(string repoRoot, AutomationBrowseContext context) {
        var paths = new AutomationStatePaths(repoRoot);
        Directory.CreateDirectory(paths.StateRoot);
        var updated = new AutomationBrowseContext {
            HubId = context.HubId,
            HubName = context.HubName,
            ProjectId = context.ProjectId,
            ProjectName = context.ProjectName,
            ScopePath = context.ScopePath,
            UpdatedAtUtc = DateTime.UtcNow
        };
        File.WriteAllText(
            paths.BrowseContextPath,
            JsonConvert.SerializeObject(updated, Formatting.Indented)
        );
    }

    public void Clear(string repoRoot) {
        var paths = new AutomationStatePaths(repoRoot);
        if (File.Exists(paths.BrowseContextPath))
            File.Delete(paths.BrowseContextPath);
    }
}
