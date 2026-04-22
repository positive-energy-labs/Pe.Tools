using Pe.Shared.HostContracts.Operations;
using Pe.Shared.HostContracts.Protocol;
using Pe.Shared.HostContracts.SettingsStorage;
using Pe.Shared.RevitData;
using TypeGen.Core.TypeAnnotations;

namespace Pe.Shared.HostContracts.RevitData;

[ExportTsInterface]
public record ElectricalPanelSchedulesQueryRequest(
    ElectricalPanelSchedulesQuery? Query = null,
    BridgeSessionSelector? Target = null
) : IBridgeSessionRequest;

[ExportTsInterface]
public record ElectricalPanelSchedulesQueryEnvelopeResponse(
    bool Ok,
    EnvelopeCode Code,
    string Message,
    List<ValidationIssue> Issues,
    ElectricalPanelSchedulesQueryData? Data
) : IHostDataEnvelope<ElectricalPanelSchedulesQueryData> {
    public object? GetData() => this.Data;
}