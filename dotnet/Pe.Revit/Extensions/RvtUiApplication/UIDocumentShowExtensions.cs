using Autodesk.Revit.UI;

namespace Pe.Revit.Extensions.ProjDocument;

/// <summary>Show elements to the person: one path for host ops and palettes.</summary>
public static class UIDocumentShowExtensions {
    /// <summary>
    ///     A headless document has no window: <c>Application.OpenDocumentFile</c> opened it, it has no active
    ///     view or selection, and Revit cannot activate it (<c>RequestViewChange</c> throws). A link document
    ///     also reads as headless, and is answered without a <c>UIDocument</c>: Revit's open-document set includes
    ///     every loaded link, and <c>new UIDocument(link)</c> throws "not a primary document" (2026-10-01).
    /// </summary>
    public static bool IsHeadless(this Document document) =>
        document.IsLinked || new UIDocument(document).GetOpenUIViews().Count == 0;

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
            // Model box first: a view-dependent box makes Revit build view geometry per element, which is slow
            // across hundreds of ducts in a large model. The view box only stands in for an element with no model box.
            .Select(element => element?.get_BoundingBox(null) ?? element?.get_BoundingBox(view))
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

    /// <summary>The 3D view that boxed the elements, whether it was made, and whether it displays all of them.</summary>
    public sealed record Boxed(View3D View, bool Created, bool ShowsAll);

    /// <summary>The section box's margin past the elements: at least this many feet, else a quarter of their diagonal.</summary>
    private const double BoxPadFeet = 8.0;

    /// <summary>
    ///     Select <paramref name="ids" />, box the person's own 3D view around them with a generous margin, open it and
    ///     zoom to fit. The view is the default {3D}, else this user's {3D - username}, else one named "Pe 3D" is made
    ///     (Revit refuses braces in a name set by the API). The section box is the one view edit: one undoable transaction,
    ///     no model element changes. Call outside a transaction.
    /// </summary>
    public static Boxed BoxInThreeD(this UIDocument uidoc, IReadOnlyCollection<ElementId> ids) {
        var document = uidoc.Document;
        var threeDs = new FilteredElementCollector(document).OfClass(typeof(View3D)).Cast<View3D>()
            .Where(v => !v.IsTemplate && !v.IsPerspective)
            .ToList();
        var mine = $"{{3D - {uidoc.Application.Application.Username}}}";
        var view = threeDs.FirstOrDefault(v => v.Name == "{3D}") ?? threeDs.FirstOrDefault(v => v.Name == mine);
        var created = view is null;
        view ??= CreateThreeD(document);

        var box = document.UnionBoundingBox(ids, view);
        if (box != null) {
            var pad = Math.Max(BoxPadFeet, 0.25 * box.Max.DistanceTo(box.Min));
            var margin = new XYZ(pad, pad, pad);
            using var transaction = new Transaction(document, "Pe: box the 3D view");
            transaction.Start();
            view.SetSectionBox(new BoundingBoxXYZ { Min = box.Min - margin, Max = box.Max + margin });
            view.IsSectionBoxActive = true;
            transaction.Commit();
        }

        _ = uidoc.SelectAndZoom(ids, view);
        return new Boxed(view, created, DisplaysAll(document, view, ids.ToHashSet()));
    }

    private static bool DisplaysAll(Document document, View view, HashSet<ElementId> ids) =>
        new FilteredElementCollector(document, view.Id).WherePasses(new ElementIdSetFilter(ids)).ToElementIds().Count == ids.Count;

    private static View3D CreateThreeD(Document document) {
        var family = new FilteredElementCollector(document).OfClass(typeof(ViewFamilyType)).Cast<ViewFamilyType>()
            .First(x => x.ViewFamily == ViewFamily.ThreeDimensional);
        using var transaction = new Transaction(document, "Pe 3D view");
        transaction.Start();
        var view = View3D.CreateIsometric(document, family.Id);
        view.Name = "Pe 3D";
        transaction.Commit();
        return view;
    }
}
