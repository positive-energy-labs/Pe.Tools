using Pe.Global.PolyFill;

namespace Pe.Global.Services.Document.Core;

/// <summary>
///     Manages the Most Recently Used (MRU) view buffer for tracking view activation history.
///     Uses <see cref="DocumentManager" /> static methods for all document/view state queries.
///     Note: No locking needed as Revit API is single-threaded.
/// </summary>
public class MruViewBuffer {
    private const int MaxBufferSize = 50;
    // Threshold for same-document switching: 2s captures rapid user navigation
    // Threshold for cross-document switching: 2s filters out transient "Start Up Page" views
    private static readonly TimeSpan MinViewDuration = TimeSpan.FromSeconds(2);

    private readonly List<ViewReference> _buffer = [];

    private ViewReference? _previousViewRef;
    private ViewReference? _priorViewRef; // The view before _previousViewRef (to detect doc boundary crossing)

    /// <summary>
    ///     Records a view activation. The previous view is committed to the MRU buffer based on:
    ///     1. If active >= 2s: Always commit (intentional navigation)
    ///     2. If active < 2s AND we crossed a document boundary to get to it: Filter out (transient during doc switch)
    ///     3. If active < 2s AND stayed in same document: Commit (rapid same-doc navigation)
    /// </summary>
    public void RecordViewActivation(Autodesk.Revit.DB.Document doc, ElementId viewId) {
        if (doc == null || viewId == null || viewId == ElementId.InvalidElementId) return;

        var newViewRef = new ViewReference(doc.Title, doc.PathName, viewId);

        if (this._previousViewRef != null && !this._previousViewRef.Equals(newViewRef)) {
            if (this.ShouldCommitPreviousView(this._previousViewRef, this._priorViewRef)) {
                _ = this._buffer.RemoveAll(v => v.Equals(this._previousViewRef));
                this._buffer.Insert(0, this._previousViewRef);
                this.TrimBuffer();
            }
        }

        // Shift the view history: prior <- previous <- new
        this._priorViewRef = this._previousViewRef;
        this._previousViewRef = newViewRef;
    }

    /// <summary>
    ///     Gets all views in MRU order (most recently used first) from all open documents.
    ///     The current view is always first, followed by previous views in order of use.
    ///     Returns ALL views from the buffer history, even if their tabs are currently closed.
    ///     Views from closed documents are excluded.
    /// </summary>
    public IEnumerable<View> GetMruOrderedViews(UIApplication uiApp) {
        if (uiApp == null) return [];

        var views = new List<View>();
        // Track seen views by DocumentKey + ViewId to prevent duplicates (same ViewId can exist in different docs)
        var seenViews = new HashSet<string>();
        var currentView = DocumentManager.GetActiveView();

        // Add current view first if it exists
        if (currentView != null) {
            var currentViewKey = $"{GetDocumentKey(currentView.Document)}|{currentView.Id.Value()}";
            views.Add(currentView);
            _ = seenViews.Add(currentViewKey);
        }

        // Add views from buffer (previous views, in MRU order)
        // IMPORTANT: Don't filter by IsViewOpen() - we want to show ALL recently used views,
        // even if their tabs are currently closed. The user can re-open them by selecting.
        foreach (var viewRef in this._buffer) {
            // Skip if we've already added this view (prevent duplicates)
            var viewKey = $"{viewRef.DocumentKey}|{viewRef.ViewId.Value()}";
            if (seenViews.Contains(viewKey)) continue;

            // Only skip if the document is closed (view can't be accessed)
            var targetDoc = DocumentManager.FindDocumentByName(viewRef.DocumentTitle);
            if (targetDoc == null) continue;
            
            // Get the view element - this works even if the view tab is closed
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
        if (this._priorViewRef?.DocumentKey == docKey)
            this._priorViewRef = null;
    }

    /// <summary>
    ///     Clears the MRU buffer (useful for testing or reset scenarios).
    /// </summary>
    public void Clear() => this._buffer.Clear();

    /// <summary>
    ///     Determines if the previous view should be committed to the MRU buffer.
    ///     Strategy:
    ///     1. Views active >= 2s: Always commit (intentional navigation)
    ///     2. Views active < 2s where we CROSSED document boundary to get to them: Filter out (transient during doc switch)
    ///     3. Views active < 2s within same document: Commit (rapid same-doc navigation)
    ///     
    ///     Example: DocA View1 → DocB StartUpPage (0.1s) → DocB View2
    ///     When deciding about StartUpPage, we check:
    ///     - priorViewRef = DocA View1 (the view before StartUpPage)
    ///     - previousViewRef = DocB StartUpPage (the view we're deciding about)
    ///     - StartUpPage's doc != priorView's doc → crossed boundary → FILTER OUT ✅
    /// </summary>
    private bool ShouldCommitPreviousView(ViewReference previousViewRef, ViewReference? priorViewRef) {
        if (previousViewRef == null) return false;

        var duration = DateTime.Now - previousViewRef.ActivatedAt;
        
        // Always commit views that were active for 2s+ (intentional navigation)
        if (duration >= MinViewDuration) {
            Console.WriteLine(
                $"[MruViewBuffer] ShouldCommit '{previousViewRef.DocumentTitle}' viewId={previousViewRef.ViewId.Value()}: " +
                $"duration={duration.TotalSeconds:F1}s → commit=True (>= 2s threshold)");
            return true;
        }

        // For views < 2s: check if we crossed a document boundary to get to this view
        // Compare the view we're deciding about (previousViewRef) with the view BEFORE it (priorViewRef)
        if (priorViewRef != null) {
            var crossedDocBoundary = previousViewRef.DocumentKey != priorViewRef.DocumentKey;

            Console.WriteLine(
                $"[MruViewBuffer] ShouldCommit '{previousViewRef.DocumentTitle}' viewId={previousViewRef.ViewId.Value()}: " +
                $"duration={duration.TotalSeconds:F1}s, crossedBoundary={crossedDocBoundary} (from '{priorViewRef.DocumentTitle}') → commit={!crossedDocBoundary}");

            // Crossed boundary: likely transient "Start Up Page" → filter out
            // Same document: rapid navigation → commit
            return !crossedDocBoundary;
        }

        // No prior view to compare against - commit by default (likely first view of session)
        Console.WriteLine(
            $"[MruViewBuffer] ShouldCommit '{previousViewRef.DocumentTitle}' viewId={previousViewRef.ViewId.Value()}: " +
            $"duration={duration.TotalSeconds:F1}s → commit=True (no prior view to compare)");
        return true;
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