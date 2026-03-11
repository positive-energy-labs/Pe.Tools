using Pe.Host.Contracts;

namespace Pe.Global.Services.Host;

internal readonly record struct Result<TData>(
    bool Ok,
    EnvelopeCode Code,
    string Message,
    List<ValidationIssue> Issues,
    TData? Data
);

internal static class Result {
    public static Result<TData> Success<TData>(
        TData data,
        EnvelopeCode code,
        string message,
        List<ValidationIssue>? issues = null
    ) => new(true, code, message, issues ?? [], data);

    public static Result<TData> Failure<TData>(
        EnvelopeCode code,
        string message,
        List<ValidationIssue>? issues = null
    ) => new(false, code, message, issues ?? [], default);

    public static ValidationIssue ExceptionIssue(
        string issueCode,
        Exception exception,
        string suggestion
    ) => new("$", null, issueCode, "error", exception.Message, suggestion);
}

internal static class ResultEnvelopeExtensions {
    public static SchemaEnvelopeResponse ToSchemaEnvelope(this Result<SchemaData> result) =>
        new(result.Ok, result.Code, result.Message, result.Issues, result.Data);

    public static FieldOptionsEnvelopeResponse ToFieldOptionsEnvelope(this Result<FieldOptionsData> result) =>
        new(result.Ok, result.Code, result.Message, result.Issues, result.Data);

    public static ValidationEnvelopeResponse ToValidationEnvelope(this Result<ValidationData> result) =>
        new(result.Ok, result.Code, result.Message, result.Issues, result.Data);

    public static ParameterCatalogEnvelopeResponse ToParameterCatalogEnvelope(this Result<ParameterCatalogData> result) =>
        new(result.Ok, result.Code, result.Message, result.Issues, result.Data);

    public static SettingsCatalogEnvelopeResponse ToSettingsCatalogEnvelope(this Result<SettingsCatalogData> result) =>
        new(result.Ok, result.Code, result.Message, result.Issues, result.Data);
}
