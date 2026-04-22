using TypeGen.Core.TypeAnnotations;

namespace Pe.Shared.RevitData;

[ExportTsInterface]
public record RevitDocumentSelector(
    string? DocumentKey = null,
    string? Title = null,
    string? Path = null,
    bool? IsFamilyDocument = null
);

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