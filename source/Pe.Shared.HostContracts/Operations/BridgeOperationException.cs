using Pe.Shared.HostContracts.SettingsStorage;

namespace Pe.Shared.HostContracts.Operations;

public sealed class BridgeOperationException(
    int statusCode,
    string message,
    IReadOnlyList<ValidationIssue>? issues = null
) : Exception(message) {
    public IReadOnlyList<ValidationIssue> Issues { get; } = issues ?? [];
    public int StatusCode { get; } = statusCode;
}

public static class BridgeOperationExceptions {
    public const int BadRequestStatusCode = 400;
    public const int ConflictStatusCode = 409;
    public const int UnexpectedStatusCode = 500;

    public static BridgeOperationException BadRequest(
        string message,
        IReadOnlyList<ValidationIssue>? issues = null
    ) => new(BadRequestStatusCode, message, issues);

    public static BridgeOperationException Conflict(
        string message,
        IReadOnlyList<ValidationIssue>? issues = null
    ) => new(ConflictStatusCode, message, issues);

    public static BridgeOperationException Unexpected(
        string issueCode,
        Exception exception,
        string suggestion
    ) => new(
        UnexpectedStatusCode,
        exception.Message,
        [Issue("$", issueCode, exception.Message, suggestion)]
    );

    public static ValidationIssue Issue(
        string instancePath,
        string code,
        string message,
        string? suggestion,
        string severity = "error",
        string? schemaPath = null
    ) => new(instancePath, schemaPath, code, severity, message, suggestion);
}
