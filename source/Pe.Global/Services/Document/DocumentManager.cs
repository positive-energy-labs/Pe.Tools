using Autodesk.Revit.UI.Events;
using Pe.Global.PolyFill;
using Pe.Global.Services.Document.Core;
using Color = System.Windows.Media.Color;

namespace Pe.Global.Services.Document;

/// <summary>
///     Singleton service for managing documents and tracking view activation history (MRU).
///     Provides document state queries (static methods) and delegates MRU buffer management to MruViewBuffer.
///     Note: No locking needed as Revit API is single-threaded.
/// </summary>
public class DocumentManager {
    private static DocumentManager _instance;
    private readonly DocumentColorService _colorService = new();
    private readonly MruViewBuffer _mruBuffer = new();


    private DocumentManager() { }

    public static UIApplication uiapp => new RibbonItemEventArgs().Application;

    public static DocumentManager Instance {
        get {
            _instance ??= new DocumentManager();
            return _instance;
        }
    }

    /// <summary>Gets the active document from the UIApplication. </summary>
    public static Autodesk.Revit.DB.Document GetActiveDocument() => uiapp?.ActiveUIDocument?.Document;

    /// <summary>Gets the active view from the UIApplication. </summary>
    public static View GetActiveView() => uiapp?.ActiveUIDocument?.ActiveView;


    /// <summary>Gets all open documents from the UIApplication. </summary>
    public static IEnumerable<Autodesk.Revit.DB.Document> GetOpenDocuments() =>
        uiapp?.Application.Documents.Cast<Autodesk.Revit.DB.Document>() ?? [];

    /// <summary>Gets all open UIViews across all documents. </summary>
    public static IEnumerable<UIView> GetOpenUiViews() =>
        GetOpenDocuments().SelectMany(d => {
            try {
                var uiDoc = new UIDocument(d);
                return uiDoc.GetOpenUIViews();
            } catch {
                return [];
            }
        });

    /// <summary>Gets all open view ElementIds across all documents. </summary>
    public static IEnumerable<ElementId> GetOpenViewIds() =>
        GetOpenUiViews().Select(v => v.ViewId);

    /// <summary>Checks if a document is open. </summary>
    public static bool IsDocumentOpen(Autodesk.Revit.DB.Document doc) =>
        GetOpenDocuments().Any(d => d.Title == doc.Title);

    /// <summary>Checks if a document is the active document. </summary>
    public static bool IsDocumentActive(Autodesk.Revit.DB.Document doc) =>
        GetActiveDocument()?.Title == doc.Title;

    /// <summary>Checks if a view (by ElementId) is currently open as a tab. </summary>
    public static bool IsViewOpen(ElementId viewId) =>
        GetOpenViewIds().Contains(viewId);

    /// <summary>Finds an open document by title or path name. </summary>
    public static Autodesk.Revit.DB.Document FindDocumentByName(string name) =>
        GetOpenDocuments().FirstOrDefault(d => d.Title == name || d.Title.Contains(name));

    /// <summary>
    ///     Finds an open family document matching the given Family.
    ///     (partial match on Title because title is the file name, e.g., "Building.rvt" or "Family.rfa").
    /// </summary>
    public static Autodesk.Revit.DB.Document FindOpenFamilyDocument(Family family) =>
        GetOpenDocuments().FirstOrDefault(d => d.IsFamilyDocument && d.Title.Contains(family.Name));

    /// <summary>Gets the ModelPath for a document (cloud or file-based).</summary>
    public static ModelPath GetDocumentModelPath(Autodesk.Revit.DB.Document doc) =>
        doc switch {
            { IsModelInCloud: true } => doc.GetCloudModelPath(),
            { PathName.Length: > 0 } => new FilePath(doc.PathName),
            _ => null // Return null for unsaved documents (like newly opened family docs)
        };

    public static string LogDocumentState(View view = null, string context = null) {
        var sb = new StringBuilder();
        if (!string.IsNullOrEmpty(context)) _ = sb.AppendLine($"=== {context} ===");
        _ = sb.AppendLine("=== Document State ===");

        var activeDoc = GetActiveDocument();
        var activeView = GetActiveView();
        var activeViewId = activeView?.Id;
        var openDocs = GetOpenDocuments().ToList();
        var openUiViews = GetOpenUiViews().ToList();

        if (view != null) {
            _ = sb.AppendLine($"Target Document: {view.Document.Title} (Path: {view.Document.PathName})")
                .AppendLine($"Target View: {view.Name} (ID: {view.Id.Value()})");
        }

        _ = sb.AppendLine($"Active Document: {activeDoc?.Title ?? "None"} (Path: {activeDoc?.PathName ?? "N/A"})")
            .AppendLine($"Active View: {activeView?.Name ?? "None"} (ID: {activeViewId?.Value() ?? -1})")
            .AppendLine(
                $"Open Documents ({openDocs.Count}): {string.Join("\n  - ", openDocs.Select(d => $"{d.Title} (Path: {d.PathName})"))}")
            .AppendLine(
                $"Open Views ({openUiViews.Count}): {string.Join("\n  - ", openUiViews.Select(v => v.ViewId.Value()))}");

        return sb.ToString();
    }

    public static string LogDocumentDetails(Autodesk.Revit.DB.Document doc, string context = null) {
        var sb = new StringBuilder();
        if (!string.IsNullOrEmpty(context)) _ = sb.AppendLine($"=== {context} ===");
        _ = sb.AppendLine("=== Document Details ===");

        _ = sb.AppendLine($"Title: {doc.Title}")
            .AppendLine($"PathName: {doc.PathName ?? "(empty)"}")
            .AppendLine($"IsFamilyDocument: {doc.IsFamilyDocument}")
            .AppendLine($"IsModelInCloud: {doc.IsModelInCloud}")
            .AppendLine($"IsModifiable: {doc.IsModifiable}")
            .AppendLine($"IsReadOnly: {doc.IsReadOnly}")
            .AppendLine($"IsWorkshared: {doc.IsWorkshared}");

        var modelPath = GetDocumentModelPath(doc);
        if (modelPath != null) {
            _ = sb.AppendLine($"ModelPath Type: {modelPath.GetType().Name}");
            var userPath = ModelPathUtils.ConvertModelPathToUserVisiblePath(modelPath);
            _ = sb.AppendLine($"UserVisiblePath: {userPath}");
            _ = sb.AppendLine($"ServerPath: {modelPath.ServerPath}");
        } else
            _ = sb.AppendLine("ModelPath: null (unsaved document)");

        return sb.ToString();
    }


    /// <summary>
    ///     Records a view activation. The previous view is only added to the MRU buffer if
    ///     it meets the criteria (active for >= 3 seconds or currently open as a tab).
    /// </summary>
    public void RecordViewActivation(Autodesk.Revit.DB.Document doc, ElementId viewId) =>
        this._mruBuffer.RecordViewActivation(doc, viewId);

    /// <summary>
    ///     Gets all views in MRU order (most recently used first) from all open documents.
    ///     The current view is always first, followed by previous views in order of use.
    ///     Only returns views that are currently open as tabs.
    /// </summary>
    public IEnumerable<View> GetMruOrderedViews(UIApplication uiApp) =>
        this._mruBuffer.GetMruOrderedViews(uiApp);

    /// <summary>
    ///     Gets the color for the specified document (from pyRevit tab colors).
    ///     Delegates to DocumentColorService.
    /// </summary>
    public Color GetDocumentColor(Autodesk.Revit.DB.Document doc) =>
        this._colorService.GetOrCreateDocumentColor(doc);


    /// <summary>
    ///     Handles document close cleanup. Call this from the DocumentClosing event handler.
    ///     Cleans up both MRU buffer and color cache for the closed document.
    /// </summary>
    public void OnDocumentClosed(Autodesk.Revit.DB.Document doc) {
        if (doc == null) return;

        Debug.WriteLine($"[DocumentManager] OnDocumentClosed: '{doc.Title}'");

        // Clean up MRU buffer
        Debug.WriteLine("[DocumentManager] Removing from MRU buffer...");
        this._mruBuffer.RemoveDocumentViews(doc);

        // Clean up color cache
        Debug.WriteLine("[DocumentManager] Removing from color cache...");
        this._colorService.RemoveDocument(doc);

        Debug.WriteLine("[DocumentManager] OnDocumentClosed complete");
    }
}