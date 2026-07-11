using Pe.Revit.Loader.Documents;
using Pe.Revit.Utils;
using Pe.Shared.RevitData;

namespace Pe.Revit.Global.Services.Host;

/// <summary>
///     Always-on cache upkeep driven by the SDK document tracker: DocShadow granular eviction and
///     close eviction, FamilySnapshotStore warm-start and save-boundary persistence. Wired once by
///     AppCore. Bridge-independent by design — this previously lived in the bridge notifier, so
///     caches were only maintained while the external bridge was connected.
/// </summary>
public static class DocumentCacheMaintenance {
    public static void Wire(IDocumentTracker documents) {
        // One filter for every tracker consumer: rollback-sandbox churn (temp placements,
        // snapshot probes) never persists, and empty deltas carry no information.
        documents.ChangeFilter = e =>
            !DocumentSandbox.RollbackScopeActive
            && !DocumentSandbox.IsSandboxTransaction(e.GetTransactionNames())
            && (e.GetAddedElementIds().Count > 0
                || e.GetModifiedElementIds().Count > 0
                || e.GetDeletedElementIds().Count > 0);

        documents.Opened += tracked => FamilySnapshotStore.WarmStart(tracked.Resolve());

        // Save boundaries are the only points where Element.VersionGuid is a valid identity, so
        // persistence lives exclusively on the Saved event (all three kinds).
        documents.Saved += (tracked, _) => FamilySnapshotStore.Persist(tracked.Resolve());

        documents.Closed += key => DocShadow.Evict(key.Value);

        // Granular eviction runs synchronously per event with the element ids — never throttled,
        // never coalesced.
        documents.Changed += (tracked, e) => DocShadow.HandleChange(tracked.Resolve(), new DocumentDelta(
            e.GetAddedElementIds().Select(id => id.Value()).ToList(),
            e.GetModifiedElementIds().Select(id => id.Value()).ToList(),
            e.GetDeletedElementIds().Select(id => id.Value()).ToList(),
            e.GetTransactionNames().ToList()
        ));
    }
}
