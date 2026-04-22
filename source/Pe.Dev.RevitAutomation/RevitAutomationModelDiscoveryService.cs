using Newtonsoft.Json;
using Pe.Shared.Aps;
using Pe.Shared.Aps.Core;
using Pe.Shared.Aps.Models;
using Pe.Shared.RevitData;
using System.IO;

namespace Pe.Dev.RevitAutomation;

public sealed class RevitAutomationModelDiscoveryService {
    public async Task<AutomationHubCatalogResult> ListHubsAsync(
        Action<string>? log,
        CancellationToken cancellationToken
    ) {
        var client = CreateDataManagementClient(log);
        var hubs = await client.GetHubsAsync(cancellationToken).ConfigureAwait(false);
        return new AutomationHubCatalogResult {
            Hubs = hubs
                .Select(hub => new AutomationHubDescriptor { Id = hub.Id, Name = hub.Name, Region = hub.Region })
                .OrderBy(hub => hub.Name, StringComparer.OrdinalIgnoreCase)
                .ToList()
        };
    }

    public async Task<AutomationProjectCatalogResult> ListProjectsAsync(
        AutomationListProjectsOptions options,
        Action<string>? log,
        CancellationToken cancellationToken
    ) {
        var client = CreateDataManagementClient(log);
        var projects = await client.GetProjectsAsync(options.HubId, cancellationToken).ConfigureAwait(false);
        return new AutomationProjectCatalogResult {
            HubId = options.HubId,
            Projects = projects
                .Select(project => new AutomationProjectDescriptor { Id = project.Id, Name = project.Name })
                .OrderBy(project => project.Name, StringComparer.OrdinalIgnoreCase)
                .ToList()
        };
    }

    public async Task<AutomationContentCatalogResult> ListContentsAsync(
        AutomationListContentsOptions options,
        Action<string>? log,
        CancellationToken cancellationToken
    ) {
        var client = CreateDataManagementClient(log);
        var scope = await ResolveScopeAsync(client, options.HubId, options.ProjectId, options.FolderId,
                options.FolderPath, cancellationToken)
            .ConfigureAwait(false);

        var entries = scope.FolderId == null
            ? await client.GetTopFoldersAsync(options.HubId, options.ProjectId, cancellationToken).ConfigureAwait(false)
            : await client.GetFolderContentsAsync(options.ProjectId, scope.FolderId, cancellationToken)
                .ConfigureAwait(false);

        return new AutomationContentCatalogResult {
            HubId = options.HubId,
            ProjectId = options.ProjectId,
            ScopeName = scope.DisplayPath,
            Entries = entries
                .Select(entry => new AutomationContentDescriptor {
                    Id = entry.Id, Name = entry.Name, IsFolder = entry.IsFolder, ExtensionType = entry.ExtensionType
                })
                .OrderByDescending(entry => entry.IsFolder)
                .ThenBy(entry => entry.Name, StringComparer.OrdinalIgnoreCase)
                .ToList()
        };
    }

    public async Task<ModelDiscoveryResult> DiscoverModelsAsync(
        ModelDiscoveryOptions options,
        string? repoRootOverride,
        Action<string>? log,
        CancellationToken cancellationToken
    ) {
        var client = CreateDataManagementClient(log);
        var hubs = await client.GetHubsAsync(cancellationToken).ConfigureAwait(false);
        var hub = hubs.FirstOrDefault(candidate => string.Equals(candidate.Id, options.HubId, StringComparison.Ordinal))
                  ?? throw new InvalidOperationException(
                      $"Hub '{options.HubId}' was not found in the authenticated account.");
        var projects = await client.GetProjectsAsync(options.HubId, cancellationToken).ConfigureAwait(false);
        var project = projects.FirstOrDefault(candidate =>
                          string.Equals(candidate.Id, options.ProjectId, StringComparison.Ordinal))
                      ?? throw new InvalidOperationException(
                          $"Project '{options.ProjectId}' was not found in hub '{options.HubId}'.");

        var resolvedRegion = ResolveRegion(options.RegionOverride, hub.Region);
        var scope = await ResolveScopeAsync(client, options.HubId, options.ProjectId, options.FolderId,
                options.FolderPath, cancellationToken)
            .ConfigureAwait(false);
        var excludeMatcher = new PathGlobMatcher(options.ExcludePathGlobs);

        var discoveredModels = new List<DiscoveredAutomationModel>();
        if (scope.FolderId == null) {
            var topFolders = await client.GetTopFoldersAsync(options.HubId, options.ProjectId, cancellationToken)
                .ConfigureAwait(false);
            foreach (var folder in topFolders.Where(entry => entry.IsFolder)) {
                await DiscoverFolderAsync(
                        client,
                        options,
                        resolvedRegion,
                        hub,
                        project,
                        folder.Id,
                        folder.Name,
                        excludeMatcher,
                        discoveredModels,
                        log,
                        cancellationToken
                    )
                    .ConfigureAwait(false);
            }
        } else {
            await DiscoverFolderAsync(
                    client,
                    options,
                    resolvedRegion,
                    hub,
                    project,
                    scope.FolderId,
                    scope.DisplayPath,
                    excludeMatcher,
                    discoveredModels,
                    log,
                    cancellationToken
                )
                .ConfigureAwait(false);
        }

        discoveredModels = discoveredModels
            .OrderBy(model => model.FolderPath, StringComparer.OrdinalIgnoreCase)
            .ThenBy(model => model.DisplayName, StringComparer.OrdinalIgnoreCase)
            .ToList();

        var result = new ModelDiscoveryResult {
            HubId = hub.Id,
            HubName = hub.Name,
            ProjectId = project.Id,
            ProjectName = project.Name,
            Region = resolvedRegion,
            ScopePath = scope.DisplayPath,
            Recursive = options.Recurse,
            NameContains = options.NameContains,
            ModelCount = discoveredModels.Count,
            Models = discoveredModels
        };

        if (!string.IsNullOrWhiteSpace(options.OutManifestPath)) {
            var repoRoot = RepoRootResolver.Resolve(repoRootOverride);
            var manifestPath = WriteManifest(repoRoot, options.OutManifestPath, discoveredModels, resolvedRegion,
                options);
            result.ManifestPath = manifestPath;
        }

        return result;
    }

    private static DataManagementApiClient CreateDataManagementClient(Action<string>? log) {
        var authProvider = new StoredApsWebAuthTokenProvider();
        var aps = new Aps(authProvider);
        log?.Invoke("Auth: acquiring data-management token");
        _ = aps.GetTokenResult(ApsTokenRequest.ForParameterService());
        return aps.DataManagement();
    }

    private static string ResolveRegion(string? regionOverride, string? hubRegion) {
        if (!string.IsNullOrWhiteSpace(regionOverride))
            return NormalizeRegion(regionOverride);
        if (!string.IsNullOrWhiteSpace(hubRegion))
            return NormalizeRegion(hubRegion);

        throw new InvalidOperationException(
            "Could not determine region from the selected hub. Pass --region explicitly."
        );
    }

    private static string NormalizeRegion(string region) =>
        region.Trim().ToUpperInvariant() switch {
            "EU" => "EMEA",
            "EMEA" => "EMEA",
            "US" => "US",
            var value => value
        };

    private static string WriteManifest(
        string repoRoot,
        string manifestPath,
        IReadOnlyList<DiscoveredAutomationModel> models,
        string region,
        ModelDiscoveryOptions options
    ) {
        var fullPath = Path.GetFullPath(
            Path.IsPathRooted(manifestPath) ? manifestPath : Path.Combine(repoRoot, manifestPath)
        );
        var directory = Path.GetDirectoryName(fullPath);
        if (!string.IsNullOrWhiteSpace(directory))
            Directory.CreateDirectory(directory);

        var manifest = new ParameterCollectionBatchManifest {
            Engine = options.Engine,
            TimeoutSeconds = options.TimeoutSeconds,
            MaxConcurrency = options.MaxConcurrency,
            Debug = options.Debug,
            Mask = options.Mask,
            Models = models.Select(model => new ParameterCollectionBatchEntry {
                Region = region,
                ProjectGuid = model.ProjectGuid,
                ModelGuid = model.ModelGuid,
                ExpectedTitle = model.SuggestedExpectedTitle,
                Filter = options.Filter
            }).ToList()
        };

        File.WriteAllText(fullPath, JsonConvert.SerializeObject(manifest, Formatting.Indented));
        return fullPath;
    }

    private static async Task<ResolvedFolderScope> ResolveScopeAsync(
        DataManagementApiClient client,
        string hubId,
        string projectId,
        string? folderId,
        string? folderPath,
        CancellationToken cancellationToken
    ) {
        if (!string.IsNullOrWhiteSpace(folderId) && !string.IsNullOrWhiteSpace(folderPath))
            throw new ArgumentException("Pass either --folder-id or --folder-path, not both.");

        if (!string.IsNullOrWhiteSpace(folderId)) {
            return new ResolvedFolderScope { FolderId = folderId.Trim(), DisplayPath = folderId.Trim() };
        }

        if (string.IsNullOrWhiteSpace(folderPath)) {
            return new ResolvedFolderScope { FolderId = null, DisplayPath = "(top folders)" };
        }

        var segments = SplitFolderPath(folderPath);
        var topFolders = await client.GetTopFoldersAsync(hubId, projectId, cancellationToken).ConfigureAwait(false);
        if (segments.Length == 0) {
            return new ResolvedFolderScope { FolderId = null, DisplayPath = "(top folders)" };
        }

        var first = topFolders.FirstOrDefault(folder => folder.IsFolder && MatchesName(folder.Name, segments[0]))
                    ?? throw BuildFolderResolutionFailure(folderPath, "(top folders)", topFolders);

        var currentFolder = first;
        var displaySegments = new List<string> { first.Name };
        for (var i = 1; i < segments.Length; i++) {
            var contents = await client.GetFolderContentsAsync(projectId, currentFolder.Id, cancellationToken)
                .ConfigureAwait(false);
            currentFolder = contents.FirstOrDefault(folder => folder.IsFolder && MatchesName(folder.Name, segments[i]))
                            ?? throw BuildFolderResolutionFailure(folderPath, string.Join("/", displaySegments),
                                contents);
            displaySegments.Add(currentFolder.Name);
        }

        return new ResolvedFolderScope { FolderId = currentFolder.Id, DisplayPath = string.Join("/", displaySegments) };
    }

    private static async Task DiscoverFolderAsync(
        DataManagementApiClient client,
        ModelDiscoveryOptions options,
        string region,
        DataManagementHubEntry hub,
        DataManagementProjectEntry project,
        string folderId,
        string folderPath,
        PathGlobMatcher excludeMatcher,
        List<DiscoveredAutomationModel> discoveredModels,
        Action<string>? log,
        CancellationToken cancellationToken
    ) {
        if (excludeMatcher.IsMatch(folderPath, true)) {
            log?.Invoke($"Discovery: skipping excluded path {folderPath}");
            return;
        }

        log?.Invoke($"Discovery: scanning {folderPath}");
        var contents = await client.GetFolderContentsAsync(project.Id, folderId, cancellationToken)
            .ConfigureAwait(false);
        foreach (var item in contents.Where(entry => !entry.IsFolder)) {
            if (!ShouldIncludeByName(item.Name, options.NameContains))
                continue;

            var itemPath = $"{folderPath}/{item.Name}";
            if (excludeMatcher.IsMatch(itemPath)) {
                log?.Invoke($"Discovery: skipping excluded path {itemPath}");
                continue;
            }

            var model = await TryReadModelAsync(client, project.Id, item, folderPath, region, hub, project,
                    cancellationToken)
                .ConfigureAwait(false);
            if (model != null)
                discoveredModels.Add(model);
        }

        if (!options.Recurse)
            return;

        foreach (var childFolder in contents.Where(entry => entry.IsFolder)) {
            await DiscoverFolderAsync(
                    client,
                    options,
                    region,
                    hub,
                    project,
                    childFolder.Id,
                    $"{folderPath}/{childFolder.Name}",
                    excludeMatcher,
                    discoveredModels,
                    log,
                    cancellationToken
                )
                .ConfigureAwait(false);
        }
    }

    private static async Task<DiscoveredAutomationModel?> TryReadModelAsync(
        DataManagementApiClient client,
        string projectId,
        DataManagementContentEntry item,
        string folderPath,
        string region,
        DataManagementHubEntry hub,
        DataManagementProjectEntry project,
        CancellationToken cancellationToken
    ) {
        var versions = await client.GetItemVersionsAsync(projectId, item.Id, cancellationToken).ConfigureAwait(false);
        var latestModelVersion = versions
            .Where(version =>
                Guid.TryParse(version.ProjectGuid, out _) &&
                Guid.TryParse(version.ModelGuid, out _))
            .OrderByDescending(version => version.CreatedAt ?? DateTimeOffset.MinValue)
            .FirstOrDefault();

        if (latestModelVersion == null)
            return null;

        return new DiscoveredAutomationModel {
            HubId = hub.Id,
            HubName = hub.Name,
            ProjectId = project.Id,
            ProjectName = project.Name,
            Region = region,
            FolderPath = folderPath,
            ItemId = item.Id,
            VersionId = latestModelVersion.Id,
            DisplayName = latestModelVersion.DisplayName,
            SuggestedExpectedTitle = BuildSuggestedExpectedTitle(latestModelVersion.DisplayName),
            ProjectGuid = latestModelVersion.ProjectGuid!,
            ModelGuid = latestModelVersion.ModelGuid!
        };
    }

    internal static string? BuildSuggestedExpectedTitle(string? displayName) {
        if (string.IsNullOrWhiteSpace(displayName))
            return null;

        var fileName = displayName.Trim();
        return fileName.EndsWith(".rvt", StringComparison.OrdinalIgnoreCase)
            ? fileName[..^4]
            : fileName;
    }

    private static bool ShouldIncludeByName(string value, string? nameContains) =>
        string.IsNullOrWhiteSpace(nameContains) ||
        value.Contains(nameContains, StringComparison.OrdinalIgnoreCase);

    private static bool MatchesName(string left, string right) =>
        string.Equals(left.Trim(), right.Trim(), StringComparison.OrdinalIgnoreCase);

    private static string[] SplitFolderPath(string folderPath) =>
        folderPath
            .Split(['/', '\\'], StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);

    private static Exception BuildFolderResolutionFailure(
        string requestedPath,
        string scope,
        IEnumerable<DataManagementContentEntry> candidates
    ) {
        var names = candidates
            .Where(candidate => candidate.IsFolder)
            .Select(candidate => candidate.Name)
            .OrderBy(name => name, StringComparer.OrdinalIgnoreCase)
            .ToArray();

        var available = names.Length == 0 ? "(none)" : string.Join(", ", names);
        return new InvalidOperationException(
            $"Could not resolve folder path '{requestedPath}' under '{scope}'. Available folders: {available}."
        );
    }

    private sealed class ResolvedFolderScope {
        public string? FolderId { get; init; }
        public string DisplayPath { get; init; } = "";
    }
}

public sealed record AutomationListProjectsOptions(string HubId);

public sealed record AutomationListContentsOptions(
    string HubId,
    string ProjectId,
    string? FolderId,
    string? FolderPath
);

public sealed record ModelDiscoveryOptions(
    string HubId,
    string ProjectId,
    string? FolderId,
    string? FolderPath,
    string? NameContains,
    bool Recurse,
    IReadOnlyList<string> ExcludePathGlobs,
    string? OutManifestPath,
    string? RegionOverride,
    string Engine,
    int TimeoutSeconds,
    int MaxConcurrency,
    bool Debug,
    bool Mask,
    LoadedFamiliesFilter? Filter
);

public sealed class AutomationHubCatalogResult {
    public List<AutomationHubDescriptor> Hubs { get; init; } = [];
}

public sealed class AutomationHubDescriptor {
    public string Id { get; init; } = "";
    public string Name { get; init; } = "";
    public string? Region { get; init; }
}

public sealed class AutomationProjectCatalogResult {
    public string HubId { get; init; } = "";
    public List<AutomationProjectDescriptor> Projects { get; init; } = [];
}

public sealed class AutomationProjectDescriptor {
    public string Id { get; init; } = "";
    public string Name { get; init; } = "";
}

public sealed class AutomationContentCatalogResult {
    public string HubId { get; init; } = "";
    public string ProjectId { get; init; } = "";
    public string ScopeName { get; init; } = "";
    public List<AutomationContentDescriptor> Entries { get; init; } = [];
}

public sealed class AutomationContentDescriptor {
    public string Id { get; init; } = "";
    public string Name { get; init; } = "";
    public bool IsFolder { get; init; }
    public string? ExtensionType { get; init; }
}

public sealed class ModelDiscoveryResult {
    public string HubId { get; init; } = "";
    public string HubName { get; init; } = "";
    public string ProjectId { get; init; } = "";
    public string ProjectName { get; init; } = "";
    public string Region { get; init; } = "";
    public string ScopePath { get; init; } = "";
    public bool Recursive { get; init; }
    public string? NameContains { get; init; }
    public int ModelCount { get; init; }
    public string? ManifestPath { get; set; }
    public List<DiscoveredAutomationModel> Models { get; init; } = [];
}

public sealed class DiscoveredAutomationModel {
    public string HubId { get; init; } = "";
    public string HubName { get; init; } = "";
    public string ProjectId { get; init; } = "";
    public string ProjectName { get; init; } = "";
    public string Region { get; init; } = "";
    public string FolderPath { get; init; } = "";
    public string ItemId { get; init; } = "";
    public string VersionId { get; init; } = "";
    public string DisplayName { get; init; } = "";
    public string? SuggestedExpectedTitle { get; init; }
    public string ProjectGuid { get; init; } = "";
    public string ModelGuid { get; init; } = "";
}