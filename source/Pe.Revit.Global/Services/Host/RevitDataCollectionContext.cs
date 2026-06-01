using Pe.Revit.DocumentData.Parameters;
using Pe.Revit.DocumentData.ProjectBrowser;
using Pe.Shared.RevitData;
using Serilog;
using RevitDocument = Autodesk.Revit.DB.Document;

namespace Pe.Revit.Global.Services.Host;

internal sealed class RevitDataCollectionContext : IProjectBrowserIndexProvider {
    private const int MaxEntries = 16;
    private static readonly TimeSpan EntryTtl = TimeSpan.FromSeconds(30);
    private readonly Dictionary<ProjectBrowserIndexCacheKey, ProjectBrowserIndexCacheEntry> _projectBrowserIndexes = [];
    private readonly Dictionary<ParameterEvidencePrimitiveCacheKey, ParameterEvidencePrimitiveCacheEntry> _parameterEvidencePrimitives = [];

    public ProjectBrowserCollectedIndex GetProjectBrowserIndex(
        RevitDocument document,
        IReadOnlyCollection<ProjectBrowserSection> sections,
        int maxSamples,
        ProjectBrowserResultView view,
        ProjectBrowserFilter? filter,
        List<RevitDataIssue> issues
    ) {
        if (filter != null)
            return ProjectBrowserCollector.CollectIndex(document, sections, maxSamples, view, filter, issues);

        var key = ProjectBrowserIndexCacheKey.Create(document, sections, maxSamples, view);
        lock (this._projectBrowserIndexes) {
            if (this._projectBrowserIndexes.TryGetValue(key, out var entry)) {
                var age = DateTimeOffset.UtcNow - entry.CreatedAt;
                if (age <= EntryTtl) {
                    issues.AddRange(entry.Issues);
                    Log.Debug(
                        "Document data cache hit: Primitive={Primitive}, DocumentKey={DocumentKey}, AgeMs={AgeMs}, Sections={Sections}, View={View}",
                        nameof(ProjectBrowserCollectedIndex),
                        key.DocumentKey,
                        age.TotalMilliseconds,
                        key.Sections,
                        key.View
                    );
                    return entry.Index;
                }

                this._projectBrowserIndexes.Remove(key);
            }
        }

        var collectedIssues = new List<RevitDataIssue>();
        var index = ProjectBrowserCollector.CollectIndex(document, sections, maxSamples, view, null, collectedIssues);
        issues.AddRange(collectedIssues);
        lock (this._projectBrowserIndexes) {
            this.PruneExpiredEntries();
            this._projectBrowserIndexes[key] = new ProjectBrowserIndexCacheEntry(index, collectedIssues, DateTimeOffset.UtcNow);
            this.PruneOldestEntries();
        }

        Log.Debug(
            "Document data cache miss: Primitive={Primitive}, DocumentKey={DocumentKey}, Sections={Sections}, View={View}",
            nameof(ProjectBrowserCollectedIndex),
            key.DocumentKey,
            key.Sections,
            key.View
        );
        return index;
    }

    public ParameterEvidencePrimitiveSet GetParameterEvidencePrimitives(
        RevitDocument document,
        bool useCache
    ) {
        var key = ParameterEvidencePrimitiveCacheKey.Create(document);
        if (useCache) {
            lock (this._parameterEvidencePrimitives) {
                if (this._parameterEvidencePrimitives.TryGetValue(key, out var entry)) {
                    var age = DateTimeOffset.UtcNow - entry.CreatedAt;
                    if (age <= EntryTtl) {
                        Log.Debug(
                            "Document data cache hit: Primitive={Primitive}, DocumentKey={DocumentKey}, AgeMs={AgeMs}",
                            nameof(ParameterEvidencePrimitiveSet),
                            key.DocumentKey,
                            age.TotalMilliseconds
                        );
                        return entry.Primitives with { CacheHit = true };
                    }

                    this._parameterEvidencePrimitives.Remove(key);
                }
            }
        }

        var primitives = ParameterEvidenceCollector.CollectPrimitives(document);
        lock (this._parameterEvidencePrimitives) {
            this.PruneExpiredParameterEvidenceEntries();
            this._parameterEvidencePrimitives[key] = new ParameterEvidencePrimitiveCacheEntry(primitives, DateTimeOffset.UtcNow);
            this.PruneOldestParameterEvidenceEntries();
        }

        Log.Debug(
            "Document data cache miss: Primitive={Primitive}, DocumentKey={DocumentKey}, ProjectBindingCount={ProjectBindingCount}, ScheduleFieldCount={ScheduleFieldCount}",
            nameof(ParameterEvidencePrimitiveSet),
            key.DocumentKey,
            primitives.ProjectBindings.Count,
            primitives.ScheduleFields.Count
        );
        return primitives;
    }

    public void Invalidate(string reason) {
        lock (this._projectBrowserIndexes) {
            lock (this._parameterEvidencePrimitives) {
                if (this._projectBrowserIndexes.Count == 0 && this._parameterEvidencePrimitives.Count == 0)
                    return;

                var projectBrowserCount = this._projectBrowserIndexes.Count;
                var parameterEvidenceCount = this._parameterEvidencePrimitives.Count;
                this._projectBrowserIndexes.Clear();
                this._parameterEvidencePrimitives.Clear();
                Log.Debug(
                    "Document data cache invalidated: Reason={Reason}, RemovedProjectBrowserIndexCount={RemovedProjectBrowserIndexCount}, RemovedParameterEvidencePrimitiveCount={RemovedParameterEvidencePrimitiveCount}",
                    reason,
                    projectBrowserCount,
                    parameterEvidenceCount
                );
            }
        }
    }

    private void PruneExpiredEntries() {
        var cutoff = DateTimeOffset.UtcNow - EntryTtl;
        foreach (var key in this._projectBrowserIndexes
                     .Where(entry => entry.Value.CreatedAt < cutoff)
                     .Select(entry => entry.Key)
                     .ToList()) {
            this._projectBrowserIndexes.Remove(key);
        }
    }

    private void PruneOldestEntries() {
        while (this._projectBrowserIndexes.Count > MaxEntries) {
            var oldest = this._projectBrowserIndexes
                .OrderBy(entry => entry.Value.CreatedAt)
                .First();
            this._projectBrowserIndexes.Remove(oldest.Key);
        }
    }

    private void PruneExpiredParameterEvidenceEntries() {
        var cutoff = DateTimeOffset.UtcNow - EntryTtl;
        foreach (var key in this._parameterEvidencePrimitives
                     .Where(entry => entry.Value.CreatedAt < cutoff)
                     .Select(entry => entry.Key)
                     .ToList()) {
            this._parameterEvidencePrimitives.Remove(key);
        }
    }

    private void PruneOldestParameterEvidenceEntries() {
        while (this._parameterEvidencePrimitives.Count > MaxEntries) {
            var oldest = this._parameterEvidencePrimitives
                .OrderBy(entry => entry.Value.CreatedAt)
                .First();
            this._parameterEvidencePrimitives.Remove(oldest.Key);
        }
    }
}

internal sealed record ProjectBrowserIndexCacheKey(
    string DocumentKey,
    string Sections,
    int MaxSamples,
    ProjectBrowserResultView View
) {
    public static ProjectBrowserIndexCacheKey Create(
        RevitDocument document,
        IReadOnlyCollection<ProjectBrowserSection> sections,
        int maxSamples,
        ProjectBrowserResultView view
    ) => new(
        document.GetDocumentKey(),
        string.Join(",", sections.OrderBy(section => section.ToString()).Select(section => section.ToString())),
        maxSamples,
        view
    );
}

internal sealed record ProjectBrowserIndexCacheEntry(
    ProjectBrowserCollectedIndex Index,
    List<RevitDataIssue> Issues,
    DateTimeOffset CreatedAt
);

internal sealed record ParameterEvidencePrimitiveCacheKey(string DocumentKey) {
    public static ParameterEvidencePrimitiveCacheKey Create(RevitDocument document) => new(document.GetDocumentKey());
}

internal sealed record ParameterEvidencePrimitiveCacheEntry(
    ParameterEvidencePrimitiveSet Primitives,
    DateTimeOffset CreatedAt
);
