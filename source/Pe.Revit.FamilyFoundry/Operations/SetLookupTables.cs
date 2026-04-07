using Pe.Revit.Extensions.FamDocument;
using Pe.Revit.FamilyFoundry.LookupTables;
using Pe.Revit.FamilyFoundry.OperationSettings;

namespace Pe.Revit.FamilyFoundry.Operations;

public sealed class SetLookupTables(SetLookupTablesSettings settings)
    : DocOperation<SetLookupTablesSettings>(settings) {
    public override string Description =>
        "Emit authored lookup tables as Revit CSV and import them into the family.";

    public override OperationLog Execute(
        FamilyDocument doc,
        FamilyProcessingContext processingContext,
        OperationContext groupContext
    ) {
        LookupTableValidator.Validate(this.Settings);

        if (this.Settings.Tables.Count == 0) {
            return new OperationLog(this.Name, [
                new LogEntry("No lookup tables").Skip("No authored lookup tables were provided.")
            ]);
        }

        var familyDocument = doc.Document;
        var ownerFamilyId = familyDocument.OwnerFamily?.Id
                            ?? throw new InvalidOperationException("Expected a family document with an owner family.");

        var manager = FamilySizeTableManager.GetFamilySizeTableManager(familyDocument, ownerFamilyId);
        if (manager == null || !manager.IsValidObject) {
            var created = FamilySizeTableManager.CreateFamilySizeTableManager(familyDocument, ownerFamilyId);
            if (!created) {
                throw new InvalidOperationException("Failed to create the family size-table manager.");
            }

            manager = FamilySizeTableManager.GetFamilySizeTableManager(familyDocument, ownerFamilyId);
        }

        using (manager) {
            if (manager == null || !manager.IsValidObject) {
                throw new InvalidOperationException("Failed to create or retrieve the family size-table manager.");
            }

            var workingDirectory = Path.Combine(Path.GetTempPath(), "pelt", Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(workingDirectory);

            var logs = new List<LogEntry>();
            try {
                foreach (var table in this.Settings.Tables) {
                    var tableName = table.Schema.Name.Trim();
                    var csvPath = Path.Combine(workingDirectory, $"{SanitizePathSegment(tableName)}.csv");
                    File.WriteAllText(csvPath, LookupTableCsvCodec.Encode(table));

                    if (this.Settings.ReplaceExisting && manager.HasSizeTable(tableName)) {
                        _ = manager.RemoveSizeTable(tableName);
                    }

                    using var errorInfo = new FamilySizeTableErrorInfo();
                    var importSucceeded = manager.ImportSizeTable(familyDocument, csvPath, errorInfo);
                    if (!importSucceeded) {
                        throw new InvalidOperationException(FormatImportError(tableName, csvPath, errorInfo, File.ReadAllText(csvPath)));
                    }

                    logs.Add(new LogEntry(tableName).Success($"Imported lookup table '{tableName}' from '{csvPath}'"));
                }
            } finally {
                try {
                    Directory.Delete(workingDirectory, true);
                } catch {
                    // temp cleanup is best-effort only
                }
            }

            return new OperationLog(this.Name, logs);
        }
    }

    private static string FormatImportError(string tableName, string csvPath, FamilySizeTableErrorInfo? errorInfo, string? csvContent = null) {
        var csvSuffix = string.IsNullOrWhiteSpace(csvContent)
            ? string.Empty
            : $" CSV:`{csvContent.Replace("\r", "\\r").Replace("\n", "\\n")}`";

        if (errorInfo == null || !errorInfo.IsValidObject) {
            return $"Failed to import lookup table '{tableName}' from '{csvPath}'.{csvSuffix}";
        }

        return $"Failed to import lookup table '{tableName}' from '{csvPath}'. " +
               $"Revit error={errorInfo.FamilySizeTableErrorType}, row={errorInfo.InvalidRowIndex}, column={errorInfo.InvalidColumnIndex}, header='{errorInfo.InvalidHeaderText}'.{csvSuffix}";
    }

    private static string SanitizePathSegment(string value) {
        var invalidChars = Path.GetInvalidFileNameChars();
        var sanitized = new string(value.Select(ch => invalidChars.Contains(ch) ? '_' : ch).ToArray()).Trim();
        return string.IsNullOrWhiteSpace(sanitized) ? "lookup-table" : sanitized;
    }
}
