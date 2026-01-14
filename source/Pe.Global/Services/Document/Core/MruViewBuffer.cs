using Pe.Global.PolyFill;

namespace Pe.Global.Services.Document.Core;

/// <summary>
///     Manages the Most Recently Used (MRU) view buffer for tracking view activation history.
///     Uses <see cref="DocumentManager" /> static methods for all document/view state queries.
///     Note: No locking needed as Revit API is single-threaded.
/// </summary>
public class MruViewBuffer {
    private const int MaxBufferSize = 50;
    private static readonly TimeSpan MinViewDuration = TimeSpan.FromSeconds(3);

    private readonly List<ViewReference> _buffer = [];

    private ViewReference _previousViewRef;

    /// <summary>
    ///     Records a view activation. The previous view is only added to the MRU buffer if
    ///     it was active for at least 3 seconds. This filters out intermediate/transient views
    ///     that Revit briefly activates during document switching (usually less than 1 second).
    ///     Views the user intentionally navigates to will typically be active for more than 3 seconds.
    /// </summary>
    public void RecordViewActivation(Autodesk.Revit.DB.Document doc, ElementId viewId) {
        if (doc == null || viewId == null || viewId == ElementId.InvalidElementId) return;

        var newViewRef = new ViewReference(doc.Title, doc.PathName, viewId);

        if (this._previousViewRef != null && !this._previousViewRef.Equals(newViewRef)) {
            if (this.ShouldCommitPreviousView(this._previousViewRef)) {
                _ = this._buffer.RemoveAll(v => v.Equals(this._previousViewRef));
                this._buffer.Insert(0, this._previousViewRef);
                this.TrimBuffer();
            }
        }

        this._previousViewRef = newViewRef;
    }

    /// <summary>
    ///     Gets all views in MRU order (most recently used first) from all open documents.
    ///     The current view is always first, followed by previous views in order of use.
    ///     Only returns views that are currently open as tabs.
    /// </summary>
    public IEnumerable<View> GetMruOrderedViews(UIApplication uiApp) {
        if (uiApp == null) return [];

        var views = new List<View>();
        // Track seen views by DocumentKey + ViewId to prevent duplicates (same ViewId can exist in different docs)
        var seenViews = new HashSet<string>();
        var currentView = DocumentManager.GetActiveView();

        // Add current view first if it exists and is open
        if (currentView != null && DocumentManager.IsViewOpen(currentView.Id)) {
            var currentViewKey = $"{GetDocumentKey(currentView.Document)}|{currentView.Id.Value()}";
            views.Add(currentView);
            _ = seenViews.Add(currentViewKey);
        }

        // Add views from buffer (previous views, in MRU order)
        foreach (var viewRef in this._buffer) {
            // Skip if we've already added this view (prevent duplicates)
            var viewKey = $"{viewRef.DocumentKey}|{viewRef.ViewId.Value()}";
            if (seenViews.Contains(viewKey)) continue;

            var targetDoc = DocumentManager.FindDocumentByName(viewRef.DocumentTitle);
            if (targetDoc == null) continue;
            if (!DocumentManager.IsViewOpen(viewRef.ViewId)) continue;
            if (targetDoc.GetElement(viewRef.ViewId) is not View view) continue;

            views.Add(view);
            _ = seenViews.Add(viewKey);
        }

        return views;
    }

    /// <summary>
    ///     Removes all views from a specific document (e.g., when document is closed).
    /// </summary>
    public void RemoveDocumentViews(Autodesk.Revit.DB.Document doc) {
        if (doc == null) return;

        var docKey = GetDocumentKey(doc);
        _ = this._buffer.RemoveAll(v => v.DocumentKey == docKey);
        if (this._previousViewRef?.DocumentKey == docKey)
            this._previousViewRef = null;
    }

    /// <summary>
    ///     Clears the MRU buffer (useful for testing or reset scenarios).
    /// </summary>
    public void Clear() => this._buffer.Clear();

    /// <summary>
    ///     Determines if the previous view should be committed to the MRU buffer.
    ///     Returns true ONLY if the previous view was active for at least MinViewDuration.
    ///     This filters out transient/intermediate views that Revit briefly activates during
    ///     document switching (which are typically active for less than a second).
    ///     NOTE: We previously also committed views that were "still open as a tab", but that
    ///     condition was too permissive - it matched ALL views in open documents, causing
    ///     intermediate views to pollute the MRU buffer.
    /// </summary>
    private bool ShouldCommitPreviousView(ViewReference previousViewRef) {
        if (previousViewRef == null) return false;

        // Only commit views that were active long enough to indicate intentional navigation
        var duration = DateTime.Now - previousViewRef.ActivatedAt;
        var wasOpenLongEnough = duration >= MinViewDuration;

        Debug.WriteLine(
            $"[MruViewBuffer] ShouldCommit '{previousViewRef.DocumentTitle}' viewId={previousViewRef.ViewId.Value()}: " +
            $"duration={duration.TotalSeconds:F1}s, minRequired={MinViewDuration.TotalSeconds}s, commit={wasOpenLongEnough}");

        return wasOpenLongEnough;
    }

    private void TrimBuffer() {
        if (this._buffer.Count > MaxBufferSize)
            this._buffer.RemoveRange(MaxBufferSize, this._buffer.Count - MaxBufferSize);
    }

    /// <summary>
    ///     Gets a stable key for a document. Uses Title for family documents with temp paths
    ///     (they get new temp paths each activation), otherwise uses PathName.
    /// </summary>
    private static string GetDocumentKey(Autodesk.Revit.DB.Document doc) {
        var path = doc.PathName;
        if (string.IsNullOrEmpty(path)) return doc.Title;

        // Family documents in temp paths get new GUIDs each time, use Title instead
        var isTempPath = path.Contains(@"\Temp\", StringComparison.OrdinalIgnoreCase) ||
                         path.Contains(@"/Temp/", StringComparison.OrdinalIgnoreCase);
        var isFamilyInTemp = isTempPath && path.EndsWith(".rfa", StringComparison.OrdinalIgnoreCase);

        return isFamilyInTemp ? doc.Title : path;
    }
}