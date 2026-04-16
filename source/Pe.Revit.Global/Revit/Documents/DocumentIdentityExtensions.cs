namespace Pe.Revit.Global.Revit.Documents;

public static class DocumentIdentityExtensions {
    /// <summary>
    /// Returns <c>doc.ParameterBindings</c> as an IEnumerable of <c>(Definition, ElementBinding)</c>.
    /// Revit exposes <c>DefinitionBindingMapIterator</c>, which is awkward for LINQ and composition.
    /// </summary>
    public static IEnumerable<(Definition definition, ElementBinding binding)> GetProjectParameterBindings(
        this Document doc
    ) {
        if (doc == null)
            throw new ArgumentNullException(nameof(doc));
        if (doc.IsFamilyDocument)
            yield break;

        var iterator = doc.ParameterBindings.ForwardIterator();
        while (iterator.MoveNext()) {
            if (iterator is { Key: { } definition, Current: ElementBinding binding })
                yield return (definition, binding);
        }
    }

    public static ModelPath? GetDocumentModelPath(this Document doc) {
        if (doc == null)
            throw new ArgumentNullException(nameof(doc));

        try {
            if (doc.IsWorkshared)
                return doc.GetWorksharingCentralModelPath();
        } catch {
            // Fall through to non-workshared path handling.
        }

        return doc switch {
            { IsModelInCloud: true } => doc.GetCloudModelPath(),
            { PathName.Length: > 0 } => new FilePath(doc.PathName),
            _ => null
        };
    }

    public static string? GetDocumentPath(this Document doc) {
        if (doc == null)
            throw new ArgumentNullException(nameof(doc));

        try {
            var modelPath = doc.GetDocumentModelPath();
            if (modelPath == null)
                return string.IsNullOrWhiteSpace(doc.PathName) ? null : doc.PathName;

            var userVisiblePath = ModelPathUtils.ConvertModelPathToUserVisiblePath(modelPath);
            return string.IsNullOrWhiteSpace(userVisiblePath) ? null : userVisiblePath;
        } catch {
            return string.IsNullOrWhiteSpace(doc.PathName) ? null : doc.PathName;
        }
    }

    public static string GetDocumentKey(this Document doc) {
        if (doc == null)
            throw new ArgumentNullException(nameof(doc));

        var documentKind = doc.IsFamilyDocument ? "family" : "project";
        var cloudProjectGuid = doc.GetCloudProjectGuid();
        var cloudModelGuid = doc.GetCloudModelGuid();
        if (!string.IsNullOrWhiteSpace(cloudProjectGuid) && !string.IsNullOrWhiteSpace(cloudModelGuid))
            return $"{documentKind}:cloud:{cloudProjectGuid}:{cloudModelGuid}";

        var documentPath = doc.GetDocumentPath();
        if (!string.IsNullOrWhiteSpace(documentPath))
            return $"{documentKind}:path:{documentPath}";

        return $"{documentKind}:unsaved:{doc.Title}:{doc.GetHashCode()}";
    }

    /// <summary>
    /// Returns a softer document continuity key for MRU/session heuristics.
    /// This intentionally preserves logical family identity across temp-save and reopen flows.
    /// </summary>
    public static string GetDocumentMruAffinityKey(this Document doc) {
        if (doc == null)
            throw new ArgumentNullException(nameof(doc));

        if (!doc.IsFamilyDocument)
            return doc.GetDocumentKey();

        var familyName = doc.GetOwnerFamilyName();
        if (!string.IsNullOrWhiteSpace(familyName))
            return $"family:name:{familyName}";

        var documentPath = doc.GetDocumentPath();
        if (!string.IsNullOrWhiteSpace(documentPath) && !IsTemporaryFamilyPath(documentPath))
            return $"family:path:{documentPath}";

        return $"family:title:{doc.Title}";
    }

    public static string? GetCloudProjectGuid(this Document doc) {
        if (doc == null)
            throw new ArgumentNullException(nameof(doc));

        try {
            if (!doc.IsModelInCloud)
                return null;

            return doc.GetDocumentModelPath()?.GetProjectGUID().ToString("D");
        } catch {
            return null;
        }
    }

    public static string? GetCloudModelGuid(this Document doc) {
        if (doc == null)
            throw new ArgumentNullException(nameof(doc));

        try {
            if (!doc.IsModelInCloud)
                return null;

            return doc.GetDocumentModelPath()?.GetModelGUID().ToString("D");
        } catch {
            return null;
        }
    }

    public static string? GetCloudModelUrn(this Document doc) {
        if (doc == null)
            throw new ArgumentNullException(nameof(doc));

        try {
            if (!doc.IsModelInCloud)
                return null;

            var urn = doc.GetCloudModelUrn();
            return string.IsNullOrWhiteSpace(urn) ? null : urn;
        } catch {
            return null;
        }
    }

    private static string? GetOwnerFamilyName(this Document doc) {
        try {
            return doc.IsFamilyDocument ? doc.OwnerFamily?.Name : null;
        } catch {
            return null;
        }
    }

    private static bool IsTemporaryFamilyPath(string documentPath) =>
        documentPath.EndsWith(".rfa", StringComparison.OrdinalIgnoreCase) &&
        (documentPath.Contains(@"\Temp\", StringComparison.OrdinalIgnoreCase) ||
         documentPath.Contains(@"/Temp/", StringComparison.OrdinalIgnoreCase));
}
