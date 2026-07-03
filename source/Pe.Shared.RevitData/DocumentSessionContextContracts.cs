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
    string Path
);

[ExportTsSchema]
public record OpenRevitDocumentData(
    RevitDocumentSummary Document,
    RevitDocumentSessionContextData Session
);
