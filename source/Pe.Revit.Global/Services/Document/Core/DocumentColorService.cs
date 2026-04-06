using System.Windows.Media;
using WpfColor = System.Windows.Media.Color;

namespace Pe.Global.Services.Document.Core;

/// <summary>
///     Service that provides color assignments for documents.
///     Colors are read from Revit UI (pyRevit tab colors) and cached in-memory for the session.
///     Cache is cleared when documents are closed to handle color reassignment.
///     Owned by DocumentManager - not a standalone singleton.
///     Note: No locking needed as Revit API is single-threaded.
/// </summary>
public class DocumentColorService {
    /// <summary>
    ///     Fallback color used when UI read fails. Using a consistent color
    ///     makes it obvious when color detection isn't working.
    /// </summary>
    private static readonly WpfColor FallbackColor = Colors.DimGray;

    private readonly Dictionary<string, WpfColor> _colorCache = new();

    /// <summary>
    ///     Gets the color for the specified document from cache or by reading from Revit UI.
    ///     Falls back to DimGray if UI read fails (makes detection failures obvious).
    /// </summary>
    public WpfColor GetOrCreateDocumentColor(Autodesk.Revit.DB.Document doc) {
        if (doc == null) return Colors.Gray;

        var docKey = GetDocumentKey(doc);

        // Check cache first
        if (this._colorCache.TryGetValue(docKey, out var cachedColor)) return cachedColor;


        // Try reading from Revit UI
        var uiColor = RevitTabColorReader.GetDocumentColorFromUI(doc);
        if (uiColor.HasValue) {
            this._colorCache[docKey] = uiColor.Value;
            return uiColor.Value;
        }

        // Fallback to consistent gray - makes it obvious when color detection fails
        this._colorCache[docKey] = FallbackColor;
        return FallbackColor;
    }

    /// <summary>
    ///     Removes a document from the color cache when it's closed.
    ///     This allows colors to be reassigned if the document is reopened.
    /// </summary>
    public void RemoveDocument(Autodesk.Revit.DB.Document doc) {
        if (doc == null) return;

        var docKey = GetDocumentKey(doc);
        _ = this._colorCache.Remove(docKey);
    }

    private static string GetDocumentKey(Autodesk.Revit.DB.Document doc) =>
        !string.IsNullOrEmpty(doc.PathName) ? doc.PathName : doc.Title;
}