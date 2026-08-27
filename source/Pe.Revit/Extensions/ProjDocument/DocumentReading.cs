using Pe.Shared.RevitData;

namespace Pe.Revit.Extensions.ProjDocument;

public static class DocumentReading {
    public static Reading Here(Document document) {
        var at = document.GetCloudModelGuid()
                 ?? document.GetDocumentPath()
                 ?? throw new InvalidOperationException(
                     "The Revit document has no cloud model GUID or absolute path.");
        var version = Document.GetDocumentVersion(document).VersionGUID.ToString("D");
        return new Reading(at, version, DateTime.UtcNow.ToString("O"));
    }
}
