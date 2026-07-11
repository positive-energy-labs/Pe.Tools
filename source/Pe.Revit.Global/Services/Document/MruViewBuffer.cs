using Pe.Revit.Loader.Documents;

namespace Pe.Revit.Global.Services.Document;

/// <summary>
///     Most-recently-used view history across all open documents. Entries reference the SDK's
///     TrackedDocument, which survives SaveAs and temp-save/reopen — the identity heuristics this
///     buffer used to hand-roll (affinity keys, path/title fallback matching) are gone with it.
///     Fed by the tracker's ViewActivated event; purged by its Closed event.
///     Note: No locking needed as Revit API is single-threaded.
/// </summary>
public class MruViewBuffer {
    private const int MaxBufferSize = 50;

    // Threshold for view switching: 2s separates intentional navigation from transient views
    // (e.g. "Start Up Page" flashing past during a document switch).
    private static readonly TimeSpan MinViewDuration = TimeSpan.FromSeconds(2);

    private readonly List<ViewRef> _buffer = [];
    private ViewRef? _previous;
    private ViewRef? _prior; // The view before _previous (to detect doc boundary crossing)

    public static MruViewBuffer Instance { get; } = new();

    /// <summary>
    ///     Records a view activation. The previous view is committed to the buffer when it was
    ///     active >= 2s (intentional navigation), or under 2s without crossing a document
    ///     boundary (rapid same-doc navigation). Sub-2s views reached across a document boundary
    ///     are transients and filtered out.
    /// </summary>
    public void RecordViewActivation(TrackedDocument document, ElementId viewId) {
        if (viewId == null || viewId == ElementId.InvalidElementId) return;

        var newRef = new ViewRef(document, viewId, DateTime.Now);
        if (this._previous != null && !this._previous.SameView(newRef) &&
            ShouldCommit(this._previous, this._prior)) {
            _ = this._buffer.RemoveAll(v => v.SameView(this._previous));
            this._buffer.Insert(0, this._previous);
            if (this._buffer.Count > MaxBufferSize)
                this._buffer.RemoveRange(MaxBufferSize, this._buffer.Count - MaxBufferSize);
        }

        this._prior = this._previous;
        this._previous = newRef;
    }

    /// <summary>
    ///     All views in MRU order: current view first, then previous views by recency. Includes
    ///     views whose tabs are closed (selecting reopens them); documents that closed are gone
    ///     from the buffer already (Closed purge), so every entry resolves against a live doc.
    /// </summary>
    public IEnumerable<View> GetMruOrderedViews(UIApplication uiApp) {
        if (uiApp == null) return [];

        var views = new List<View>();
        var currentView = uiApp.GetActiveView();
        if (currentView != null)
            views.Add(currentView);

        foreach (var viewRef in this._buffer) {
            if (currentView != null && viewRef.ViewId == currentView.Id &&
                viewRef.Document.Matches(currentView.Document))
                continue;

            View? view = null;
            try {
                view = viewRef.Document.Resolve().GetElement(viewRef.ViewId) as View;
            } catch {
                // Entry raced a document close; the Closed purge will drop it.
            }

            if (view != null)
                views.Add(view);
        }

        return views;
    }

    /// <summary>Purges all views of a closed document. Wired to the tracker's Closed event.</summary>
    public void RemoveDocumentViews(DocumentKey key) {
        _ = this._buffer.RemoveAll(v => v.Document.Key == key);
        if (this._previous?.Document.Key == key)
            this._previous = null;
        if (this._prior?.Document.Key == key)
            this._prior = null;
    }

    /// <summary>Clears the MRU buffer (useful for testing or reset scenarios).</summary>
    public void Clear() => this._buffer.Clear();

    private static bool ShouldCommit(ViewRef previous, ViewRef? prior) {
        if (DateTime.Now - previous.ActivatedAt >= MinViewDuration)
            return true;

        // Sub-2s view: commit only when we stayed in the same document (rapid navigation).
        // TrackedDocument reference identity survives SaveAs, so no key heuristics needed.
        return prior == null || ReferenceEquals(previous.Document, prior.Document);
    }

    private sealed record ViewRef(TrackedDocument Document, ElementId ViewId, DateTime ActivatedAt) {
        public bool SameView(ViewRef? other) =>
            other != null && ReferenceEquals(this.Document, other.Document) && this.ViewId == other.ViewId;
    }
}
