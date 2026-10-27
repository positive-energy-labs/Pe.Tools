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
        // A worker opens a copy of the saved file: it cannot see unsaved memory, and SaveAs would change the
        // user's document identity. Cloud models stay here until a detached cloud open is proven (family ledger).
        var refusal = document.IsModified ? "Reading unsaved changes in this instance."
            : document.IsModelInCloud ? "Reading the open cloud model in this instance."
            : string.IsNullOrEmpty(document.PathName) || !File.Exists(document.PathName) ? "The document has no saved file to copy."
            : null;
        return new LoadedFamiliesMatrixData(cached, [], Source: new LoadedFamiliesReadSource(
            catalog.Select(f => new LoadedFamilyCatalogEntry(f.FamilyId, f.FamilyUniqueId, f.FamilyName,
                f.CategoryName, f.Types.Count, f.PlacedInstanceCount, [])).ToList(),
            document.Application.VersionNumber,
            InputRevision(catalog.Select(f => (Family)document.GetElement(f.FamilyId.ToElementId()))),
            refusal is null ? document.PathName : null,
            refusal));
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
        return new LoadedFamiliesMatrixData([record], [], ElapsedMs: timer.Elapsed.TotalMilliseconds);
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
