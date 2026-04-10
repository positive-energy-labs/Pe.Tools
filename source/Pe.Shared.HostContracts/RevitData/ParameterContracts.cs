using Newtonsoft.Json;
using Newtonsoft.Json.Converters;
using Pe.Shared.HostContracts.Operations;
using Pe.Shared.HostContracts.Protocol;
using Pe.Shared.HostContracts.SettingsStorage;
using TypeGen.Core.TypeAnnotations;

namespace Pe.Shared.HostContracts.RevitData;

[ExportTsInterface]
public record ParameterCatalogRequest(
    string ModuleKey,
    Dictionary<string, string>? ContextValues,
    BridgeSessionSelector? Target = null
) : IBridgeSessionRequest;

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
