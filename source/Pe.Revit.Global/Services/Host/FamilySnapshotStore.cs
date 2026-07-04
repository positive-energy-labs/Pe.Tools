using Newtonsoft.Json;
using Pe.Shared.RevitData.Families;
using Pe.Shared.StorageRuntime;
using Serilog;
using System.Security.Cryptography;
using RevitDocument = Autodesk.Revit.DB.Document;

namespace Pe.Revit.Global.Services.Host;

/// <summary>
///     Persistent warm-start for DocShadow's family snapshots. Persists at save boundaries (the only
///     points where Element.VersionGuid is meaningful) and seeds the shadow on DocumentOpened after
///     validating against Document.GetChangedElements. Any anomaly — schema drift, guid mismatch,
///     GetChangedElements failure, unresolvable family ids — discards the store: warm-start is an
///     optimization and must never be trusted over a miss.
/// </summary>
internal static class FamilySnapshotStore {
    private const int SchemaVersion = 1;

    /// <summary>Kill switch: deleting the store directory or setting this env var restores pure in-session caching.</summary>
    private static bool Disabled =>
        !string.IsNullOrEmpty(Environment.GetEnvironmentVariable("PE_DISABLE_FAMILY_SNAPSHOT_STORE"));

    public static void Persist(RevitDocument document) {
        if (Disabled)
            return;

        try {
            if (document.IsFamilyDocument)
                return;

            var shadow = DocShadow.For(document);
            var records = shadow.SnapshotFamilies();
            if (records.Count == 0)
                return;

            var baseVersionGuid = RevitDocument.GetDocumentVersion(document).VersionGUID;
            var entries = new List<StoredFamilySnapshot>();
            foreach (var record in records) {
                // Stamp per-family VersionGuid now — we are inside a save-boundary handler, the only
                // context where the guid is a valid identity (it does not tick per transaction).
                string versionGuid;
                try {
                    if (document.GetElement(record.FamilyId.ToElementId()) is not Family family)
                        continue;
                    versionGuid = family.VersionGuid.ToString("D");
                } catch {
                    continue; // transient/odd element: just don't persist it
                }

                entries.Add(new StoredFamilySnapshot(record.FamilyId, versionGuid, record));
            }

            var payload = new StorePayload(SchemaVersion, baseVersionGuid.ToString("D"), entries);
            var path = ResolveStorePath(document);
            var tempPath = path + ".tmp";
            File.WriteAllText(tempPath, JsonConvert.SerializeObject(payload));
            if (File.Exists(path))
                File.Delete(path);
            File.Move(tempPath, path);
            Log.Debug(
                "Family snapshot store persisted: Document={DocumentKey}, Entries={Entries}",
                document.GetDocumentKey(),
                entries.Count
            );
        } catch (Exception ex) {
            Log.Debug(ex, "Family snapshot store persist failed (ignored).");
        }
    }

    public static void WarmStart(RevitDocument document) {
        if (Disabled)
            return;

        string? path = null;
        try {
            if (document.IsFamilyDocument)
                return;

            path = ResolveStorePath(document);
            if (!File.Exists(path))
                return;

            var payload = JsonConvert.DeserializeObject<StorePayload>(File.ReadAllText(path));
            if (payload == null || payload.SchemaVersion != SchemaVersion || payload.Entries == null)
                return;

            // Evict everything the document changed since the persisted base version. Any failure here
            // (baseline unknown to this document lineage, detached copies, ...) means full miss.
            var changedIds = new HashSet<long>();
            using (var difference = document.GetChangedElements(Guid.Parse(payload.BaseVersionGuid))) {
                foreach (var id in difference.GetCreatedElementIds())
                    _ = changedIds.Add(id.Value());
                foreach (var id in difference.GetModifiedElementIds())
                    _ = changedIds.Add(id.Value());
                foreach (var id in difference.GetDeletedElementIds())
                    _ = changedIds.Add(id.Value());
            }

            var shadow = DocShadow.For(document);
            var seeded = 0;
            foreach (var entry in payload.Entries) {
                if (entry?.Record == null || changedIds.Contains(entry.FamilyId))
                    continue;

                // Non-workshared docs never report deletions; a family id that no longer resolves (or
                // resolves to a different version) is dropped regardless of the diff.
                if (document.GetElement(entry.FamilyId.ToElementId()) is not Family family)
                    continue;
                if (!string.Equals(family.VersionGuid.ToString("D"), entry.VersionGuid, StringComparison.OrdinalIgnoreCase))
                    continue;

                shadow.Store(entry.Record);
                seeded++;
            }

            Log.Debug(
                "Family snapshot store warm-start: Document={DocumentKey}, Seeded={Seeded} of {Persisted}",
                document.GetDocumentKey(),
                seeded,
                payload.Entries.Count
            );
        } catch (Exception ex) {
            Log.Debug(ex, "Family snapshot store warm-start failed; discarding store.");
            try {
                if (path != null && File.Exists(path))
                    File.Delete(path);
            } catch {
                // best effort
            }
        }
    }

    private static string ResolveStorePath(RevitDocument document) {
        var directory = Path.Combine(StorageClient.Default.Global().State().DirectoryPath, "family-snapshots");
        _ = Directory.CreateDirectory(directory);
        var keyBytes = Encoding.UTF8.GetBytes(document.GetDocumentKey());
        string hash;
        using (var sha = SHA256.Create())
            hash = Convert.ToBase64String(sha.ComputeHash(keyBytes)).Replace('/', '-').Replace('+', '_').TrimEnd('=');
        return Path.Combine(directory, $"{hash}.json");
    }

    private sealed record StorePayload(
        int SchemaVersion,
        string BaseVersionGuid,
        List<StoredFamilySnapshot>? Entries
    );

    private sealed record StoredFamilySnapshot(
        long FamilyId,
        string VersionGuid,
        FamilySnapshotRecord Record
    );
}
