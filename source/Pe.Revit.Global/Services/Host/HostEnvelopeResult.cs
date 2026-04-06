using Pe.Shared.HostContracts.RevitData;
using Pe.Shared.HostContracts.SettingsStorage;

namespace Pe.Revit.Global.Services.Host;

internal readonly record struct HostEnvelopeResult<TData>(
    bool Ok,
    EnvelopeCode Code,
    string Message,
    List<ValidationIssue> Issues,
    TData? Data
);

internal static class HostEnvelopeResults {
    public static HostEnvelopeResult<TData> Success<TData>(
        TData data,
        EnvelopeCode code,
        string message,
        List<ValidationIssue>? issues = null
    ) => new(true, code, message, issues ?? [], data);

    public static HostEnvelopeResult<TData> Failure<TData>(
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

internal static class HostEnvelopeResultExtensions {
    public static SchemaEnvelopeResponse ToSchemaEnvelope(this HostEnvelopeResult<SchemaData> result) =>
        new(result.Ok, result.Code, result.Message, result.Issues, result.Data);

    public static FieldOptionsEnvelopeResponse
        ToFieldOptionsEnvelope(this HostEnvelopeResult<FieldOptionsData> result) =>
        new(result.Ok, result.Code, result.Message, result.Issues, result.Data);

    public static ValidationEnvelopeResponse ToValidationEnvelope(this HostEnvelopeResult<ValidationData> result) =>
        new(result.Ok, result.Code, result.Message, result.Issues, result.Data);

    public static ParameterCatalogEnvelopeResponse
        ToParameterCatalogEnvelope(this HostEnvelopeResult<ParameterCatalogData> result) =>
        new(result.Ok, result.Code, result.Message, result.Issues, result.Data);

    public static ScheduleCatalogEnvelopeResponse
        ToScheduleCatalogEnvelope(this HostEnvelopeResult<ScheduleCatalogData> result) =>
        new(result.Ok, result.Code, result.Message, result.Issues, result.Data);

    public static LoadedFamiliesCatalogEnvelopeResponse ToLoadedFamiliesCatalogEnvelope(
        this HostEnvelopeResult<LoadedFamiliesCatalogData> result
    ) => new(result.Ok, result.Code, result.Message, result.Issues, result.Data);

    public static LoadedFamiliesMatrixEnvelopeResponse ToLoadedFamiliesMatrixEnvelope(
        this HostEnvelopeResult<LoadedFamiliesMatrixData> result
    ) => new(result.Ok, result.Code, result.Message, result.Issues, result.Data);

    public static ProjectParameterBindingsEnvelopeResponse ToProjectParameterBindingsEnvelope(
        this HostEnvelopeResult<ProjectParameterBindingsData> result
    ) => new(result.Ok, result.Code, result.Message, result.Issues, result.Data);
}
