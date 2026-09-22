using Autodesk.Revit.ApplicationServices;

namespace Pe.Revit.Extensions.ProjDocument;

public static class ApplicationDocumentExtensions {
    public static IEnumerable<Document> GetOpenDocuments(this Application application) =>
        application?.Documents.Cast<Document>() ?? [];

}
