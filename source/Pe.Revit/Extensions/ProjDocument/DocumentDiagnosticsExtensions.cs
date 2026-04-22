namespace Pe.Revit.Extensions.ProjDocument;

public static class DocumentDiagnosticsExtensions {
    public static string LogDocumentDetails(this Document doc, string? context = null) {
        if (doc == null)
            throw new ArgumentNullException(nameof(doc));

        var sb = new StringBuilder();
        if (!string.IsNullOrEmpty(context))
            _ = sb.AppendLine($"=== {context} ===");
        _ = sb.AppendLine("=== Document Details ===");

        _ = sb.AppendLine($"Title: {doc.Title}")
            .AppendLine($"PathName: {doc.PathName ?? "(empty)"}")
            .AppendLine($"IsFamilyDocument: {doc.IsFamilyDocument}")
            .AppendLine($"IsModelInCloud: {doc.IsModelInCloud}")
            .AppendLine($"IsModifiable: {doc.IsModifiable}")
            .AppendLine($"IsReadOnly: {doc.IsReadOnly}")
            .AppendLine($"IsWorkshared: {doc.IsWorkshared}");

        var modelPath = doc.GetDocumentModelPath();
        if (modelPath != null) {
            _ = sb.AppendLine($"ModelPath Type: {modelPath.GetType().Name}");
            var userPath = ModelPathUtils.ConvertModelPathToUserVisiblePath(modelPath);
            _ = sb.AppendLine($"UserVisiblePath: {userPath}");
            _ = sb.AppendLine($"ServerPath: {modelPath.ServerPath}");
        } else
            _ = sb.AppendLine("ModelPath: null (unsaved document)");

        return sb.ToString();
    }
}
