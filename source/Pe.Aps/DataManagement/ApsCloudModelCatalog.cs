using Pe.Aps.Core;

namespace Pe.Aps.DataManagement;

public sealed class ApsCloudModelCatalog(DataManagementApiClient client) {
    public Task<IReadOnlyList<DataManagementHubEntry>> ListHubsAsync(CancellationToken cancellationToken) =>
        client.GetHubsAsync(cancellationToken);

    public Task<IReadOnlyList<DataManagementProjectEntry>> ListProjectsAsync(
        string hubId,
        CancellationToken cancellationToken
    ) =>
        client.GetProjectsAsync(hubId, cancellationToken);

    public async Task<ApsCloudContentCatalogResult> ListContentsAsync(
        ApsCloudContentScope scope,
        CancellationToken cancellationToken
    ) {
        var resolvedScope = await this.ResolveScopeAsync(scope, cancellationToken).ConfigureAwait(false);
        var entries = resolvedScope.FolderId == null
            ? await client.GetTopFoldersAsync(scope.HubId, scope.ProjectId, cancellationToken).ConfigureAwait(false)
            : await client.GetFolderContentsAsync(scope.ProjectId, resolvedScope.FolderId, cancellationToken)
                .ConfigureAwait(false);

        return new ApsCloudContentCatalogResult {
            HubId = scope.HubId,
            ProjectId = scope.ProjectId,
            ScopeName = resolvedScope.DisplayPath,
            Entries = entries
                .OrderByDescending(entry => entry.IsFolder)
                .ThenBy(entry => entry.Name, StringComparer.OrdinalIgnoreCase)
                .ToArray()
        };
    }

    public async Task<ApsCloudModelDiscoveryResult> DiscoverModelsAsync(
        ApsCloudModelDiscoveryRequest request,
        Action<string>? log,
        CancellationToken cancellationToken
    ) {
        var hubs = await client.GetHubsAsync(cancellationToken).ConfigureAwait(false);
        var hub = hubs.FirstOrDefault(candidate => string.Equals(candidate.Id, request.HubId, StringComparison.Ordinal))
                  ?? throw new InvalidOperationException(
                      $"Hub '{request.HubId}' was not found in the authenticated account.");
        var projects = await client.GetProjectsAsync(request.HubId, cancellationToken).ConfigureAwait(false);
        var project = projects.FirstOrDefault(candidate =>
                          string.Equals(candidate.Id, request.ProjectId, StringComparison.Ordinal))
                      ?? throw new InvalidOperationException(
                          $"Project '{request.ProjectId}' was not found in hub '{request.HubId}'.");

        var resolvedRegion = ResolveRegion(request.RegionOverride, hub.Region);
        var scope = await this.ResolveScopeAsync(
                new ApsCloudContentScope(request.HubId, request.ProjectId, request.FolderId, request.FolderPath),
                cancellationToken
            )
            .ConfigureAwait(false);
        var excludeMatcher = new ApsPathGlobMatcher(request.ExcludePathGlobs);

        var discoveredModels = new List<ApsDiscoveredCloudModel>();
        if (scope.FolderId == null) {
            var topFolders = await client.GetTopFoldersAsync(request.HubId, request.ProjectId, cancellationToken)
                .ConfigureAwait(false);
            foreach (var folder in topFolders.Where(entry => entry.IsFolder)) {
                await this.DiscoverFolderAsync(
                        request,
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
            await this.DiscoverFolderAsync(
                    request,
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

        return new ApsCloudModelDiscoveryResult {
            Hub = hub,
            Project = project,
            Region = resolvedRegion,
            ScopePath = scope.DisplayPath,
            Recursive = request.Recurse,
            NameContains = request.NameContains,
            Models = discoveredModels
                .OrderBy(model => model.FolderPath, StringComparer.OrdinalIgnoreCase)
                .ThenBy(model => model.DisplayName, StringComparer.OrdinalIgnoreCase)
                .ToArray()
        };
    }

    public Task DownloadVersionSourceAsync(
        string projectId,
        string versionId,
        string destinationPath,
        CancellationToken cancellationToken
    ) =>
        client.DownloadVersionSourceAsync(projectId, versionId, destinationPath, cancellationToken);

    private async Task<ResolvedApsFolderScope> ResolveScopeAsync(
        ApsCloudContentScope scope,
        CancellationToken cancellationToken
    ) {
        if (!string.IsNullOrWhiteSpace(scope.FolderId) && !string.IsNullOrWhiteSpace(scope.FolderPath))
            throw new ArgumentException("Pass either folder id or folder path, not both.");

        if (!string.IsNullOrWhiteSpace(scope.FolderId))
            return new ResolvedApsFolderScope { FolderId = scope.FolderId.Trim(), DisplayPath = scope.FolderId.Trim() };

        if (string.IsNullOrWhiteSpace(scope.FolderPath))
            return new ResolvedApsFolderScope { FolderId = null, DisplayPath = "(top folders)" };

        var segments = SplitFolderPath(scope.FolderPath);
        var topFolders = await client.GetTopFoldersAsync(scope.HubId, scope.ProjectId, cancellationToken)
            .ConfigureAwait(false);
        if (segments.Length == 0)
            return new ResolvedApsFolderScope { FolderId = null, DisplayPath = "(top folders)" };

        var first = topFolders.FirstOrDefault(folder => folder.IsFolder && MatchesName(folder.Name, segments[0]))
                    ?? throw BuildFolderResolutionFailure(scope.FolderPath, "(top folders)", topFolders);

        var currentFolder = first;
        var displaySegments = new List<string> { first.Name };
        for (var i = 1; i < segments.Length; i++) {
            var contents = await client.GetFolderContentsAsync(scope.ProjectId, currentFolder.Id, cancellationToken)
                .ConfigureAwait(false);
            currentFolder = contents.FirstOrDefault(folder => folder.IsFolder && MatchesName(folder.Name, segments[i]))
                            ?? throw BuildFolderResolutionFailure(scope.FolderPath, string.Join("/", displaySegments), contents);
            displaySegments.Add(currentFolder.Name);
        }

        return new ResolvedApsFolderScope { FolderId = currentFolder.Id, DisplayPath = string.Join("/", displaySegments) };
    }

    private async Task DiscoverFolderAsync(
        ApsCloudModelDiscoveryRequest request,
        string region,
        DataManagementHubEntry hub,
        DataManagementProjectEntry project,
        string folderId,
        string folderPath,
        ApsPathGlobMatcher excludeMatcher,
        List<ApsDiscoveredCloudModel> discoveredModels,
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
            if (!ShouldIncludeByName(item.Name, request.NameContains))
                continue;

            var itemPath = $"{folderPath}/{item.Name}";
            if (excludeMatcher.IsMatch(itemPath)) {
                log?.Invoke($"Discovery: skipping excluded path {itemPath}");
                continue;
            }

            var model = await TryReadModelAsync(project.Id, item, folderPath, region, hub, project, cancellationToken)
                .ConfigureAwait(false);
            if (model != null)
                discoveredModels.Add(model);
        }

        if (!request.Recurse)
            return;

        foreach (var childFolder in contents.Where(entry => entry.IsFolder)) {
            await this.DiscoverFolderAsync(
                    request,
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

    private async Task<ApsDiscoveredCloudModel?> TryReadModelAsync(
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

        return new ApsDiscoveredCloudModel {
            HubId = hub.Id,
            HubName = hub.Name,
            ProjectId = project.Id,
            ProjectName = project.Name,
            Region = region,
            FolderPath = folderPath,
            ItemId = item.Id,
            VersionId = latestModelVersion.Id,
            DisplayName = latestModelVersion.DisplayName,
            ProjectGuid = latestModelVersion.ProjectGuid!,
            ModelGuid = latestModelVersion.ModelGuid!,
            RevitProjectVersion = latestModelVersion.RevitProjectVersion
        };
    }

    private static string ResolveRegion(string? regionOverride, string? hubRegion) {
        if (!string.IsNullOrWhiteSpace(regionOverride))
            return NormalizeRegion(regionOverride);
        if (!string.IsNullOrWhiteSpace(hubRegion))
            return NormalizeRegion(hubRegion);

        throw new InvalidOperationException(
            "Could not determine region from the selected hub. Pass region explicitly."
        );
    }

    private static string NormalizeRegion(string region) =>
        region.Trim().ToUpperInvariant() switch {
            "EU" => "EMEA",
            "EMEA" => "EMEA",
            "US" => "US",
            var value => value
        };

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
}
