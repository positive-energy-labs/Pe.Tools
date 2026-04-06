using Pe.App.Services;
using Pe.Revit.Extensions.FamDocument;
using Pe.Revit.Global.Services.Document;

namespace Pe.App.Commands.Palette.FamilyPalette;

/// <summary>
///     Static class containing collection and action handler methods for Family Elements palette.
///     Separated to support lazy loading per tab.
/// </summary>
internal static class FamilyElementsActions {
    /// <summary>
    ///     Collects all family elements (families, parameters, dimensions, ref planes, connectors).
    /// </summary>
    internal static IEnumerable<FamilyElementItem> CollectAllElements(FamilyDocument familyDoc) {
        // Nested Families
        foreach (var item in CollectFamilies(familyDoc))
            yield return item;

        // Family Parameters
        foreach (var item in CollectParameters(familyDoc))
            yield return item;

        // Dimensions
        foreach (var item in CollectDimensions(familyDoc))
            yield return item;

        // Reference Planes
        foreach (var item in CollectReferencePlanes(familyDoc))
            yield return item;

        // Connectors
        foreach (var item in CollectConnectors(familyDoc))
            yield return item;
    }

    /// <summary>
    ///     Collects nested family instances in the family document.
    /// </summary>
    internal static IEnumerable<FamilyElementItem> CollectFamilies(FamilyDocument familyDoc) {
        foreach (var instance in new FilteredElementCollector(familyDoc)
                     .OfClass(typeof(FamilyInstance))
                     .Cast<FamilyInstance>())
            yield return new FamilyElementItem(instance, familyDoc);
    }

    /// <summary>
    ///     Collects family parameters.
    /// </summary>
    internal static IEnumerable<FamilyElementItem> CollectParameters(FamilyDocument familyDoc) {
        foreach (var param in familyDoc.FamilyManager.Parameters.OfType<FamilyParameter>()
                     .OrderBy(p => p.Definition.Name))
            yield return new FamilyElementItem(param, familyDoc);
    }

    /// <summary>
    ///     Collects dimensions (excluding spot dimensions).
    /// </summary>
    internal static IEnumerable<FamilyElementItem> CollectDimensions(FamilyDocument familyDoc) {
        foreach (var dim in new FilteredElementCollector(familyDoc)
                     .OfClass(typeof(Dimension))
                     .Cast<Dimension>()
                     .Where(d => d is not SpotDimension))
            yield return new FamilyElementItem(dim, familyDoc);
    }

    /// <summary>
    ///     Collects reference planes.
    /// </summary>
    internal static IEnumerable<FamilyElementItem> CollectReferencePlanes(FamilyDocument familyDoc) {
        foreach (var refPlane in new FilteredElementCollector(familyDoc)
                     .OfClass(typeof(ReferencePlane))
                     .Cast<ReferencePlane>())
            yield return new FamilyElementItem(refPlane, familyDoc);
    }

    /// <summary>
    ///     Collects connector elements.
    /// </summary>
    internal static IEnumerable<FamilyElementItem> CollectConnectors(FamilyDocument familyDoc) {
        foreach (var connector in new FilteredElementCollector(familyDoc)
                     .OfClass(typeof(ConnectorElement))
                     .Cast<ConnectorElement>())
            yield return new FamilyElementItem(connector, familyDoc);
    }

    /// <summary>
    ///     Zooms to and selects an element in the view.
    /// </summary>
    internal static void HandleZoomToElement(FamilyElementItem? item) {
        var uidoc = DocumentManager.GetActiveUIDocument();
        if (item?.ElementId == null) return;
        uidoc.ShowElements(item.ElementId);
        uidoc.Selection.SetElementIds([item.ElementId]);
    }

    /// <summary>
    ///     Opens RevitLookup to snoop the selected element.
    /// </summary>
    internal static void HandleSnoop(FamilyElementItem? item) {
        if (item == null) return;
        object objectToSnoop = item.ElementType switch {
            FamilyElementType.Parameter => item.FamilyParam!,
            FamilyElementType.Connector => item.Connector!,
            FamilyElementType.Dimension => item.Dimension!,
            FamilyElementType.ReferencePlane => item.RefPlane!,
            FamilyElementType.Family => item.FamilyInstance!,
            _ => throw new InvalidOperationException($"Unknown element type: {item.ElementType}")
        };
        var doc = DocumentManager.GetActiveDocument();
        _ = RevitDbExplorerService.TrySnoopObject(doc, objectToSnoop, item.TextPrimary);
    }
}