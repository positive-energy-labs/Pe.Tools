using Autodesk.Revit.UI;
using Pe.Shared.RevitData;

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

    /// <summary>Which view showed the elements, the name of the view the person was in when it was not that one, and whether the view was made.</summary>
    public sealed record ShownIn(View View, string? SwitchedFrom, bool Created, bool ShowsAll);

    /// <summary>
    ///     Select <paramref name="ids" /> and zoom to them in a view that can show them. The active view stays when it
    ///     is a model view that displays all of them; otherwise the first of the default {3D}, other 3D views, then plans
    ///     on the elements' levels that does (<see cref="ShowViewPolicy" />). A sheet, schedule or other non-model active
    ///     view is never zoomed: model coordinates mean nothing there (the zoom landed in empty space, 2026-10-20). When no
    ///     3D view exists one named "Pe 3D" is made, and the result says so. Call outside a transaction.
    /// </summary>
    public static ShownIn ShowInBestView(this UIDocument uidoc, IReadOnlyCollection<ElementId> ids) {
        var document = uidoc.Document;
        var active = uidoc.ActiveView;
        var idSet = ids.ToHashSet();
        var levels = idSet
            .Select(id => document.GetElement(id)?.LevelId)
            .Where(level => level != null && level != ElementId.InvalidElementId)
            .Select(level => level!)
            .ToHashSet();

        var views = new Dictionary<ElementId, View> { [active.Id] = active };
        foreach (var v in new FilteredElementCollector(document).OfClass(typeof(View3D)).Cast<View3D>()
                     .Where(v => !v.IsTemplate && !v.IsPerspective))
            views[v.Id] = v;
        foreach (var v in new FilteredElementCollector(document).OfClass(typeof(ViewPlan)).Cast<ViewPlan>()
                     .Where(v => !v.IsTemplate && v.GenLevel != null && levels.Contains(v.GenLevel.Id)))
            views[v.Id] = v;

        var infos = views.Values.Select(v => new ShowViewInfo(v.Id.Value(), v.Name, RoleOf(v), v.Id == active.Id,
            v is ViewPlan { GenLevel: { } level } && levels.Contains(level.Id)));
        var order = ShowViewPolicy.Order(infos);

        View? chosen = null;
        foreach (var info in order) {
            var candidate = views[info.Id.ToElementId()];
            if (!DisplaysAll(document, candidate, idSet)) continue;
            chosen = candidate;
            break;
        }

        var created = false;
        var showsAll = chosen != null;
        if (chosen == null) {
            // Nothing displays them all (hidden by a filter, section box, or visibility). A 3D view is still the best
            // place to look; make one only when the document has none.
            chosen = order.FirstOrDefault(i => i.Role == ShowViewRole.ThreeD) is { } first
                ? views[first.Id.ToElementId()]
                : null;
            if (chosen == null) {
                chosen = CreateThreeD(document);
                created = true;
                showsAll = DisplaysAll(document, chosen, idSet);
            }
        }

        _ = uidoc.SelectAndZoom(ids, chosen);
        return new ShownIn(chosen, chosen.Id == active.Id ? null : active.Name, created, showsAll);
    }

    private static ShowViewRole RoleOf(View view) => view switch {
        View3D => ShowViewRole.ThreeD,
        ViewPlan => ShowViewRole.Plan,
        ViewSection => ShowViewRole.Section,
        _ => ShowViewRole.NonModel
    };

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
