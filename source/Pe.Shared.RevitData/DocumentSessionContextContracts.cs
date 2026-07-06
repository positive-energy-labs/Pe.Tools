using Pe.Shared.Codegen;

namespace Pe.Shared.RevitData;

[ExportTsSchema]
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

[ExportTsSchema]
public record RevitDocumentSessionContextData(
    bool HasActiveDocument,
    RevitDocumentSummary? ActiveDocument,
    int OpenDocumentCount,
    List<RevitDocumentSummary> OpenDocuments
);

[ExportTsSchema]
public record OpenRevitDocumentRequest(
    string? Path = null,
    string? CloudRegion = null,
    string? CloudProjectGuid = null,
    string? CloudModelGuid = null
);

/// <summary>
///     Pure input classification for <see cref="OpenRevitDocumentRequest" />. Kept off the record
///     (and out of the TS schema) so the local/cloud selection stays testable without a Revit session.
/// </summary>
public static class OpenRevitDocumentRequestExtensions {
    public static bool HasLocalPath(this OpenRevitDocumentRequest request) =>
        !string.IsNullOrWhiteSpace(request.Path);

    // A cloud target needs both GUIDs; region is optional (defaults to US at open time).
    public static bool HasCloudTarget(this OpenRevitDocumentRequest request) =>
        !string.IsNullOrWhiteSpace(request.CloudProjectGuid)
        && !string.IsNullOrWhiteSpace(request.CloudModelGuid);
}

[ExportTsSchema]
public record OpenRevitDocumentData(
    RevitDocumentSummary Document,
    RevitDocumentSessionContextData Session
);
