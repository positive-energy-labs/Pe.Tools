using Autodesk.Revit.UI;

namespace Pe.Revit.Extensions.ProjDocument;

public static class UIApplicationDocumentSessionExtensions {
    public static IntPtr GetActiveWindowHandle(this UIApplication uiApp) =>
        uiApp?.MainWindowHandle ?? IntPtr.Zero;

    public static UIDocument? GetActiveUIDocument(this UIApplication uiApp) =>
        uiApp?.ActiveUIDocument;

    public static Document? GetActiveDocument(this UIApplication uiApp) =>
        uiApp.GetActiveUIDocument()?.Document;

    public static View? GetActiveView(this UIApplication uiApp) =>
        uiApp.GetActiveUIDocument()?.ActiveView;

    public static IEnumerable<Document> GetOpenDocuments(this UIApplication uiApp) =>
        uiApp?.Application.Documents.Cast<Document>() ?? [];

    public static IEnumerable<UIView> GetOpenUiViews(this UIApplication uiApp) =>
        uiApp.GetOpenDocuments().SelectMany(doc => {
            try {
                return new UIDocument(doc).GetOpenUIViews();
            } catch {
                return [];
            }
        });

    public static bool IsDocumentOpen(this UIApplication uiApp, Document doc) {
        if (uiApp == null || doc == null)
            return false;

        return uiApp.GetOpenDocuments().Any(openDoc =>
            ReferenceEquals(openDoc, doc) ||
            string.Equals(openDoc.GetDocumentKey(), doc.GetDocumentKey(), StringComparison.OrdinalIgnoreCase));
    }

    public static bool IsDocumentActive(this UIApplication uiApp, Document doc) {
        if (uiApp == null || doc == null)
            return false;

        var activeDocument = uiApp.GetActiveDocument();
        if (activeDocument == null)
            return false;

        return ReferenceEquals(activeDocument, doc) ||
               string.Equals(activeDocument.GetDocumentKey(), doc.GetDocumentKey(), StringComparison.OrdinalIgnoreCase);
    }

    public static Document? FindOpenFamilyDocument(this UIApplication uiApp, Family family) {
        if (uiApp == null || family == null)
            return null;

        return uiApp.GetOpenDocuments().FirstOrDefault(doc =>
            doc.IsFamilyDocument &&
            doc.Title.Contains(family.Name, StringComparison.OrdinalIgnoreCase));
    }

    public static Document? FindOpenDocumentByPath(this UIApplication uiApp, string documentPath) {
        if (uiApp == null || string.IsNullOrWhiteSpace(documentPath))
            return null;

        return uiApp.GetOpenDocuments().FirstOrDefault(doc =>
            string.Equals(doc.GetDocumentPath(), documentPath, StringComparison.OrdinalIgnoreCase) ||
            string.Equals(doc.PathName, documentPath, StringComparison.OrdinalIgnoreCase));
    }

    public static string LogDocumentState(this UIApplication uiApp, View? targetView = null, string? context = null) {
        var sb = new StringBuilder();
        if (!string.IsNullOrEmpty(context))
            _ = sb.AppendLine($"=== {context} ===");
        _ = sb.AppendLine("=== Document State ===");

        var activeDocument = uiApp.GetActiveDocument();
        var activeView = uiApp.GetActiveView();
        var openDocuments = uiApp.GetOpenDocuments().ToList();
        var openUiViews = uiApp.GetOpenUiViews().ToList();

        if (targetView != null) {
            _ = sb.AppendLine($"Target Document: {targetView.Document.Title} (Path: {targetView.Document.PathName})")
                .AppendLine($"Target View: {targetView.Name} (ID: {targetView.Id.Value()})");
        }

        _ = sb.AppendLine(
                $"Active Document: {activeDocument?.Title ?? "None"} (Path: {activeDocument?.PathName ?? "N/A"})")
            .AppendLine($"Active View: {activeView?.Name ?? "None"} (ID: {activeView?.Id.Value() ?? -1})")
            .AppendLine(
                $"Open Documents ({openDocuments.Count}): {string.Join("\n  - ", openDocuments.Select(doc => $"{doc.Title} (Path: {doc.PathName})"))}")
            .AppendLine(
                $"Open Views ({openUiViews.Count}): {string.Join("\n  - ", openUiViews.Select(view => view.ViewId.Value()))}");

        return sb.ToString();
    }
}
