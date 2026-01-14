namespace Pe.Global.Services.Document.Core;

/// <summary>
///     Represents a reference to a view in a specific document.
///     Uses DocumentKey (path or title) to uniquely identify documents across sessions.
///     If activatedAt is not provided, Datetime.Now will be called internally
/// </summary>
public record ViewReference {
    public ViewReference(string documentTitle, string documentPath, ElementId viewId, DateTime? activatedAt = null) {
        this.DocumentTitle = documentTitle;
        this.DocumentPath = documentPath;
        this.ViewId = viewId;
        // Use title for family documents with temp paths (they get new temp paths each activation)
        // Use path for regular documents (more stable identifier)
        this.DocumentKey = IsTempOrFamilyPath(documentPath) ? documentTitle : documentPath;
        this.ActivatedAt = activatedAt ?? DateTime.Now;
    }

    public string DocumentTitle { get; }
    public string DocumentPath { get; }
    public ElementId ViewId { get; }
    public string DocumentKey { get; }
    public DateTime ActivatedAt { get; }

    public virtual bool Equals(ViewReference? other) {
        if (other == null) return false;
        return this.DocumentKey == other.DocumentKey && this.ViewId.Equals(other.ViewId);
    }

    /// <summary>
    ///     Determines if the path is a temp directory path or a family document.
    ///     Family documents saved to temp directories get new GUIDs each time, breaking equality checks.
    /// </summary>
    private static bool IsTempOrFamilyPath(string path) {
        if (string.IsNullOrEmpty(path)) return true;

        // Check for temp directory patterns (contains Temp folder and GUID-like subdirectories)
        var isTempPath = path.Contains(@"\Temp\", StringComparison.OrdinalIgnoreCase) ||
                         path.Contains(@"/Temp/", StringComparison.OrdinalIgnoreCase);

        // Family documents (.rfa) in temp paths are problematic
        var isFamilyInTemp = isTempPath && path.EndsWith(".rfa", StringComparison.OrdinalIgnoreCase);

        return isFamilyInTemp;
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