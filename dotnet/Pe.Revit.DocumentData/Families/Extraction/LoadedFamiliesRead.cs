using Pe.Revit.DocumentData.Families.Loaded.Collectors;
using Pe.Shared.RevitData;
using Pe.Shared.RevitData.Families;
using System.Diagnostics;

namespace Pe.Revit.DocumentData.Families.Extraction;

/// <summary>Bounded family extraction and its saved-file boundary, shared by serial and worker reads.</summary>
public static class LoadedFamiliesRead {
    public static LoadedFamiliesMatrixData PrepareFamilyRead(this Document document, LoadedFamiliesFilter? filter,
        IFamilySnapshotCache? cache = null, Guid? savedCloudVersion = null) {
        var catalog = LoadedFamiliesCatalogCollector.CollectCanonical(document, filter);
        var cached = new List<FamilySnapshotRecord>();
        foreach (var family in catalog)
            if (cache?.TryGet(family.FamilyId, out var record) == true)
                cached.Add(record);
        var version = Document.GetDocumentVersion(document);
        var (path, refusal, inputVersion) = CopySource(document, version);
        string? cloudSource = null;
        if (document.IsModelInCloud && !document.IsModified && savedCloudVersion is { } savedVersion) {
            var cloud = document.GetCloudModelPath();
            cloudSource = $"cld://{cloud.Region}/{cloud.GetProjectGUID():D}/{cloud.GetModelGUID():D}";
            refusal = null;
            inputVersion = savedVersion;
        }
        return new LoadedFamiliesMatrixData(cached, [], Source: new LoadedFamiliesReadSource(
            catalog.Select(f => new LoadedFamilyCatalogEntry(f.FamilyId, f.FamilyUniqueId, f.FamilyName,
                f.CategoryName, f.Types.Count, f.PlacedInstanceCount, [])).ToList(),
            document.Application.VersionNumber, inputVersion.ToString("D"), path, refusal, cloudSource));
    }

    public static LoadedFamiliesMatrixData ReadLoadedFamilySnapshot(this Document document, long familyId,
        IFamilySnapshotCache? cache = null) {
        var timer = Stopwatch.StartNew();
        if (cache?.TryGet(familyId, out var cached) == true)
            return new LoadedFamiliesMatrixData([cached], [], ElapsedMs: timer.Elapsed.TotalMilliseconds, CacheHit: true);
        if (document.GetElement(familyId.ToElementId()) is not Family family)
            throw new ArgumentException($"Element {familyId} is not a loaded family.", nameof(familyId));
        var record = FamilySnapshotExtractor.ExtractFromProjectFamily(document, family);
        cache?.Store(record);
        return new LoadedFamiliesMatrixData([record], record.Issues.ToList(), ElapsedMs: timer.Elapsed.TotalMilliseconds);
    }

    private static (string? Path, string? Refusal, Guid Version) CopySource(Document document, DocumentVersion version) {
        // Opening a clone does not copy unsaved memory. SaveAs changes the user's document identity.
        if (document.IsModified) return (null, "Reading unsaved changes in this instance.", version.VersionGUID);
        if (document.IsModelInCloud) return (null, "Reading the open cloud revision in this instance.", version.VersionGUID);
        if (string.IsNullOrEmpty(document.PathName) || !File.Exists(document.PathName))
            return (null, "The document has no saved file to copy.", version.VersionGUID);
        try {
            using var info = BasicFileInfo.Extract(document.PathName);
            var saved = info.GetDocumentVersion();
            if (saved.NumberOfSaves != version.NumberOfSaves)
                return (null, "The file differs from this open revision.", version.VersionGUID);
            if (saved.VersionGUID != version.VersionGUID) {
                // Revit advances the in-memory GUID even after a complete placement rollback (IsModified=false).
                // Accept that lineage only when Revit proves the file's revision has no remaining element changes.
                using var difference = document.GetChangedElements(saved.VersionGUID);
                if (difference.GetCreatedElementIds().Count > 0 || difference.GetModifiedElementIds().Count > 0 ||
                    difference.GetDeletedElementIds().Count > 0)
                    return (null, "The file differs from this open revision.", version.VersionGUID);
            }
            return (document.PathName, null, saved.VersionGUID);
        } catch (Exception exception) {
            return (null, $"The saved revision could not be verified: {exception.Message}", version.VersionGUID);
        }
    }

    /// <summary>Remote records are scoped to one call, never seeded into the live document cache.</summary>
    public static IFamilySnapshotCache WithFamilySnapshots(this Document document,
        IReadOnlyList<FamilySnapshotRecord> records, IFamilySnapshotCache fallback) {
        var byId = new Dictionary<long, FamilySnapshotRecord>();
        foreach (var record in records) {
            if (document.GetElement(record.FamilyId.ToElementId()) is not Family family || family.UniqueId != record.FamilyUniqueId)
                throw new InvalidOperationException($"Family '{record.FamilyName}' changed during the read. Read again.");
            if (byId.ContainsKey(record.FamilyId))
                throw new ArgumentException($"Duplicate family record {record.FamilyId}.", nameof(records));
            byId.Add(record.FamilyId, record);
        }
        return new ReadCache(byId, fallback);
    }

    private sealed class ReadCache(Dictionary<long, FamilySnapshotRecord> records, IFamilySnapshotCache fallback) : IFamilySnapshotCache {
        public bool TryGet(long familyId, out FamilySnapshotRecord record) =>
            records.TryGetValue(familyId, out record!) || fallback.TryGet(familyId, out record!);
        public void Store(FamilySnapshotRecord record) => fallback.Store(record);
    }
}
