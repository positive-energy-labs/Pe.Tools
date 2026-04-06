using Newtonsoft.Json;
using Newtonsoft.Json.Converters;
using Pe.Shared.Host.Contracts.Operations;
using Pe.Shared.Host.Contracts.SettingsStorage;
using TypeGen.Core.TypeAnnotations;

namespace Pe.Shared.Host.Contracts.RevitData;

[JsonConverter(typeof(StringEnumConverter))]
[ExportTsEnum]
public enum ProjectParameterBindingKind {
    Instance,
    Type
}

[ExportTsInterface]
public record ProjectParameterBindingsRequest(
    LoadedFamiliesFilter? Filter
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

[ExportTsInterface]
public record ProjectParameterBindingsEnvelopeResponse(
    bool Ok,
    EnvelopeCode Code,
    string Message,
    List<ValidationIssue> Issues,
    ProjectParameterBindingsData? Data
) : IHostDataEnvelope<ProjectParameterBindingsData> {
    public object? GetData() => this.Data;
}