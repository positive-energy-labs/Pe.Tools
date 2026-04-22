using Pe.Shared.HostContracts.Operations;
using Pe.Shared.HostContracts.Protocol;
using Pe.Shared.HostContracts.SettingsStorage;
using Pe.Shared.RevitData;
using TypeGen.Core.TypeAnnotations;

namespace Pe.Shared.HostContracts.RevitData;

[ExportTsInterface]
public record LoadedFamiliesFilterFieldOptionsRequest(
    string PropertyPath,
    string SourceKey,
    Dictionary<string, string>? ContextValues,
    BridgeSessionSelector? Target = null
) : IBridgeSessionRequest;

[ExportTsInterface]
public record LoadedFamiliesCatalogRequest(
    LoadedFamiliesFilter? Filter,
    BridgeSessionSelector? Target = null
) : IBridgeSessionRequest;

[ExportTsInterface]
public record LoadedFamiliesMatrixRequest(
    LoadedFamiliesFilter? Filter,
    BridgeSessionSelector? Target = null
) : IBridgeSessionRequest;

[ExportTsInterface]
public record LoadedFamiliesCatalogEnvelopeResponse(
    bool Ok,
    EnvelopeCode Code,
    string Message,
    List<ValidationIssue> Issues,
    LoadedFamiliesCatalogData? Data
) : IHostDataEnvelope<LoadedFamiliesCatalogData> {
    public object? GetData() => this.Data;
}

[ExportTsInterface]
public record LoadedFamiliesMatrixEnvelopeResponse(
    bool Ok,
    EnvelopeCode Code,
    string Message,
    List<ValidationIssue> Issues,
    LoadedFamiliesMatrixData? Data
) : IHostDataEnvelope<LoadedFamiliesMatrixData> {
    public object? GetData() => this.Data;
}