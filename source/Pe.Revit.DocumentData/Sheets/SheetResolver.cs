namespace Pe.Revit.DocumentData.Sheets;

public static class SheetResolver {
    /// <summary>
    ///     Resolves a sheet by exact sheet number or exact name (case-insensitive), number first.
    ///     Null when nothing matches — callers decide whether that is an error.
    /// </summary>
    public static ViewSheet? ByNumberOrName(Document document, string token) {
        var sheets = new FilteredElementCollector(document)
            .OfClass(typeof(ViewSheet))
            .Cast<ViewSheet>()
            .Where(sheet => !sheet.IsTemplate)
            .ToList();

        return sheets.FirstOrDefault(sheet => string.Equals(sheet.SheetNumber, token, StringComparison.OrdinalIgnoreCase))
               ?? sheets.FirstOrDefault(sheet => string.Equals(sheet.Name, token, StringComparison.OrdinalIgnoreCase));
    }
}
