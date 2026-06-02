using Newtonsoft.Json;
using Newtonsoft.Json.Converters;
using TypeGen.Core.TypeAnnotations;

namespace Pe.Shared.RevitData;

[JsonConverter(typeof(StringEnumConverter))]
[ExportTsEnum]
public enum ParameterIdentityKind {
    SharedGuid,
    BuiltInParameter,
    ParameterElement,
    NameFallback
}

[ExportTsInterface]
public record ParameterCatalogRequest(
    string ModuleKey,
    Dictionary<string, string>? ContextValues
);

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
public record ParameterReference {
    public ParameterIdentity? Identity { get; init; }
    public string? Name { get; init; }
    public string? SharedGuid { get; init; }

    public static ParameterReference FromIdentity(ParameterIdentity identity) => new() { Identity = identity };
    public static ParameterReference FromName(string name) => new() { Name = name };
    public static ParameterReference FromSharedGuid(string sharedGuid) => new() { SharedGuid = sharedGuid };
}

[ExportTsInterface]
public record ParameterDefinitionDescriptor(
    ParameterIdentity Identity,
    bool? IsInstance,
    string? DataTypeId,
    string? DataTypeLabel,
    string? GroupTypeId,
    string? GroupTypeLabel
);

[ExportTsInterface]
public record ParameterCatalogEntry(
    ParameterDefinitionDescriptor Definition,
    string StorageType,
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
