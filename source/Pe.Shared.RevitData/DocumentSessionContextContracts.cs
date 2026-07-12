
namespace Pe.Shared.RevitData;

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

public record RevitDocumentSessionContextData(
    bool HasActiveDocument,
    RevitDocumentSummary? ActiveDocument,
    int OpenDocumentCount,
    List<RevitDocumentSummary> OpenDocuments
);

/// <summary>
///     Worksharing detach behavior for opening a local workshared file. Mirrors Revit's
///     DetachFromCentralOption (the contract assembly cannot reference RevitAPI). Detached
///     opens are the sandbox-document story: DetachAndPreserveWorksets is the sensible
///     detach flavor; DoNotDetach is the request default so ordinary opens stay untouched.
/// </summary>
public enum WorksharingDetachOption {
    DoNotDetach,
    DetachAndPreserveWorksets,
    DetachAndDiscardWorksets
}

public record OpenRevitDocumentRequest(
    string? Path = null,
    string? CloudRegion = null,
    string? CloudProjectGuid = null,
    string? CloudModelGuid = null,
    WorksharingDetachOption Detach = WorksharingDetachOption.DoNotDetach
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

    public static bool RequestsDetach(this OpenRevitDocumentRequest request) =>
        request.Detach != WorksharingDetachOption.DoNotDetach;
}

public record OpenRevitDocumentData(
    RevitDocumentSummary Document,
    RevitDocumentSessionContextData Session,
    // Verified from the opened Document (Document.IsDetached), never echoed from the request.
    bool IsDetached
);
