using TypeGen.Core.TypeAnnotations;

namespace Pe.Shared.RevitData;

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
    int OpenDocumentCount,
    List<RevitDocumentSummary> OpenDocuments
);
