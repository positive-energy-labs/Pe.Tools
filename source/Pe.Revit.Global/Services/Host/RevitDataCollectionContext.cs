using Pe.Revit.DocumentData.ProjectBrowser;
using Pe.Shared.RevitData;
using Serilog;
using RevitDocument = Autodesk.Revit.DB.Document;

namespace Pe.Revit.Global.Services.Host;

internal sealed class RevitDataCollectionContext : IProjectBrowserIndexProvider {
    private const int MaxEntries = 16;
    private static readonly TimeSpan EntryTtl = TimeSpan.FromSeconds(30);
    private readonly Dictionary<ProjectBrowserIndexCacheKey, ProjectBrowserIndexCacheEntry> _projectBrowserIndexes = [];

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

    public void Invalidate(string reason) {
        lock (this._projectBrowserIndexes) {
            if (this._projectBrowserIndexes.Count == 0)
                return;

            var count = this._projectBrowserIndexes.Count;
            this._projectBrowserIndexes.Clear();
            Log.Debug(
                "Document data cache invalidated: Reason={Reason}, RemovedProjectBrowserIndexCount={RemovedProjectBrowserIndexCount}",
                reason,
                count
            );
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
