using Newtonsoft.Json;
using System.IO;

namespace Pe.Dev.RevitAutomation;

public sealed class AutomationBrowseService {
    private readonly AutomationBrowseContextStore _contextStore = new();
    private readonly AutomationCacheStore _cacheStore = new();
    private readonly RevitAutomationModelDiscoveryService _discoveryService = new();

    public AutomationBrowseContext GetContext(string repoRoot) =>
        this._contextStore.Load(repoRoot);

    public async Task<AutomationHubCatalogResult> GetHubsAsync(
        string repoRoot,
        bool refresh,
        Action<string>? log,
        CancellationToken cancellationToken
    ) {
        if (!refresh && this._cacheStore.TryReadHubs(repoRoot, out var cached))
            return cached;

        var result = await this._discoveryService.ListHubsAsync(log, cancellationToken).ConfigureAwait(false);
        this._cacheStore.WriteHubs(repoRoot, result);
        return result;
    }

    public async Task<AutomationBrowseContext> UseHubAsync(
        string repoRoot,
        string selector,
        bool refresh,
        Action<string>? log,
        CancellationToken cancellationToken
    ) {
        var hubs = await this.GetHubsAsync(repoRoot, refresh, log, cancellationToken).ConfigureAwait(false);
        var hub = ResolveSelector(
            hubs.Hubs,
            selector,
            hub => hub.Name,
            hub => hub.Id,
            "hub"
        );

        var context = new AutomationBrowseContext {
            HubId = hub.Id,
            HubName = hub.Name,
            ScopePath = ""
        };
        this._contextStore.Save(repoRoot, context);
        return context;
    }

    public async Task<AutomationProjectCatalogResult> GetProjectsAsync(
        string repoRoot,
        bool refresh,
        Action<string>? log,
        CancellationToken cancellationToken
    ) {
        var context = this.RequireHubContext(repoRoot);
        if (!refresh && this._cacheStore.TryReadProjects(repoRoot, context.HubId!, out var cached))
            return cached;

        var result = await this._discoveryService.ListProjectsAsync(
                new AutomationListProjectsOptions(context.HubId!),
                log,
                cancellationToken
            )
            .ConfigureAwait(false);
        this._cacheStore.WriteProjects(repoRoot, context.HubId!, result);
        return result;
    }

    public async Task<AutomationBrowseContext> UseProjectAsync(
        string repoRoot,
        string selector,
        bool refresh,
        Action<string>? log,
        CancellationToken cancellationToken
    ) {
        var context = this.RequireHubContext(repoRoot);
        var projects = await this.GetProjectsAsync(repoRoot, refresh, log, cancellationToken).ConfigureAwait(false);
        var project = ResolveSelector(
            projects.Projects,
            selector,
            entry => entry.Name,
            entry => entry.Id,
            "project"
        );

        var updatedContext = new AutomationBrowseContext {
            HubId = context.HubId,
            HubName = context.HubName,
            ProjectId = project.Id,
            ProjectName = project.Name,
            ScopePath = ""
        };
        this._contextStore.Save(repoRoot, updatedContext);
        return updatedContext;
    }

    public string GetWorkingPath(string repoRoot) =>
        NormalizeScopePath(this.GetContext(repoRoot).ScopePath);

    public async Task<AutomationContentCatalogResult> ListContentsAsync(
        string repoRoot,
        string? scopePathOverride,
        bool refresh,
        Action<string>? log,
        CancellationToken cancellationToken
    ) {
        var context = this.RequireProjectContext(repoRoot);
        var scopePath = NormalizeScopePath(scopePathOverride ?? context.ScopePath);
        if (!refresh && this._cacheStore.TryReadContents(repoRoot, context.ProjectId!, scopePath, out var cached))
            return cached;

        var result = await this._discoveryService.ListContentsAsync(
                new AutomationListContentsOptions(
                    context.HubId!,
                    context.ProjectId!,
                    null,
                    string.IsNullOrWhiteSpace(scopePath) ? null : scopePath
                ),
                log,
                cancellationToken
            )
            .ConfigureAwait(false);
        this._cacheStore.WriteContents(repoRoot, context.ProjectId!, scopePath, result);
        return result;
    }

    public async Task<AutomationBrowseContext> ChangeDirectoryAsync(
        string repoRoot,
        string segment,
        bool refresh,
        Action<string>? log,
        CancellationToken cancellationToken
    ) {
        var context = this.RequireProjectContext(repoRoot);
        var nextPath = segment switch {
            ".." => TrimLastSegment(context.ScopePath),
            "/" => "",
            _ => CombineScopePath(context.ScopePath, segment)
        };

        _ = await this.ListContentsAsync(repoRoot, nextPath, refresh, log, cancellationToken).ConfigureAwait(false);
        var updated = new AutomationBrowseContext {
            HubId = context.HubId,
            HubName = context.HubName,
            ProjectId = context.ProjectId,
            ProjectName = context.ProjectName,
            ScopePath = NormalizeScopePath(nextPath)
        };
        this._contextStore.Save(repoRoot, updated);
        return updated;
    }

    public AutomationBrowseContext MoveUp(string repoRoot) {
        var context = this.RequireProjectContext(repoRoot);
        var updated = new AutomationBrowseContext {
            HubId = context.HubId,
            HubName = context.HubName,
            ProjectId = context.ProjectId,
            ProjectName = context.ProjectName,
            ScopePath = TrimLastSegment(context.ScopePath)
        };
        this._contextStore.Save(repoRoot, updated);
        return updated;
    }

    public async Task<AutomationModelInventoryResult> ListModelsAsync(
        string repoRoot,
        string? nameContains,
        bool recurse,
        bool refresh,
        string? outPath,
        Action<string>? log,
        CancellationToken cancellationToken
    ) {
        var context = this.RequireProjectContext(repoRoot);
        var inventory = await this.GetInventoryAsync(
                repoRoot,
                context.HubId!,
                context.HubName!,
                context.ProjectId!,
                context.ProjectName!,
                NormalizeScopePath(context.ScopePath),
                recurse,
                refresh,
                log,
                cancellationToken
            )
            .ConfigureAwait(false);

        if (!string.IsNullOrWhiteSpace(nameContains)) {
            inventory = new AutomationModelInventoryResult {
                GeneratedAtUtc = inventory.GeneratedAtUtc,
                HubName = inventory.HubName,
                ProjectName = inventory.ProjectName,
                Region = inventory.Region,
                ScopePath = inventory.ScopePath,
                Recursive = inventory.Recursive,
                Models = inventory.Models
                    .Where(model =>
                        model.ModelPath.Contains(nameContains, StringComparison.OrdinalIgnoreCase) ||
                        model.ModelTitle.Contains(nameContains, StringComparison.OrdinalIgnoreCase))
                    .ToList()
            };
        }

        if (!string.IsNullOrWhiteSpace(outPath)) {
            var fullPath = Path.GetFullPath(
                Path.IsPathRooted(outPath) ? outPath : Path.Combine(repoRoot, outPath)
            );
            var directory = Path.GetDirectoryName(fullPath);
            if (!string.IsNullOrWhiteSpace(directory))
                Directory.CreateDirectory(directory);

            File.WriteAllText(fullPath, JsonConvert.SerializeObject(inventory, Formatting.Indented));
        }

        return inventory;
    }

    public async Task<ModelResolutionResult> ResolveModelAsync(
        string repoRoot,
        string hubName,
        string projectName,
        string modelPath,
        bool refresh,
        Action<string>? log,
        CancellationToken cancellationToken
    ) {
        var hubs = await this.GetHubsAsync(repoRoot, refresh, log, cancellationToken).ConfigureAwait(false);
        var hub = ResolveSelector(hubs.Hubs, hubName, item => item.Name, item => item.Id, "hub");
        var projects = await this.GetProjectsByHubAsync(repoRoot, hub.Id, refresh, log, cancellationToken).ConfigureAwait(false);
        var project = ResolveSelector(projects.Projects, projectName, item => item.Name, item => item.Id, "project");

        var canonicalPath = CanonicalizeModelPath(modelPath);
        var folderPath = GetFolderPathFromModelPath(canonicalPath);
        var inventory = await this.GetInventoryAsync(
                repoRoot,
                hub.Id,
                hub.Name,
                project.Id,
                project.Name,
                folderPath,
                false,
                refresh,
                log,
                cancellationToken
            )
            .ConfigureAwait(false);

        var matches = inventory.Models
            .Where(model => string.Equals(model.ModelPath, canonicalPath, StringComparison.OrdinalIgnoreCase))
            .ToArray();

        return matches.Length switch {
            1 => matches[0],
            0 => throw new InvalidOperationException(
                $"Could not resolve model path '{canonicalPath}' inside project '{project.Name}'."
            ),
            _ => throw new InvalidOperationException(
                $"Model path '{canonicalPath}' in project '{project.Name}' resolved to multiple models."
            )
        };
    }

    public AutomationCacheStatus GetCacheStatus(string repoRoot) =>
        this._cacheStore.GetStatus(repoRoot);

    public void ClearCache(string repoRoot, AutomationCacheScope scope) =>
        this._cacheStore.Clear(repoRoot, scope);

    private async Task<AutomationProjectCatalogResult> GetProjectsByHubAsync(
        string repoRoot,
        string hubId,
        bool refresh,
        Action<string>? log,
        CancellationToken cancellationToken
    ) {
        if (!refresh && this._cacheStore.TryReadProjects(repoRoot, hubId, out var cached))
            return cached;

        var result = await this._discoveryService.ListProjectsAsync(
                new AutomationListProjectsOptions(hubId),
                log,
                cancellationToken
            )
            .ConfigureAwait(false);
        this._cacheStore.WriteProjects(repoRoot, hubId, result);
        return result;
    }

    private async Task<AutomationModelInventoryResult> GetInventoryAsync(
        string repoRoot,
        string hubId,
        string hubName,
        string projectId,
        string projectName,
        string scopePath,
        bool recurse,
        bool refresh,
        Action<string>? log,
        CancellationToken cancellationToken
    ) {
        if (!refresh && this._cacheStore.TryReadModels(repoRoot, projectId, scopePath, recurse, out var cached))
            return cached;

        var result = await this._discoveryService.DiscoverModelsAsync(
                new ModelDiscoveryOptions(
                    hubId,
                    projectId,
                    null,
                    string.IsNullOrWhiteSpace(scopePath) ? null : scopePath,
                    null,
                    recurse,
                    [],
                    null,
                    null,
                    ParameterCollectionOptions.DefaultEngine,
                    null,
                    ScheduleCollectionOptions.DefaultTimeoutSeconds,
                    1,
                    true,
                    true,
                    null
                ),
                repoRoot,
                log,
                cancellationToken
            )
            .ConfigureAwait(false);

        var inventory = new AutomationModelInventoryResult {
            GeneratedAtUtc = DateTime.UtcNow,
            HubName = hubName,
            ProjectName = projectName,
            Region = result.Region,
            ScopePath = NormalizeScopePath(scopePath),
            Recursive = recurse,
            Models = result.Models.Select(model => new ModelResolutionResult {
                HubId = model.HubId,
                HubName = model.HubName,
                ProjectId = model.ProjectId,
                ProjectName = model.ProjectName,
                Region = model.Region,
                RevitYear = model.RevitYear,
                ItemId = model.ItemId,
                VersionId = model.VersionId,
                ProjectGuid = model.ProjectGuid,
                ModelGuid = model.ModelGuid,
                ModelTitle = RevitAutomationModelDiscoveryService.BuildSuggestedExpectedTitle(model.DisplayName) ?? model.DisplayName,
                FolderPath = model.FolderPath,
                ModelPath = BuildCanonicalModelPath(model.FolderPath, model.DisplayName),
                ResolutionSource = "live"
            }).ToList()
        };

        this._cacheStore.WriteModels(repoRoot, projectId, scopePath, recurse, inventory);
        return inventory;
    }

    private AutomationBrowseContext RequireHubContext(string repoRoot) {
        var context = this.GetContext(repoRoot);
        if (string.IsNullOrWhiteSpace(context.HubId) || string.IsNullOrWhiteSpace(context.HubName))
            throw new InvalidOperationException("No hub is selected. Run `pe-dev revit automation browse use-hub ...` first.");

        return context;
    }

    private AutomationBrowseContext RequireProjectContext(string repoRoot) {
        var context = this.RequireHubContext(repoRoot);
        if (string.IsNullOrWhiteSpace(context.ProjectId) || string.IsNullOrWhiteSpace(context.ProjectName))
            throw new InvalidOperationException("No project is selected. Run `pe-dev revit automation browse use-project ...` first.");

        return context;
    }

    private static T ResolveSelector<T>(
        IReadOnlyCollection<T> candidates,
        string selector,
        Func<T, string> displayName,
        Func<T, string> id,
        string label
    ) {
        var normalized = selector.Trim();
        var exact = candidates
            .Where(candidate =>
                string.Equals(displayName(candidate), normalized, StringComparison.OrdinalIgnoreCase) ||
                string.Equals(id(candidate), normalized, StringComparison.OrdinalIgnoreCase))
            .ToArray();
        if (exact.Length == 1)
            return exact[0];
        if (exact.Length > 1)
            throw new InvalidOperationException($"Selector '{selector}' matched multiple {label}s exactly.");

        var fuzzy = candidates
            .Where(candidate => displayName(candidate).Contains(normalized, StringComparison.OrdinalIgnoreCase))
            .ToArray();
        return fuzzy.Length switch {
            1 => fuzzy[0],
            0 => throw new InvalidOperationException($"Could not resolve {label} selector '{selector}'."),
            _ => throw new InvalidOperationException($"Selector '{selector}' matched multiple {label}s.")
        };
    }

    internal static string BuildCanonicalModelPath(string folderPath, string displayName) {
        var title = RevitAutomationModelDiscoveryService.BuildSuggestedExpectedTitle(displayName) ?? displayName.Trim();
        return CanonicalizeModelPath(string.IsNullOrWhiteSpace(folderPath) ? title : $"{folderPath}/{title}");
    }

    internal static string CanonicalizeModelPath(string value) =>
        string.Join(
            "/",
            value
                .Split(['/', '\\'], StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
        );

    private static string NormalizeScopePath(string? value) =>
        string.IsNullOrWhiteSpace(value) ? "" : CanonicalizeModelPath(value);

    private static string CombineScopePath(string current, string segment) {
        var normalizedSegment = NormalizeScopePath(segment);
        if (string.IsNullOrWhiteSpace(current))
            return normalizedSegment;
        if (string.IsNullOrWhiteSpace(normalizedSegment))
            return NormalizeScopePath(current);
        if (segment.StartsWith("/", StringComparison.Ordinal) || segment.StartsWith("\\", StringComparison.Ordinal))
            return normalizedSegment;

        return NormalizeScopePath($"{current}/{normalizedSegment}");
    }

    private static string TrimLastSegment(string? scopePath) {
        var normalized = NormalizeScopePath(scopePath);
        if (string.IsNullOrWhiteSpace(normalized))
            return "";

        var segments = normalized.Split('/');
        return segments.Length <= 1 ? "" : string.Join("/", segments.Take(segments.Length - 1));
    }

    private static string GetFolderPathFromModelPath(string modelPath) {
        var canonical = CanonicalizeModelPath(modelPath);
        var lastSlash = canonical.LastIndexOf('/');
        return lastSlash <= 0
            ? throw new InvalidOperationException(
                $"Model path '{modelPath}' must include at least one folder segment and the model title.")
            : canonical[..lastSlash];
    }
}
