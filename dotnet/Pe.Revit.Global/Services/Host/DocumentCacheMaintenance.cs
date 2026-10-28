using Pe.Revit.Loader.Documents;
using Pe.Revit.Tasks;
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
        // Sandbox churn is private to its operation. Outside that scope even an empty delta matters:
        // TransactionGroupRolledBack can restore geometry without any ids (Space READING-REVIT U6).
        // Space epochs and the bridge must see that event; each data cache owns its narrower eviction.
        documents.ChangeFilter = e =>
            !DocumentSandbox.RollbackScopeActive
            && !DocumentSandbox.IsSandboxTransaction(e.GetTransactionNames());

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
