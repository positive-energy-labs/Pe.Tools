using Pe.Shared.ApsAuth;
using Newtonsoft.Json;
using Pe.Aps.Auth;
using Pe.Aps.DataManagement;
using Pe.Shared.RevitData;
using Pe.Shared.RevitVersions;
using System.IO;

namespace Pe.Dev.RevitAutomation;

public sealed class RevitAutomationModelDiscoveryService {
    public async Task<AutomationHubCatalogResult> ListHubsAsync(
        Action<string>? log,
        CancellationToken cancellationToken
    ) {
        var catalog = CreateCloudModelCatalog(log);
        var hubs = await catalog.ListHubsAsync(cancellationToken).ConfigureAwait(false);
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
        var catalog = CreateCloudModelCatalog(log);
        var projects = await catalog.ListProjectsAsync(options.HubId, cancellationToken).ConfigureAwait(false);
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
        var catalog = CreateCloudModelCatalog(log);
        var result = await catalog.ListContentsAsync(
                new ApsCloudContentScope(options.HubId, options.ProjectId, options.FolderId, options.FolderPath),
                cancellationToken
            )
            .ConfigureAwait(false);

        return new AutomationContentCatalogResult {
            HubId = result.HubId,
            ProjectId = result.ProjectId,
            ScopeName = result.ScopeName,
            Entries = result.Entries
                .Select(entry => new AutomationContentDescriptor {
                    Id = entry.Id,
                    Name = entry.Name,
                    IsFolder = entry.IsFolder,
                    ExtensionType = entry.ExtensionType
                })
                .ToList()
        };
    }

    public async Task<ModelDiscoveryResult> DiscoverModelsAsync(
        ModelDiscoveryOptions options,
        string? repoRootOverride,
        Action<string>? log,
        CancellationToken cancellationToken
    ) {
        var catalog = CreateCloudModelCatalog(log);
        var discovery = await catalog.DiscoverModelsAsync(
                new ApsCloudModelDiscoveryRequest(
                    options.HubId,
                    options.ProjectId,
                    options.FolderId,
                    options.FolderPath,
                    options.NameContains,
                    options.Recurse,
                    options.ExcludePathGlobs,
                    options.RegionOverride
                ),
                log,
                cancellationToken
            )
            .ConfigureAwait(false);

        var discoveredModels = discovery.Models
            .Select(model => new DiscoveredAutomationModel {
                HubId = model.HubId,
                HubName = model.HubName,
                ProjectId = model.ProjectId,
                ProjectName = model.ProjectName,
                Region = model.Region,
                FolderPath = model.FolderPath,
                ItemId = model.ItemId,
                VersionId = model.VersionId,
                DisplayName = model.DisplayName,
                SuggestedExpectedTitle = BuildSuggestedExpectedTitle(model.DisplayName),
                ProjectGuid = model.ProjectGuid,
                ModelGuid = model.ModelGuid,
                RevitYear = model.RevitProjectVersion
            })
            .ToList();

        var result = new ModelDiscoveryResult {
            HubId = discovery.Hub.Id,
            HubName = discovery.Hub.Name,
            ProjectId = discovery.Project.Id,
            ProjectName = discovery.Project.Name,
            Region = discovery.Region,
            ScopePath = discovery.ScopePath,
            Recursive = discovery.Recursive,
            NameContains = discovery.NameContains,
            ModelCount = discoveredModels.Count,
            Models = discoveredModels
        };

        if (!string.IsNullOrWhiteSpace(options.OutManifestPath)) {
            var repoRoot = RepoRootResolver.Resolve(repoRootOverride);
            result.ManifestPath = WriteManifest(repoRoot, options.OutManifestPath, discoveredModels, discovery.Region, options);
        }

        return result;
    }

    private static ApsCloudModelCatalog CreateCloudModelCatalog(Action<string>? log) {
        var aps = RevitAutomationApsCredentials.CreateAps();
        log?.Invoke("Auth: acquiring data-management token");
        _ = aps.GetTokenResult(ApsTokenRequest.ForParameterService());
        return aps.CloudModels();
    }

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
            TimeoutSeconds = options.TimeoutSeconds,
            MaxConcurrency = options.MaxConcurrency,
            Debug = options.Debug,
            Mask = options.Mask,
            Models = models.Select(model => new ParameterCollectionBatchEntry {
                Region = region,
                ProjectGuid = model.ProjectGuid,
                ModelGuid = model.ModelGuid,
                ExpectedTitle = model.SuggestedExpectedTitle,
                RevitYear = ResolveManifestRevitYear(model, options.FallbackRevitYear),
                Filter = options.Filter
            }).ToList()
        };

        File.WriteAllText(fullPath, JsonConvert.SerializeObject(manifest, Formatting.Indented));
        return fullPath;
    }

    private static int ResolveManifestRevitYear(DiscoveredAutomationModel model, int? fallbackRevitYear) {
        if (model.RevitYear.HasValue) {
            _ = RevitVersionCatalog.RequireByYear(model.RevitYear.Value);
            if (fallbackRevitYear.HasValue && fallbackRevitYear.Value != model.RevitYear.Value)
                throw new InvalidDataException(
                    $"Discovered model '{model.DisplayName}' resolved revitYear '{model.RevitYear.Value}' which conflicts with fallback year '{fallbackRevitYear.Value}'.");

            return model.RevitYear.Value;
        }

        if (!fallbackRevitYear.HasValue)
            throw new InvalidDataException(
                $"Discovered model '{model.DisplayName}' did not include APS revitProjectVersion metadata. Pass --fallback-revit-year.");

        _ = RevitVersionCatalog.RequireByYear(fallbackRevitYear.Value);
        return fallbackRevitYear.Value;
    }

    internal static string? BuildSuggestedExpectedTitle(string? displayName) {
        if (string.IsNullOrWhiteSpace(displayName))
            return null;

        var fileName = displayName.Trim();
        return fileName.EndsWith(".rvt", StringComparison.OrdinalIgnoreCase)
            ? fileName[..^4]
            : fileName;
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
    int? FallbackRevitYear,
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
    public int? RevitYear { get; init; }
}
