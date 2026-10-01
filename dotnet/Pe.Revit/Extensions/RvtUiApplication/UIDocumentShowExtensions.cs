using Autodesk.Revit.UI;

namespace Pe.Revit.Extensions.ProjDocument;

/// <summary>Show elements to the person: one path for host ops and palettes.</summary>
public static class UIDocumentShowExtensions {
    /// <summary>
    ///     A headless document has no window: <c>Application.OpenDocumentFile</c> opened it, it has no active
    ///     view or selection, and Revit cannot activate it (<c>RequestViewChange</c> throws). A link document
    ///     also reads as headless.
    /// </summary>
    public static bool IsHeadless(this Document document) =>
        new UIDocument(document).GetOpenUIViews().Count == 0;

    /// <summary>The active UI document when it holds <paramref name="document" />; null when the document is headless or not active.</summary>
    public static UIDocument? GetActiveUIDocumentFor(this UIApplication uiApp, Document document) =>
        uiApp.ActiveUIDocument is { } active && active.Document.Equals(document) ? active : null;

    /// <summary>
    ///     Union of the elements' bounding boxes in model coordinates: the box in <paramref name="view" /> first
    ///     (it respects the view), the model box as fallback. Null when no element has a box.
    /// </summary>
    public static BoundingBoxXYZ? UnionBoundingBox(this Document document, IEnumerable<ElementId> ids, View view) {
        var corners = ids
            .Select(document.GetElement)
            .Select(element => element?.get_BoundingBox(view) ?? element?.get_BoundingBox(null))
            .Where(box => box != null)
            .SelectMany(box => new[] {
                    box!.Min, box.Max, new XYZ(box.Min.X, box.Min.Y, box.Max.Z), new XYZ(box.Min.X, box.Max.Y, box.Min.Z),
                    new XYZ(box.Max.X, box.Min.Y, box.Min.Z), new XYZ(box.Min.X, box.Max.Y, box.Max.Z),
                    new XYZ(box.Max.X, box.Min.Y, box.Max.Z), new XYZ(box.Max.X, box.Max.Y, box.Min.Z)
                }
                .Select(box.Transform.OfPoint))
            .ToList();
        if (corners.Count == 0) return null;
        return new BoundingBoxXYZ {
            Min = new XYZ(corners.Min(p => p.X), corners.Min(p => p.Y), corners.Min(p => p.Z)),
            Max = new XYZ(corners.Max(p => p.X), corners.Max(p => p.Y), corners.Max(p => p.Z))
        };
    }

    /// <summary>
    ///     Select <paramref name="ids" /> and zoom <paramref name="view" /> (default: the active view, which it
    ///     activates when given) to their union box with a margin. Returns the box, or null when no element has
    ///     one (the selection still lands, the zoom does not move). Call outside a transaction.
    /// </summary>
    // FOOTGUN: UIDocument.ShowElements zooms to an extent that can take in scope boxes and far-off
    // elements, so on a real model it zoomed to the whole site (2026-10-01). ZoomAndCenterRectangle
    // over the union box lands on the elements.
    public static BoundingBoxXYZ? SelectAndZoom(this UIDocument uidoc, IReadOnlyCollection<ElementId> ids, View? view = null) {
        if (view != null && uidoc.ActiveView.Id != view.Id)
            uidoc.ActiveView = view;
        var target = uidoc.ActiveView;
        uidoc.Selection.SetElementIds(ids.ToList());

        var box = uidoc.Document.UnionBoundingBox(ids, target);
        if (box == null) return null;
        var pad = Math.Max(2.0, 0.15 * box.Max.DistanceTo(box.Min));
        var margin = new XYZ(pad, pad, pad);
        uidoc.GetOpenUIViews()
            .First(uiView => uiView.ViewId == target.Id)
            .ZoomAndCenterRectangle(box.Min - margin, box.Max + margin);
        return box;
    }
}
