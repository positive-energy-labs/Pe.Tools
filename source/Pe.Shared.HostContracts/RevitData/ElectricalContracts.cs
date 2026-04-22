using Pe.Shared.HostContracts.Operations;
using Pe.Shared.HostContracts.Protocol;
using Pe.Shared.HostContracts.SettingsStorage;
using Pe.Shared.RevitData;
using TypeGen.Core.TypeAnnotations;

namespace Pe.Shared.HostContracts.RevitData;

[ExportTsInterface]
public record ElectricalPanelsCatalogRequest(
    ElectricalPanelFilter? Filter,
    BridgeSessionSelector? Target = null
) : IBridgeSessionRequest;

[ExportTsInterface]
public record ElectricalCircuitsCatalogRequest(
    ElectricalCircuitFilter? Filter,
    ElectricalCircuitsCatalogOptions? Options = null,
    BridgeSessionSelector? Target = null
) : IBridgeSessionRequest;

[ExportTsInterface]
public record ElectricalLoadClassificationsCatalogRequest(
    ElectricalLoadClassificationFilter? Filter,
    BridgeSessionSelector? Target = null
) : IBridgeSessionRequest;

[ExportTsInterface]
public record ElectricalPanelsCatalogEnvelopeResponse(
    bool Ok,
    EnvelopeCode Code,
    string Message,
    List<ValidationIssue> Issues,
    ElectricalPanelsCatalogData? Data
) : IHostDataEnvelope<ElectricalPanelsCatalogData> {
    public object? GetData() => this.Data;
}

[ExportTsInterface]
public record ElectricalCircuitsCatalogEnvelopeResponse(
    bool Ok,
    EnvelopeCode Code,
    string Message,
    List<ValidationIssue> Issues,
    ElectricalCircuitsCatalogData? Data
) : IHostDataEnvelope<ElectricalCircuitsCatalogData> {
    public object? GetData() => this.Data;
}

[ExportTsInterface]
public record ElectricalLoadClassificationsCatalogEnvelopeResponse(
    bool Ok,
    EnvelopeCode Code,
    string Message,
    List<ValidationIssue> Issues,
    ElectricalLoadClassificationsCatalogData? Data
) : IHostDataEnvelope<ElectricalLoadClassificationsCatalogData> {
    public object? GetData() => this.Data;
}