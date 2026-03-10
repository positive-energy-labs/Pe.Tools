namespace Pe.Global.Services.SignalR;

/// <summary>
///     Internal result primitive for hub/service composition.
///     Keeps control flow linear and avoids repetitive envelope construction.
/// </summary>
internal readonly record struct HubResult<TData>(
    bool Ok,
    EnvelopeCode Code,
    string Message,
    List<ValidationIssue> Issues,
    TData? Data
);

internal static class HubResult {
    public static HubResult<TData> Success<TData>(
        TData data,
        EnvelopeCode code,
        string message,
        List<ValidationIssue>? issues = null
    ) => new(true, code, message, issues ?? [], data);

    public static HubResult<TData> Failure<TData>(
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

internal static class HubResultEnvelopeExtensions {
    public static SchemaEnvelopeResponse ToSchemaEnvelope(this HubResult<SchemaData> result) =>
        new(result.Ok, result.Code, result.Message, result.Issues, result.Data);

    public static FieldOptionsEnvelopeResponse ToFieldOptionsEnvelope(this HubResult<FieldOptionsData> result) =>
        new(result.Ok, result.Code, result.Message, result.Issues, result.Data);

    public static ValidationEnvelopeResponse ToValidationEnvelope(this HubResult<ValidationData> result) =>
        new(result.Ok, result.Code, result.Message, result.Issues, result.Data);

    public static ServerCapabilitiesEnvelopeResponse ToServerCapabilitiesEnvelope(this HubResult<ServerCapabilitiesData> result) =>
        new(result.Ok, result.Code, result.Message, result.Issues, result.Data);

    public static ParameterCatalogEnvelopeResponse ToParameterCatalogEnvelope(this HubResult<ParameterCatalogData> result) =>
        new(result.Ok, result.Code, result.Message, result.Issues, result.Data);

    public static SettingsCatalogEnvelopeResponse ToSettingsCatalogEnvelope(this HubResult<SettingsCatalogData> result) =>
        new(result.Ok, result.Code, result.Message, result.Issues, result.Data);
}
