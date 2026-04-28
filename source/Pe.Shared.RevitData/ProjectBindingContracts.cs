using Newtonsoft.Json;
using Newtonsoft.Json.Converters;
using TypeGen.Core.TypeAnnotations;

namespace Pe.Shared.RevitData;

[JsonConverter(typeof(StringEnumConverter))]
[ExportTsEnum]
public enum ProjectParameterBindingKind {
    Instance,
    Type
}

[ExportTsInterface]
public record ProjectParameterBindingsRequest(
    LoadedFamiliesFilter? Filter = null
);

[ExportTsInterface]
public record ProjectParameterBindingEntry(
    ParameterIdentity Identity,
    ProjectParameterBindingKind BindingKind,
    string? DataTypeId,
    string? DataTypeLabel,
    string? GroupTypeId,
    string? GroupTypeLabel,
    List<string> CategoryNames
);

[ExportTsInterface]
public record ProjectParameterBindingsData(
    List<ProjectParameterBindingEntry> Entries,
    List<RevitDataIssue> Issues
);
