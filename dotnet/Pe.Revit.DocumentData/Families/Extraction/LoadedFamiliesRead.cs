using Pe.Revit.DocumentData.Families.Loaded.Collectors;
using Pe.Shared.RevitData;
using Pe.Shared.RevitData.Families;
using System.Diagnostics;
using System.Security.Cryptography;
using System.Text;

namespace Pe.Revit.DocumentData.Families.Extraction;

/// <summary>Bounded family extraction and its saved-file boundary, shared by serial and worker reads.</summary>
public static class LoadedFamiliesRead {
    public static LoadedFamiliesMatrixData PrepareFamilyRead(this Document document, LoadedFamiliesFilter? filter,
        IFamilySnapshotCache? cache = null) {
        var catalog = LoadedFamiliesCatalogCollector.CollectCanonical(document, filter);
        var cached = new List<FamilySnapshotRecord>();
        foreach (var family in catalog)
            if (cache?.TryGet(family.FamilyId, out var record) == true)
                cached.Add(record);
        var (path, refusal) = CopySource(document);
        var inputVersion = InputRevision(catalog.Select(f => (Family)document.GetElement(f.FamilyId.ToElementId())));
        string? cloudSource = null;
        if (document.IsModelInCloud && !document.IsModified) {
            var cloud = document.GetCloudModelPath();
            cloudSource = $"cld://{cloud.Region}/{cloud.GetProjectGUID():D}/{cloud.GetModelGUID():D}";
            refusal = null;
        }
        return new LoadedFamiliesMatrixData(cached, [], Source: new LoadedFamiliesReadSource(
            catalog.Select(f => new LoadedFamilyCatalogEntry(f.FamilyId, f.FamilyUniqueId, f.FamilyName,
                f.CategoryName, f.Types.Count, f.PlacedInstanceCount, [])).ToList(),
            document.Application.VersionNumber, inputVersion, path, refusal, cloudSource));
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

    private static (string? Path, string? Refusal) CopySource(Document document) {
        // Opening a clone does not copy unsaved memory. SaveAs changes the user's document identity.
        if (document.IsModified) return (null, "Reading unsaved changes in this instance.");
        if (document.IsModelInCloud) return (null, "Reading the open cloud revision in this instance.");
        if (string.IsNullOrEmpty(document.PathName) || !File.Exists(document.PathName))
            return (null, "The document has no saved file to copy.");
        return (document.PathName, null);
    }

    private static string InputRevision(IEnumerable<Family> families) {
        // Workers read authored families only. Revit changes the whole-document GUID on rollback and
        // external-reference loading (even IsModified=false). Project values and schedules stay here.
        // VersionGuid is a saved-input identity, never a replacement for the host's in-session change marks.
        var stamps = families.OrderBy(f => f.UniqueId, StringComparer.Ordinal).SelectMany(family =>
            new[] { $"family/{family.UniqueId}/{family.VersionGuid:D}" }.Concat(family.GetFamilySymbolIds()
                .Select(id => family.Document.GetElement(id)).OfType<FamilySymbol>()
                .OrderBy(symbol => symbol.UniqueId, StringComparer.Ordinal)
                .Select(symbol => $"type/{symbol.UniqueId}/{symbol.VersionGuid:D}")));
        using var hash = SHA256.Create();
        return string.Concat(hash.ComputeHash(Encoding.UTF8.GetBytes(string.Join("\n", stamps)))
            .Select(value => value.ToString("x2")));
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
