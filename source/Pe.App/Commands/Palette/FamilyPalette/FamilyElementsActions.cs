using Autodesk.Revit.UI;
using Pe.App.Services;
using Pe.Extensions.FamDocument;
using Pe.Extensions.UiApplication;

namespace Pe.App.Commands.Palette.FamilyPalette;

/// <summary>
///     Static class containing collection and action handler methods for Family Elements palette.
///     Separated to support lazy loading per tab.
/// </summary>
internal static class FamilyElementsActions {
    /// <summary>
    ///     Collects all family elements (families, parameters, dimensions, ref planes, connectors).
    /// </summary>
    internal static IEnumerable<FamilyElementItem> CollectAllElements(Document doc, FamilyDocument familyDoc) {
        // Nested Families
        foreach (var item in CollectFamilies(doc, familyDoc))
            yield return item;

        // Family Parameters
        foreach (var item in CollectParameters(doc, familyDoc))
            yield return item;

        // Dimensions
        foreach (var item in CollectDimensions(doc, familyDoc))
            yield return item;

        // Reference Planes
        foreach (var item in CollectReferencePlanes(doc, familyDoc))
            yield return item;

        // Connectors
        foreach (var item in CollectConnectors(doc, familyDoc))
            yield return item;
    }

    /// <summary>
    ///     Collects nested family instances in the family document.
    /// </summary>
    internal static IEnumerable<FamilyElementItem> CollectFamilies(Document doc, FamilyDocument familyDoc) {
        foreach (var instance in new FilteredElementCollector(doc)
                     .OfClass(typeof(FamilyInstance))
                     .Cast<FamilyInstance>())
            yield return new FamilyElementItem(instance, familyDoc);
    }

    /// <summary>
    ///     Collects family parameters.
    /// </summary>
    internal static IEnumerable<FamilyElementItem> CollectParameters(Document doc, FamilyDocument familyDoc) {
        foreach (var param in familyDoc.FamilyManager.Parameters.OfType<FamilyParameter>()
                     .OrderBy(p => p.Definition.Name))
            yield return new FamilyElementItem(param, familyDoc);
    }

    /// <summary>
    ///     Collects dimensions (excluding spot dimensions).
    /// </summary>
    internal static IEnumerable<FamilyElementItem> CollectDimensions(Document doc, FamilyDocument familyDoc) {
        foreach (var dim in new FilteredElementCollector(doc)
                     .OfClass(typeof(Dimension))
                     .Cast<Dimension>()
                     .Where(d => d is not SpotDimension))
            yield return new FamilyElementItem(dim, familyDoc);
    }

    /// <summary>
    ///     Collects reference planes.
    /// </summary>
    internal static IEnumerable<FamilyElementItem> CollectReferencePlanes(Document doc, FamilyDocument familyDoc) {
        foreach (var refPlane in new FilteredElementCollector(doc)
                     .OfClass(typeof(ReferencePlane))
                     .Cast<ReferencePlane>())
            yield return new FamilyElementItem(refPlane, familyDoc);
    }

    /// <summary>
    ///     Collects connector elements.
    /// </summary>
    internal static IEnumerable<FamilyElementItem> CollectConnectors(Document doc, FamilyDocument familyDoc) {
        foreach (var connector in new FilteredElementCollector(doc)
                     .OfClass(typeof(ConnectorElement))
                     .Cast<ConnectorElement>())
            yield return new FamilyElementItem(connector, familyDoc);
    }

    /// <summary>
    ///     Zooms to and selects an element in the view.
    /// </summary>
    internal static void HandleZoomToElement(UIDocument uidoc, FamilyElementItem? item) {
        if (item?.ElementId == null) return;
        uidoc.ShowElements(item.ElementId);
        uidoc.Selection.SetElementIds([item.ElementId]);
    }

    /// <summary>
    ///     Opens RevitLookup to snoop the selected element.
    /// </summary>
    internal static void HandleSnoop(UIApplication uiapp, Document doc, FamilyElementItem? item) {
        if (item == null) return;
        object objectToSnoop = item.ElementType switch {
            FamilyElementType.Parameter => item.FamilyParam!,
            FamilyElementType.Connector => item.Connector!,
            FamilyElementType.Dimension => item.Dimension!,
            FamilyElementType.ReferencePlane => item.RefPlane!,
            FamilyElementType.Family => item.FamilyInstance!,
            _ => throw new InvalidOperationException($"Unknown element type: {item.ElementType}")
        };
        _ = RevitDbExplorerService.TrySnoopObject(uiApp: uiapp, doc, objectToSnoop, item.TextPrimary);
    }
}
