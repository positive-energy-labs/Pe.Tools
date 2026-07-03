using Newtonsoft.Json;
using Newtonsoft.Json.Converters;
using Pe.Shared.Codegen;

namespace Pe.Shared.RevitData;

[JsonConverter(typeof(StringEnumConverter))]
[ExportTsSchema]
public enum ParameterIdentityKind {
    SharedGuid,
    BuiltInParameter,
    ParameterElement,
    NameFallback
}

[ExportTsSchema]
public record ParameterCatalogRequest(
    string ModuleKey,
    Dictionary<string, string>? ContextValues
);

[ExportTsSchema]
public record ParameterIdentity(
    string Key,
    ParameterIdentityKind Kind,
    string Name,
    int? BuiltInParameterId,
    string? SharedGuid,
    long? ParameterElementId
);

[ExportTsSchema]
public record ParameterReference {
    public ParameterIdentity? Identity { get; init; }
    public string? Name { get; init; }
    public string? SharedGuid { get; init; }

    public static ParameterReference FromIdentity(ParameterIdentity identity) => new() { Identity = identity };
    public static ParameterReference FromName(string name) => new() { Name = name };
    public static ParameterReference FromSharedGuid(string sharedGuid) => new() { SharedGuid = sharedGuid };
}

[ExportTsSchema]
public record ParameterDefinitionDescriptor(
    ParameterIdentity Identity,
    bool? IsInstance,
    string? DataTypeId,
    string? DataTypeLabel,
    string? GroupTypeId,
    string? GroupTypeLabel
);

[ExportTsSchema]
public record ParameterCatalogEntry(
    ParameterDefinitionDescriptor Definition,
    string StorageType,
    bool IsParamService,
    List<string> FamilyNames,
    List<string> TypeNames
);

[ExportTsSchema]
public record ParameterCatalogData(
    List<ParameterCatalogEntry> Entries,
    int FamilyCount,
    int TypeCount
);
