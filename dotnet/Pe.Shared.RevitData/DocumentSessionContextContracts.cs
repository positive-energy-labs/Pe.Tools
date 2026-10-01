
namespace Pe.Shared.RevitData;

/// <param name="IsHeadless">Open with no window: no active view or selection, and Revit cannot activate it. Ops that read UI state refuse it; document-owned ops answer.</param>
public record RevitDocumentSummary(
    string DocumentKey,
    string Title,
    string? Path,
    bool IsFamilyDocument,
    bool IsWorkshared,
    bool IsActive,
    bool IsHeadless,
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
