namespace Pe.Shared.StorageRuntime.Documents;

public interface ISettingsDocumentValidator {
    SettingsValidationResult Validate(
        SettingsDocumentId documentId,
        string rawContent,
        string? composedContent
    );
}

public static class SettingsValidationResults {
    public static SettingsValidationResult Success() => new(true, []);

    public static SettingsValidationResult Error(
        string path,
        string code,
        string message,
        string? suggestion = null
    ) => new(false, [new SettingsValidationIssue(path, code, "error", message, suggestion)]);

    public static SettingsValidationResult Warning(
        string path,
        string code,
        string message,
        string? suggestion = null
    ) => new(true, [new SettingsValidationIssue(path, code, "warning", message, suggestion)]);
}
