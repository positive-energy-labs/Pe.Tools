using Pe.Revit.FamilyFoundry.OperationSettings;

namespace Pe.Revit.FamilyFoundry.LookupTables;

public static class LookupTableArtifactWriter {
    public static void WriteCsvFiles(
        IEnumerable<LookupTableDefinition>? tables,
        string rootDirectoryPath,
        string subdirectoryName
    ) {
        if (string.IsNullOrWhiteSpace(rootDirectoryPath))
            throw new ArgumentException("Root directory path is required.", nameof(rootDirectoryPath));
        if (string.IsNullOrWhiteSpace(subdirectoryName))
            throw new ArgumentException("Subdirectory name is required.", nameof(subdirectoryName));
        if (tables == null)
            return;

        var orderedTables = tables
            .Where(table => table?.Schema != null && !string.IsNullOrWhiteSpace(table.Schema.Name))
            .OrderBy(table => table.Schema.Name, StringComparer.Ordinal)
            .ToList();
        if (orderedTables.Count == 0)
            return;

        var outputDirectory = Path.Combine(rootDirectoryPath, SanitizePathSegment(subdirectoryName));
        Directory.CreateDirectory(outputDirectory);

        var usedFileNames = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var table in orderedTables) {
            var baseName = SanitizePathSegment(table.Schema.Name);
            var fileName = GetUniqueFileName(baseName, usedFileNames);
            var outputPath = Path.Combine(outputDirectory, $"{fileName}.csv");
            File.WriteAllText(outputPath, LookupTableCsvCodec.Encode(table));
        }
    }

    private static string GetUniqueFileName(string baseName, ISet<string> usedFileNames) {
        var candidate = string.IsNullOrWhiteSpace(baseName) ? "lookup-table" : baseName;
        var suffix = 1;
        while (!usedFileNames.Add(candidate))
            candidate = $"{baseName}-{suffix++}";
        return candidate;
    }

    private static string SanitizePathSegment(string value) {
        var invalidChars = Path.GetInvalidFileNameChars();
        var sanitized = new string(value.Select(ch => invalidChars.Contains(ch) ? '_' : ch).ToArray()).Trim();
        return string.IsNullOrWhiteSpace(sanitized) ? "lookup-table" : sanitized;
    }
}
