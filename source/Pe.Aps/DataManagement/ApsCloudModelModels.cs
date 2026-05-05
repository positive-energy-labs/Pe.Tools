
namespace Pe.Aps.DataManagement;

public sealed record ApsCloudContentScope(
    string HubId,
    string ProjectId,
    string? FolderId,
    string? FolderPath
);

public sealed record ApsCloudModelDiscoveryRequest(
    string HubId,
    string ProjectId,
    string? FolderId,
    string? FolderPath,
    string? NameContains,
    bool Recurse,
    IReadOnlyList<string> ExcludePathGlobs,
    string? RegionOverride
);

public sealed class ApsCloudContentCatalogResult {
    public string HubId { get; init; } = "";
    public string ProjectId { get; init; } = "";
    public string ScopeName { get; init; } = "";
    public IReadOnlyList<DataManagementContentEntry> Entries { get; init; } = [];
}

public sealed class ApsCloudModelDiscoveryResult {
    public DataManagementHubEntry Hub { get; init; } = null!;
    public DataManagementProjectEntry Project { get; init; } = null!;
    public string Region { get; init; } = "";
    public string ScopePath { get; init; } = "";
    public bool Recursive { get; init; }
    public string? NameContains { get; init; }
    public IReadOnlyList<ApsDiscoveredCloudModel> Models { get; init; } = [];
}

public sealed class ApsDiscoveredCloudModel {
    public string HubId { get; init; } = "";
    public string HubName { get; init; } = "";
    public string ProjectId { get; init; } = "";
    public string ProjectName { get; init; } = "";
    public string Region { get; init; } = "";
    public string FolderPath { get; init; } = "";
    public string ItemId { get; init; } = "";
    public string VersionId { get; init; } = "";
    public string DisplayName { get; init; } = "";
    public string ProjectGuid { get; init; } = "";
    public string ModelGuid { get; init; } = "";
    public int? RevitProjectVersion { get; init; }
}

internal sealed class ResolvedApsFolderScope {
    public string? FolderId { get; init; }
    public string DisplayPath { get; init; } = "";
}
