using Pe.Shared.HostContracts.Operations;
using Pe.Shared.HostContracts.Protocol;
using Pe.Shared.HostContracts.SettingsStorage;
using Pe.Shared.RevitData;
using TypeGen.Core.TypeAnnotations;

namespace Pe.Shared.HostContracts.RevitData;

[ExportTsInterface]
public record ProjectParameterBindingsRequest(
    LoadedFamiliesFilter? Filter,
    BridgeSessionSelector? Target = null
) : IBridgeSessionRequest;

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