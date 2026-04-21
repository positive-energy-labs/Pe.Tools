using Autodesk.Revit.ApplicationServices;

namespace Pe.Revit.Global.Revit.Documents;

public static class ApplicationDocumentExtensions {
    public static IEnumerable<Document> GetOpenDocuments(this Application application) =>
        application?.Documents.Cast<Document>() ?? [];

    public static Document? FindOpenFamilyDocument(this Application application, Family family) {
        if (application == null || family == null)
            return null;

        return application.GetOpenDocuments().FirstOrDefault(document =>
            document.IsFamilyDocument &&
            document.Title.Contains(family.Name, StringComparison.OrdinalIgnoreCase));
    }
}
