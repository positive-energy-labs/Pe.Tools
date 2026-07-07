using Pe.Revit.DocumentData.Families.Extraction;
using Pe.Revit.DocumentData.Parameters;
using Pe.Revit.DocumentData.ProjectBrowser;
using Pe.Revit.Extensions.ProjDocument;
using Pe.Shared.RevitData;
using Pe.Shared.RevitData.Families;
using Serilog;
using System.Collections.Concurrent;
using RevitDocument = Autodesk.Revit.DB.Document;

namespace Pe.Revit.Global.Services.Host;

/// <summary>
///     Per-document cache of collected Revit data, evicted with element granularity from the
///     DocumentChanged pipeline (BridgeDocumentNotifier). Replaces the TTL/blanket-invalidation
///     RevitDataCollectionContext.
///     <para>
///         Keyed by <see cref="DocumentIdentityExtensions.GetDocumentKey" />, NOT the Document reference:
///         Revit hands back a fresh managed <c>Document</c> wrapper on every <c>ActiveUIDocument.Document</c>
///         access (verified live — two reads in one request are not reference-equal), so a
///         ConditionalWeakTable keyed on the wrapper mints a new empty shadow per request and the cache
///         never survives a request boundary. The stable string key is the same identity the rest of the
///         host uses (session summaries, FamilySnapshotStore). Shadows are dropped explicitly when their
///         document closes (<see cref="Evict" /> from BridgeDocumentNotifier's DocumentClosing handler) so a
///         reopen re-validates through the warm-start layer instead of reusing stale in-memory truth.
///     </para>
///     <para>
///         Eviction policy: stale beats slow, never the reverse. Family snapshots evict on Family or
///         FamilySymbol changes (family-doc truth is untouched by instance placement). Deletions and
///         unresolvable ids evict conservatively. Oversized deltas clear everything.
///     </para>
/// </summary>
internal sealed class DocShadow : IProjectBrowserIndexProvider, IFamilySnapshotCache {
    private const int MaxProjectBrowserEntries = 16;
    private const int OversizedDeltaThreshold = 512;
    private static readonly ConcurrentDictionary<string, DocShadow> Shadows = new(StringComparer.OrdinalIgnoreCase);

    private readonly object _sync = new();
    private readonly Dictionary<long, FamilySnapshotRecord> _familySnapshots = new();
    private readonly Dictionary<ProjectBrowserShadowKey, ProjectBrowserShadowEntry> _projectBrowserIndexes = new();
    private ParameterEvidencePrimitiveSet? _parameterEvidencePrimitives;

    public static DocShadow For(RevitDocument document) =>
        Shadows.GetOrAdd(document.GetDocumentKey(), _ => new DocShadow());

    /// <summary>Routes a DocumentChanged delta to the changed document's shadow, if one exists.</summary>
    public static void HandleChange(RevitDocument document, DocumentDelta delta) {
        if (Shadows.TryGetValue(document.GetDocumentKey(), out var shadow))
            shadow.Apply(delta, id => ClassifyElement(document, id));
    }

    /// <summary>Drops a closed document's shadow so a later reopen cannot reuse stale in-memory truth.</summary>
    public static void Evict(RevitDocument document) {
        if (Shadows.TryRemove(document.GetDocumentKey(), out _))
            Log.Debug("DocShadow evicted on close: Document={DocumentKey}", document.GetDocumentKey());
    }

    // ==================== IFamilySnapshotCache ====================

    public bool TryGet(long familyId, out FamilySnapshotRecord record) {
        lock (this._sync) {
#pragma warning disable CS8601 // TryGetValue's false path leaves record default; callers gate on the bool.
            return this._familySnapshots.TryGetValue(familyId, out record);
#pragma warning restore CS8601
        }
    }

    public void Store(FamilySnapshotRecord record) {
        if (record.IsPartial)
            return;

        lock (this._sync)
            this._familySnapshots[record.FamilyId] = record;
    }

    /// <summary>Point-in-time copy of the cached family snapshots (for save-boundary persistence).</summary>
    public IReadOnlyList<FamilySnapshotRecord> SnapshotFamilies() {
        lock (this._sync)
            return this._familySnapshots.Values.ToList();
    }

    // ==================== IProjectBrowserIndexProvider ====================

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

        var key = ProjectBrowserShadowKey.Create(sections, maxSamples, view);
        lock (this._sync) {
            if (this._projectBrowserIndexes.TryGetValue(key, out var entry)) {
                issues.AddRange(entry.Issues);
                return entry.Index;
            }
        }

        var collectedIssues = new List<RevitDataIssue>();
        var index = ProjectBrowserCollector.CollectIndex(document, sections, maxSamples, view, null, collectedIssues);
        issues.AddRange(collectedIssues);
        lock (this._sync) {
            this._projectBrowserIndexes[key] = new ProjectBrowserShadowEntry(index, collectedIssues, DateTimeOffset.UtcNow);
            while (this._projectBrowserIndexes.Count > MaxProjectBrowserEntries) {
                var oldest = this._projectBrowserIndexes.OrderBy(pair => pair.Value.CreatedAt).First();
                _ = this._projectBrowserIndexes.Remove(oldest.Key);
            }
        }

        return index;
    }

    // ==================== Parameter evidence primitives ====================

    public ParameterEvidencePrimitiveSet GetParameterEvidencePrimitives(RevitDocument document, bool useCache) {
        if (useCache) {
            lock (this._sync) {
                if (this._parameterEvidencePrimitives != null)
                    return this._parameterEvidencePrimitives with { CacheHit = true };
            }
        }

        var primitives = ParameterEvidenceCollector.CollectPrimitives(document);
        lock (this._sync)
            this._parameterEvidencePrimitives = primitives;

        return primitives;
    }

    // ==================== Eviction ====================

    internal void Apply(DocumentDelta delta, Func<long, DeltaImpact> classify) {
        var totalIds = delta.Added.Count + delta.Modified.Count + delta.Deleted.Count;
        if (totalIds == 0)
            return;

        if (totalIds > OversizedDeltaThreshold) {
            this.Clear($"oversized delta ({totalIds} ids)");
            return;
        }

        var familyEvictions = new HashSet<long>();
        var browserDirty = false;
        var evidenceDirty = false;

        foreach (var id in delta.Added.Concat(delta.Modified)) {
            var impact = classify(id);
            if (impact.EvictFamilyId is { } familyId)
                _ = familyEvictions.Add(familyId);
            browserDirty |= impact.AffectsBrowserStructure;
            evidenceDirty |= impact.AffectsParameterEvidence;
        }

        // Deleted ids no longer resolve. A deleted element that WAS a cached family matches by id;
        // everything else about a deletion is unknowable, so browser/evidence evict conservatively.
        if (delta.Deleted.Count > 0) {
            browserDirty = true;
            evidenceDirty = true;
        }

        lock (this._sync) {
            foreach (var deletedId in delta.Deleted) {
                if (this._familySnapshots.Remove(deletedId))
                    _ = familyEvictions.Add(deletedId);
            }

            foreach (var familyId in familyEvictions)
                _ = this._familySnapshots.Remove(familyId);

            if (browserDirty)
                this._projectBrowserIndexes.Clear();
            if (evidenceDirty)
                this._parameterEvidencePrimitives = null;
        }

        if (familyEvictions.Count > 0 || browserDirty || evidenceDirty) {
            Log.Debug(
                "DocShadow eviction: FamilyEvictions={FamilyEvictions}, BrowserCleared={BrowserCleared}, EvidenceCleared={EvidenceCleared}, DeltaIds={DeltaIds}, Transactions={Transactions}",
                familyEvictions.Count,
                browserDirty,
                evidenceDirty,
                totalIds,
                string.Join("|", delta.TransactionNames)
            );
        }
    }

    internal void Clear(string reason) {
        lock (this._sync) {
            var familyCount = this._familySnapshots.Count;
            var browserCount = this._projectBrowserIndexes.Count;
            this._familySnapshots.Clear();
            this._projectBrowserIndexes.Clear();
            this._parameterEvidencePrimitives = null;
            Log.Debug(
                "DocShadow cleared: Reason={Reason}, RemovedFamilySnapshots={RemovedFamilySnapshots}, RemovedProjectBrowserIndexes={RemovedProjectBrowserIndexes}",
                reason,
                familyCount,
                browserCount
            );
        }
    }

    internal int CachedFamilyCount {
        get {
            lock (this._sync)
                return this._familySnapshots.Count;
        }
    }

    internal bool HasParameterEvidencePrimitives {
        get {
            lock (this._sync)
                return this._parameterEvidencePrimitives != null;
        }
    }

    internal int CachedProjectBrowserIndexCount {
        get {
            lock (this._sync)
                return this._projectBrowserIndexes.Count;
        }
    }

    private static DeltaImpact ClassifyElement(RevitDocument document, long id) {
        var element = ScheduleFreeGet(document, id);
        return element switch {
            Family family => new DeltaImpact(family.Id.Value(), false, false),
            FamilySymbol symbol => new DeltaImpact(symbol.Family?.Id.Value(), false, false),
            ViewSchedule => new DeltaImpact(null, true, true), // schedule fields feed evidence; schedules list feeds browser
            View or Level => new DeltaImpact(null, true, false),
            ParameterElement => new DeltaImpact(null, false, true),
            null => new DeltaImpact(null, true, true), // unresolvable: conservative
            _ => DeltaImpact.None
        };
    }

    private static Element? ScheduleFreeGet(RevitDocument document, long id) {
        try {
            return document.GetElement(id.ToElementId());
        } catch {
            return null;
        }
    }
}

/// <summary>Element-id payload of one DocumentChanged event.</summary>
internal sealed record DocumentDelta(
    IReadOnlyList<long> Added,
    IReadOnlyList<long> Modified,
    IReadOnlyList<long> Deleted,
    IReadOnlyList<string> TransactionNames
);

/// <summary>What one changed element implies for the shadow's sections.</summary>
internal readonly record struct DeltaImpact(
    long? EvictFamilyId,
    bool AffectsBrowserStructure,
    bool AffectsParameterEvidence
) {
    public static readonly DeltaImpact None = new(null, false, false);
}

internal sealed record ProjectBrowserShadowKey(string Sections, int MaxSamples, ProjectBrowserResultView View) {
    public static ProjectBrowserShadowKey Create(
        IReadOnlyCollection<ProjectBrowserSection> sections,
        int maxSamples,
        ProjectBrowserResultView view
    ) => new(
        string.Join(",", sections.OrderBy(section => section.ToString()).Select(section => section.ToString())),
        maxSamples,
        view
    );
}

internal sealed record ProjectBrowserShadowEntry(
    ProjectBrowserCollectedIndex Index,
    List<RevitDataIssue> Issues,
    DateTimeOffset CreatedAt
);
