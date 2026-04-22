namespace Pe.Revit.Global.Services.Document;

/// <summary>
///     Represents a reference to a view in a specific document.
///     Stores the canonical document key alongside title/path snapshot data for diagnostics and lookup.
///     If activatedAt is not provided, DateTime.Now will be called internally.
/// </summary>
public record ViewReference {
    public ViewReference(
        string documentTitle,
        string documentPath,
        string documentKey,
        string documentMruAffinityKey,
        ElementId viewId,
        DateTime? activatedAt = null
    ) {
        this.DocumentTitle = documentTitle;
        this.DocumentPath = documentPath;
        this.DocumentKey = documentKey;
        this.DocumentMruAffinityKey = documentMruAffinityKey;
        this.ViewId = viewId;
        this.ActivatedAt = activatedAt ?? DateTime.Now;
    }

    public string DocumentTitle { get; }
    public string DocumentPath { get; }
    public ElementId ViewId { get; }
    public string DocumentKey { get; }
    public string DocumentMruAffinityKey { get; }
    public DateTime ActivatedAt { get; }

    public virtual bool Equals(ViewReference? other) {
        if (other == null) return false;
        return this.DocumentKey == other.DocumentKey && this.ViewId.Equals(other.ViewId);
    }

    public override int GetHashCode() {
        unchecked {
            var hash = 17;
            hash = (hash * 31) + this.DocumentKey.GetHashCode();
            hash = (hash * 31) + this.ViewId.GetHashCode();
            return hash;
        }
    }
}