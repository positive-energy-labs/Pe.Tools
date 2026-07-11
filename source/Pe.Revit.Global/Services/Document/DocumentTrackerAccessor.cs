using Pe.Revit.Loader.Documents;

namespace Pe.Revit.Global.Services.Document;

/// <summary>
///     Process-wide handle to the payload's SDK document tracker, set by AppCore at startup and
///     cleared at shutdown (same slot pattern as RevitTaskAccessor). The tracker itself is owned
///     and disposed by the SDK payload lifecycle.
/// </summary>
public static class DocumentTrackerAccessor {
    public static IDocumentTracker? Current { get; set; }
}

public static class DocumentTrackerExtensions {
    /// <summary>
    ///     Finds the tracked document for a live wrapper. Wrapper identity, not reference
    ///     equality — safe with a Document obtained from any event or request.
    /// </summary>
    public static TrackedDocument? Find(this IDocumentTracker tracker, Autodesk.Revit.DB.Document document) {
        foreach (var tracked in tracker.Open) {
            if (tracked.Matches(document))
                return tracked;
        }

        return null;
    }
}
