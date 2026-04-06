using Newtonsoft.Json;
using Newtonsoft.Json.Converters;
using Pe.Shared.Host.Contracts.Operations;
using Pe.Shared.Host.Contracts.SettingsStorage;
using TypeGen.Core.TypeAnnotations;

namespace Pe.Shared.Host.Contracts.RevitData;

[ExportTsInterface]
public record ParameterCatalogRequest(
    string ModuleKey,
    Dictionary<string, string>? ContextValues
);

[JsonConverter(typeof(StringEnumConverter))]
[ExportTsEnum]
public enum ParameterIdentityKind {
    SharedGuid,
    BuiltInParameter,
    ParameterElement,
    NameFallback
}

[JsonConverter(typeof(StringEnumConverter))]
[ExportTsEnum]
public enum RevitDataIssueSeverity {
    Info,
    Warning,
    Error
}

[ExportTsInterface]
public record ParameterIdentity(
    string Key,
    ParameterIdentityKind Kind,
    string Name,
    int? BuiltInParameterId,
    string? SharedGuid,
    long? ParameterElementId
);

[ExportTsInterface]
public record RevitDataIssue(
    string Code,
    RevitDataIssueSeverity Severity,
    string Message,
    string? FamilyName = null,
    string? TypeName = null,
    string? ParameterName = null
);

[ExportTsInterface]
public record ParameterCatalogEntry(
    ParameterIdentity Identity,
    string StorageType,
    string? DataType,
    bool IsInstance,
    bool IsParamService,
    List<string> FamilyNames,
    List<string> TypeNames
);

[ExportTsInterface]
public record ParameterCatalogData(
    List<ParameterCatalogEntry> Entries,
    int FamilyCount,
    int TypeCount
);

[ExportTsInterface]
public record ParameterCatalogEnvelopeResponse(
    bool Ok,
    EnvelopeCode Code,
    string Message,
    List<ValidationIssue> Issues,
    ParameterCatalogData? Data
) : IHostDataEnvelope<ParameterCatalogData> {
    public object? GetData() => this.Data;
}