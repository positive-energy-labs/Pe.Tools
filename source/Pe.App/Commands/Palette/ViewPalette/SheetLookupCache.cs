namespace Pe.App.Commands.Palette.ViewPalette;

/// <summary>
///     Information about a sheet placement.
/// </summary>
public record SheetInfo(string SheetNumber, string SheetName);

/// <summary>
///     Pre-computed O(1) lookup cache for view-to-sheet mappings.
///     Built once at startup by iterating all sheets and viewports.
/// </summary>
public class SheetLookupCache {
    private readonly Dictionary<ElementId, SheetInfo> _viewToSheet = new();

    public SheetLookupCache(Document doc) {
        // Single pass through all sheets to build the mapping
        var sheets = new FilteredElementCollector(doc)
            .OfClass(typeof(ViewSheet))
            .Cast<ViewSheet>();

        foreach (var sheet in sheets) {
            var sheetInfo = new SheetInfo(sheet.SheetNumber, sheet.Name);

            // Map all viewports on this sheet to the sheet info
            var viewportIds = sheet.GetAllViewports();
            foreach (var viewportId in viewportIds) {
                if (doc.GetElement(viewportId) is Viewport viewport)
                    this._viewToSheet.TryAdd(viewport.ViewId, sheetInfo);
            }
        }
    }

    /// <summary>
    ///     Gets the sheet info for a view, or null if not placed on any sheet.
    /// </summary>
    public SheetInfo GetSheetInfo(ElementId viewId) =>
        this._viewToSheet.TryGetValue(viewId, out var info) ? info : null;

    /// <summary>
    ///     Returns true if the view is placed on a sheet.
    /// </summary>
    public bool IsOnSheet(ElementId viewId) => this._viewToSheet.ContainsKey(viewId);
}
