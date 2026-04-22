using Pe.Shared.HostContracts.Operations;
using Pe.Shared.HostContracts.Protocol;
using Pe.Shared.HostContracts.SettingsStorage;
using Pe.Shared.RevitData;
using TypeGen.Core.TypeAnnotations;

namespace Pe.Shared.HostContracts.RevitData;

[ExportTsInterface]
public record RevitDocumentSessionContextRequest(
    RevitDocumentSelector? TargetDocument = null,
    BridgeSessionSelector? Target = null
) : IBridgeSessionRequest;

[ExportTsInterface]
public record RevitDocumentSessionContextEnvelopeResponse(
    bool Ok,
    EnvelopeCode Code,
    string Message,
    List<ValidationIssue> Issues,
    RevitDocumentSessionContextData? Data
) : IHostDataEnvelope<RevitDocumentSessionContextData> {
    public object? GetData() => this.Data;
}