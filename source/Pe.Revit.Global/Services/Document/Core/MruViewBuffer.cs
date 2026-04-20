namespace Pe.Revit.Global.Services.Document.Core;

/// <summary>
///     Manages the Most Recently Used (MRU) view buffer for tracking view activation history.
///     Uses session helpers for active/open state and the shared document key extension for document identity.
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
    ///     2. If active
    ///     < 2s AND we crossed a document boundary to get to it: Filter out ( transient during doc switch)
    ///         3. If active
    ///     < 2s AND stayed in same document: Commit ( rapid same-doc navigation)
    /// </summary>
    public void RecordViewActivation(Autodesk.Revit.DB.Document doc, ElementId viewId) {
        if (doc == null || viewId == null || viewId == ElementId.InvalidElementId) return;

        var newViewRef = new ViewReference(
            doc.Title,
            doc.GetDocumentPath() ?? doc.PathName,
            doc.GetDocumentKey(),
            doc.GetDocumentMruAffinityKey(),
            viewId);

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
        var currentView = uiApp.GetActiveView();

        // Add current view first if it exists
        if (currentView != null) {
            var currentViewKey = $"{currentView.Document.GetDocumentKey()}|{currentView.Id.Value()}";
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
            var targetDoc = this.FindBufferedDocument(uiApp, viewRef);
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

        var docKey = doc.GetDocumentKey();
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
    ///     2. Views active
    ///     < 2s where we CROSSED document boundary to get to them: Filter out ( transient during doc switch)
    ///         3. Views active
    ///     < 2s within same document: Commit ( rapid same-doc navigation)
    ///         Example: DocA View1 → DocB StartUpPage (0.1 s) → DocB View2
    ///         When deciding about StartUpPage, we check:
    ///         - priorViewRef= DocA View1 ( the view before StartUpPage)
    ///         - previousViewRef= DocB StartUpPage ( the view we're deciding about)
    ///     - StartUpPage' s doc !=
    ///         priorView's doc → crossed boundary → FILTER OUT ✅
    /// 
    /// 
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
            var crossedDocBoundary = !string.Equals(
                previousViewRef.DocumentMruAffinityKey,
                priorViewRef.DocumentMruAffinityKey,
                StringComparison.OrdinalIgnoreCase);

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

    private Autodesk.Revit.DB.Document? FindBufferedDocument(UIApplication uiApp, ViewReference viewRef) {
        var exactDocument = uiApp.FindOpenDocumentByKey(viewRef.DocumentKey) ??
                            uiApp.FindOpenDocumentByPath(viewRef.DocumentPath);
        if (exactDocument != null)
            return exactDocument;

        var affinityMatches = uiApp.GetOpenDocuments()
            .Where(doc => string.Equals(doc.GetDocumentMruAffinityKey(), viewRef.DocumentMruAffinityKey,
                StringComparison.OrdinalIgnoreCase))
            .ToList();
        if (affinityMatches.Count == 1)
            return affinityMatches[0];

        var titleMatches = uiApp.GetOpenDocuments()
            .Where(doc => string.Equals(doc.Title, viewRef.DocumentTitle, StringComparison.OrdinalIgnoreCase))
            .ToList();
        return titleMatches.Count == 1 ? titleMatches[0] : null;
    }
}