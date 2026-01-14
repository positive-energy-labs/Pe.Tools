using Autodesk.Revit.UI;
using Autodesk.Revit.UI.Selection;

namespace Pe.Global.Revit.Lib;

public class Pickers {
    /// <summary>
    ///     Gets the unique families from selected FamilyInstance elements.
    ///     Only works when the document is not a family document.
    /// </summary>
    /// <param name="uiDocument">The UI document</param>
    /// <returns>
    ///     Result containing the list of unique families from selected instances, or an error if the document is a family
    ///     document
    /// </returns>
    public static List<Family> GetSelectedFamilies(UIDocument uiDocument) {
        var doc = uiDocument.Document;
        var selectedIds = uiDocument.Selection.GetElementIds();

        if (selectedIds.Count == 0)
            return new List<Family>();

        var families = selectedIds
            .Select(doc.GetElement)
            .OfType<FamilyInstance>()
            .Select(fi => fi.Symbol.Family)
            .Distinct()
            .ToList();

        return families;
    }

    public static Result<(Element element, Face elementFace, UV clickPosition)> FacePosition(
        UIApplication uiApplication,
        ISelectionFilter selectionFilter,
        string selectionPrompt
    ) {
        try {
            var uiDoc = uiApplication.ActiveUIDocument;
            var doc = uiDoc.Document;
            var reference = uiDoc.Selection.PickObject(
                ObjectType.Face,
                selectionFilter,
                $"SELECT A FACE POSITION ({selectionPrompt})"
            );

            var element = doc.GetElement(reference.ElementId);
            var face = element.GetGeometryObjectFromReference(reference) as Face;
            if (face == null)
                return new InvalidOperationException("Selected reference is not a face");

            return (element, face, reference.UVPoint);
        } catch (Exception e) {
            return e;
        }
    }

    public static Result<(Element element, Face elementFace)> Face(
        UIApplication uiApplication,
        ISelectionFilter selectionFilter,
        string selectionPrompt
    ) {
        try {
            var uiDoc = uiApplication.ActiveUIDocument;
            var doc = uiDoc.Document;
            var reference = uiDoc.Selection.PickObject(
                ObjectType.Face,
                selectionFilter,
                "SELECT A FACE (" + selectionPrompt + ")"
            );

            var element = doc.GetElement(reference.ElementId);
            var face = element.GetGeometryObjectFromReference(reference) as Face;
            if (face == null)
                return new InvalidOperationException("Selected reference is not a face");

            return (element, face);
        } catch (Exception e) {
            return e;
        }
    }
}