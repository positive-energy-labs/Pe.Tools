using Pe.Revit.Global.PolyFill;
using Pe.Revit.Global.Revit.Documents;
using Pe.Revit.Global.Services.Document.Core;
using Color = System.Windows.Media.Color;

namespace Pe.Revit.Global.Services.Document;

/// <summary>
///     Session-aware document service for active/open window state and MRU tracking.
///     Pure document-owned helpers live in <see cref="Pe.Revit.Global.Revit.Documents" /> and remain available here
///     only as compatibility delegates while callers migrate.
///     Note: No locking needed as Revit API is single-threaded.
/// </summary>
public class DocumentManager {
    private readonly DocumentColorService _colorService = new();
    private readonly MruViewBuffer _mruBuffer = new();

    private DocumentManager() { }

    public static UIApplication uiapp => RevitUiSession.CurrentUIApplication;

    public static DocumentManager Instance {
        get {
            field ??= new DocumentManager();
            return field;
        }
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

        Console.WriteLine($"[DocumentManager] OnDocumentClosed: '{doc.Title}'");

        // Clean up MRU buffer
        Console.WriteLine("[DocumentManager] Removing from MRU buffer...");
        this._mruBuffer.RemoveDocumentViews(doc);

        // Clean up color cache
        Console.WriteLine("[DocumentManager] Removing from color cache...");
        this._colorService.RemoveDocument(doc);

        Console.WriteLine("[DocumentManager] OnDocumentClosed complete");
    }
}
