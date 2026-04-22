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
public record ParameterIdentity(
    string Key,
    ParameterIdentityKind Kind,
    string Name,
    int? BuiltInParameterId,
    string? SharedGuid,
    long? ParameterElementId
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