namespace Pe.Revit.Extensions.ProjDocument;

public static class DocumentNamingExtensions {
    public static string GetDocumentTitleStem(this Document doc) {
        if (doc == null)
            throw new ArgumentNullException(nameof(doc));

        var pathStem = Path.GetFileNameWithoutExtension(doc.PathName);
        if (!string.IsNullOrWhiteSpace(pathStem))
            return pathStem;

        var titleStem = Path.GetFileNameWithoutExtension(doc.Title);
        if (!string.IsNullOrWhiteSpace(titleStem))
            return titleStem;

        return string.IsNullOrWhiteSpace(doc.Title) ? "Document" : doc.Title;
    }

    public static string GetFamilyDisplayName(this Document doc) {
        if (doc == null)
            throw new ArgumentNullException(nameof(doc));

        if (!doc.IsFamilyDocument)
            return doc.GetDocumentTitleStem();

        try {
            var familyName = doc.OwnerFamily?.Name?.Trim();
            if (!string.IsNullOrWhiteSpace(familyName))
                return familyName;
        } catch {
            // Fall back to the document title/path stem when owner-family access is unavailable.
        }

        return doc.GetDocumentTitleStem();
    }

    public static string GetFamilyFileStem(this Document doc) {
        if (doc == null)
            throw new ArgumentNullException(nameof(doc));

        var invalidChars = Path.GetInvalidFileNameChars();
        var sanitized = new string(doc.GetFamilyDisplayName()
                .Select(ch => invalidChars.Contains(ch) ? '_' : ch)
                .ToArray())
            .Trim();

        return string.IsNullOrWhiteSpace(sanitized) ? "Family" : sanitized;
    }
}
