using Pe.Shared.HostContracts.Operations;
using Pe.Shared.HostContracts.Protocol;
using Pe.Shared.HostContracts.SettingsStorage;
using TypeGen.Core.TypeAnnotations;

namespace Pe.Shared.HostContracts.RevitData;

[ExportTsInterface]
public record RevitDocumentSelector(
    string? DocumentKey = null,
    string? Title = null,
    string? Path = null,
    bool? IsFamilyDocument = null
);

[ExportTsInterface]
public record RevitDocumentSessionContextRequest(
    RevitDocumentSelector? TargetDocument = null,
    BridgeSessionSelector? Target = null
) : IBridgeSessionRequest;

[ExportTsInterface]
public record RevitDocumentSummary(
    string DocumentKey,
    string Title,
    string? Path,
    bool IsFamilyDocument,
    bool IsWorkshared,
    bool IsActive,
    bool IsModifiable,
    bool IsReadOnly,
    bool IsModelInCloud,
    string? CloudProjectGuid,
    string? CloudModelGuid,
    string? CloudModelUrn
);

[ExportTsInterface]
public record RevitDocumentSessionContextData(
    bool HasActiveDocument,
    RevitDocumentSummary? ActiveDocument,
    RevitDocumentSummary? ResolvedDocument,
    int OpenDocumentCount,
    List<RevitDocumentSummary> OpenDocuments,
    List<RevitDataIssue> Issues
);

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