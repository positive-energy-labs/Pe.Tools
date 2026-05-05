using Newtonsoft.Json;
using System.IO;

namespace Pe.Dev.RevitAutomation;

public sealed class AutomationManifestService {
    private readonly AutomationBrowseService _browseService = new();
    private readonly AutomationBrowseContextStore _contextStore = new();
    private readonly AutomationProcessingRouteService _routeService = new();

    public ScheduleAuditManifest Create(string repoRoot, string manifestPath) {
        var context = this._contextStore.Load(repoRoot);
        if (string.IsNullOrWhiteSpace(context.HubName))
            throw new InvalidOperationException(
                "No hub is selected. Run `pe-dev revit automation browse use-hub ...` before creating a manifest."
            );

        var manifest = new ScheduleAuditManifest {
            Hub = context.HubName,
            Request = ScheduleCollectionBatchRequest.FromContract(ScheduleCollectionDefaults.CreateDefaultRequest()),
            Models = []
        };
        Save(repoRoot, manifestPath, manifest);
        return manifest;
    }

    public ScheduleAuditManifest Load(string repoRoot, string manifestPath) {
        var fullPath = ResolvePath(repoRoot, manifestPath);
        return ScheduleAuditManifest.LoadFromFile(fullPath);
    }

    public ScheduleAuditManifest AddModel(
        string repoRoot,
        string manifestPath,
        string project,
        string modelPath,
        bool refresh,
        Action<string>? log,
        CancellationToken cancellationToken
    ) {
        var fullPath = ResolvePath(repoRoot, manifestPath);
        var manifest = ScheduleAuditManifest.LoadFromFile(fullPath);
        _ = this._browseService.ResolveModelAsync(
            repoRoot,
            manifest.Hub,
            project,
            modelPath,
            refresh,
            log,
            cancellationToken
        ).GetAwaiter().GetResult();

        var canonicalModelPath = AutomationBrowseService.CanonicalizeModelPath(modelPath);
        if (manifest.Models.Any(entry =>
                string.Equals(entry.Project, project, StringComparison.OrdinalIgnoreCase) &&
                string.Equals(entry.ModelPath, canonicalModelPath, StringComparison.OrdinalIgnoreCase))) {
            throw new InvalidOperationException(
                $"Manifest already contains project '{project}' modelPath '{canonicalModelPath}'.");
        }

        var updated = new ScheduleAuditManifest {
            Hub = manifest.Hub,
            TimeoutSeconds = manifest.TimeoutSeconds,
            Debug = manifest.Debug,
            Mask = manifest.Mask,
            Request = manifest.Request,
            Models = [
                .. manifest.Models,
                new ScheduleAuditManifestEntry {
                    Project = project,
                    ModelPath = canonicalModelPath
                }
            ]
        };
        Save(repoRoot, manifestPath, updated);
        return updated;
    }

    public ScheduleAuditManifest RemoveModel(string repoRoot, string manifestPath, string modelPath) {
        var manifest = this.Load(repoRoot, manifestPath);
        var canonical = AutomationBrowseService.CanonicalizeModelPath(modelPath);
        var matches = manifest.Models
            .Where(entry => string.Equals(entry.ModelPath, canonical, StringComparison.OrdinalIgnoreCase))
            .ToArray();
        if (matches.Length == 0)
            throw new InvalidOperationException($"Manifest does not contain modelPath '{canonical}'.");
        if (matches.Length > 1)
            throw new InvalidOperationException(
                $"Manifest contains multiple entries for modelPath '{canonical}'. Remove manually or use a more specific workflow.");

        var updated = new ScheduleAuditManifest {
            Hub = manifest.Hub,
            TimeoutSeconds = manifest.TimeoutSeconds,
            Debug = manifest.Debug,
            Mask = manifest.Mask,
            Request = manifest.Request,
            Models = manifest.Models
                .Where(entry => !ReferenceEquals(entry, matches[0]))
                .ToList()
        };
        Save(repoRoot, manifestPath, updated);
        return updated;
    }

    public ScheduleAuditManifest SetRequest(
        string repoRoot,
        string manifestPath,
        ScheduleCollectionBatchRequest request
    ) {
        var manifest = this.Load(repoRoot, manifestPath);
        var updated = new ScheduleAuditManifest {
            Hub = manifest.Hub,
            TimeoutSeconds = manifest.TimeoutSeconds,
            Debug = manifest.Debug,
            Mask = manifest.Mask,
            Request = request,
            Models = manifest.Models.ToList()
        };
        Save(repoRoot, manifestPath, updated);
        return updated;
    }

    public async Task<AutomationManifestValidationResult> ValidateAsync(
        string repoRoot,
        string manifestPath,
        bool refresh,
        Action<string>? log,
        CancellationToken cancellationToken
    ) {
        var manifest = this.Load(repoRoot, manifestPath);
        var entries = new List<AutomationManifestValidationEntry>();
        foreach (var model in manifest.Models) {
            try {
                var resolved = await this._browseService.ResolveModelAsync(
                        repoRoot,
                        manifest.Hub,
                        model.Project,
                        model.ModelPath,
                        refresh,
                        log,
                        cancellationToken
                    )
                    .ConfigureAwait(false);
                var route = this._routeService.ResolveRoute(model, resolved);
                entries.Add(new AutomationManifestValidationEntry {
                    Project = model.Project,
                    ModelPath = model.ModelPath,
                    SourceRevitYear = route.SourceRevitYear,
                    ExecutionRevitYear = route.ExecutionRevitYear,
                    YearResolutionSource = route.YearResolutionSource,
                    ProcessingMode = route.ProcessingMode,
                    FallbackReason = route.FallbackReason,
                    IsValid = true,
                    ResolvedModel = resolved
                });
            } catch (Exception ex) {
                entries.Add(new AutomationManifestValidationEntry {
                    Project = model.Project,
                    ModelPath = model.ModelPath,
                    IsValid = false,
                    FailureMessage = ex.Message
                });
            }
        }

        return new AutomationManifestValidationResult {
            ManifestPath = ResolvePath(repoRoot, manifestPath),
            Entries = entries
        };
    }

    public static string ResolvePath(string repoRoot, string path) =>
        Path.GetFullPath(Path.IsPathRooted(path) ? path : Path.Combine(repoRoot, path));

    public static void Save(string repoRoot, string manifestPath, ScheduleAuditManifest manifest) {
        var fullPath = ResolvePath(repoRoot, manifestPath);
        var directory = Path.GetDirectoryName(fullPath);
        if (!string.IsNullOrWhiteSpace(directory))
            Directory.CreateDirectory(directory);

        File.WriteAllText(fullPath, JsonConvert.SerializeObject(manifest, Formatting.Indented));
    }
}
