using Autodesk.Revit.UI;

namespace Pe.App.Commands.Palette.FamilyPalette;

/// <summary>
///     Manages graphic override highlighting for elements with proper cleanup.
///     Caches original overrides on first highlight, restores all on dispose.
///     Falls back to selection-only in family documents where graphic overrides aren't supported.
/// </summary>
public class ElementHighlighter : IDisposable {
    private readonly OverrideGraphicSettings? _highlightSettings;
    private readonly Dictionary<ElementId, OverrideGraphicSettings> _originalOverrides = new();
    private readonly bool _supportsOverrides;
    private readonly UIDocument _uidoc;
    private readonly View _view;
    private bool _disposed;

    public ElementHighlighter(UIDocument uidoc) {
        this._uidoc = uidoc;
        this._view = uidoc.ActiveView;

        // Graphic overrides only work in project documents, not family documents:
        // Autodesk.Revit.Exceptions.InvalidOperationException: The element "this View" does not belong to a project document
        this._supportsOverrides = !uidoc.Document.IsFamilyDocument;

        if (this._supportsOverrides)
            this._highlightSettings = CreateHighlightSettings(uidoc.Document);
    }

    /// <summary>
    ///     Restores all cached graphic overrides to their original state.
    /// </summary>
    public void Dispose() {
        if (this._disposed) return;
        this._disposed = true;

        if (!this._supportsOverrides || this._originalOverrides.Count == 0) return;

        using var trans = new Transaction(this._uidoc.Document, "Restore Element Overrides");
        _ = trans.Start();
        foreach (var (elementId, original) in this._originalOverrides)
            this._view.SetElementOverrides(elementId, original);
        _ = trans.Commit();

        this._originalOverrides.Clear();
    }

    /// <summary>
    ///     Highlights an element by applying graphic overrides (if supported) and zooming to it.
    ///     Only highlights if the element is visible in the current view.
    ///     In family documents, falls back to selection + zoom only.
    /// </summary>
    public void Highlight(ElementId elementId) {
        if (this._disposed) return;
        if (elementId == null || elementId == ElementId.InvalidElementId) return;
        if (!this.IsElementInView(elementId)) return;

        // Apply graphic overrides only in project documents, otherwise highlight via selection
        if (!(this._supportsOverrides && this._highlightSettings != null))
            this._uidoc.Selection.SetElementIds([elementId]);
        else {
            // Cache original override if not already cached
            if (!this._originalOverrides.ContainsKey(elementId))
                this._originalOverrides[elementId] = this._view.GetElementOverrides(elementId);

            // Apply highlight. TODO: do we need a transaction? 
            // reference: https://forums.autodesk.com/t5/revit-api-forum/how-to-highlight-an-element/td-p/7254545
            using var trans = new Transaction(this._uidoc.Document, "Highlight Element");
            _ = trans.Start();
            this._view.SetElementOverrides(elementId, this._highlightSettings);
            _ = trans.Commit();
        }

        // Select and do gentle zoom
        this.GentleZoomToElement(elementId);
    }

    private void GentleZoomToElement(ElementId elementId, double expandFactor = 3.0) {
        var element = this._uidoc.Document.GetElement(elementId);
        var bbox = element?.get_BoundingBox(this._view);
        if (bbox == null) return;

        // Expand the bounding box by the factor for a less aggressive zoom
        var center = (bbox.Min + bbox.Max) / 2;
        var halfSize = (bbox.Max - bbox.Min) / 2;
        var expandedHalfSize = halfSize * expandFactor;

        var corner1 = center - expandedHalfSize;
        var corner2 = center + expandedHalfSize;

        // Get the UIView for the active view and zoom
        var uiView = this._uidoc.GetOpenUIViews().FirstOrDefault(v => v.ViewId == this._view.Id);
        uiView?.ZoomAndCenterRectangle(corner1, corner2);
    }

    private bool IsElementInView(ElementId elementId) =>
        // Check if the element exists in the current view's visible elements
        new FilteredElementCollector(this._uidoc.Document, this._view.Id)
            .WhereElementIsNotElementType()
            .Any(e => e.Id == elementId);

    private static OverrideGraphicSettings CreateHighlightSettings(Document doc) {
        var settings = new OverrideGraphicSettings();

        // Find solid fill pattern
        var solidFill = new FilteredElementCollector(doc)
            .OfClass(typeof(FillPatternElement))
            .Cast<FillPatternElement>()
            .FirstOrDefault(fp => fp.GetFillPattern().IsSolidFill);

        var highlightColor = new Color(255, 165, 0); // Orange
        var lineColor = new Color(255, 100, 0); // Darker orange for lines

        _ = settings.SetProjectionLineColor(lineColor);
        _ = settings.SetProjectionLineWeight(6);

        if (solidFill != null) {
            _ = settings.SetSurfaceForegroundPatternId(solidFill.Id);
            _ = settings.SetSurfaceForegroundPatternColor(highlightColor);
        }

        return settings;
    }
}