using Pe.Revit.Extensions.FamDocument;
using Pe.Revit.FamilyFoundry.Aggregators.Snapshots;
using Pe.Revit.FamilyFoundry.LookupTables;
using Pe.Revit.FamilyFoundry.OperationSettings;

namespace Pe.Revit.FamilyFoundry.Snapshots;

public sealed class LookupTableSectionCollector : IFamilyDocCollector {
    public bool ShouldCollect(FamilySnapshot snapshot) =>
        snapshot.LookupTables == null || snapshot.LookupTables.Data.Count == 0;

    public void Collect(FamilySnapshot snapshot, FamilyDocument famDoc) =>
        snapshot.LookupTables = CollectFromFamilyDoc(famDoc, snapshot.Parameters?.Data);

    private static SnapshotSection<LookupTableDefinition> CollectFromFamilyDoc(
        FamilyDocument famDoc,
        IReadOnlyList<ParameterSnapshot>? parameterSnapshots
    ) {
        var familyDocument = famDoc.Document;
        var ownerFamilyId = familyDocument.OwnerFamily?.Id;
        if (ownerFamilyId == null) {
            return new SnapshotSection<LookupTableDefinition> {
                Source = SnapshotSource.FamilyDoc,
                Data = []
            };
        }

        using var manager = FamilySizeTableManager.GetFamilySizeTableManager(familyDocument, ownerFamilyId);
        if (manager == null || !manager.IsValidObject || manager.NumberOfSizeTables == 0) {
            return new SnapshotSection<LookupTableDefinition> {
                Source = SnapshotSource.FamilyDoc,
                Data = []
            };
        }

        var keyCountsByTable = LookupFormulaInspector.CollectLookupKeyCounts(parameterSnapshots);
        var workingDirectory = Path.Combine(Path.GetTempPath(), "pelt", "lookup-capture", Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(workingDirectory);

        try {
            var tables = manager.GetAllSizeTableNames()
                .OrderBy(name => name, StringComparer.Ordinal)
                .Select(tableName => ExportAndDecodeTable(manager, familyDocument, workingDirectory, tableName, keyCountsByTable))
                .ToList();

            return new SnapshotSection<LookupTableDefinition> {
                Source = SnapshotSource.FamilyDoc,
                Data = tables
            };
        } finally {
            try {
                Directory.Delete(workingDirectory, true);
            } catch {
                // temp cleanup is best-effort only
            }
        }
    }

    private static LookupTableDefinition ExportAndDecodeTable(
        FamilySizeTableManager manager,
        Document familyDocument,
        string workingDirectory,
        string tableName,
        IReadOnlyDictionary<string, int> keyCountsByTable
    ) {
        var csvPath = Path.Combine(workingDirectory, $"{SanitizePathSegment(tableName)}.csv");
        if (!manager.ExportSizeTable(tableName, csvPath) || !File.Exists(csvPath)) {
            throw new InvalidOperationException(
                $"Failed to export embedded lookup table '{tableName}' from family '{familyDocument.Title}'.");
        }

        var inferredKeyCount = keyCountsByTable.TryGetValue(tableName, out var keyCount)
            ? keyCount
            : 0;
        return LookupTableCsvCodec.Decode(tableName, File.ReadAllText(csvPath), inferredKeyCount);
    }

    private static string SanitizePathSegment(string value) {
        var invalidChars = Path.GetInvalidFileNameChars();
        var sanitized = new string(value.Select(ch => invalidChars.Contains(ch) ? '_' : ch).ToArray()).Trim();
        return string.IsNullOrWhiteSpace(sanitized) ? "lookup-table" : sanitized;
    }
}
