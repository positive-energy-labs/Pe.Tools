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

[ExportTsInterface]
public record OpenRevitDocumentRequest(
    string Path
);

[ExportTsEnum]
public enum RevitRecentDocumentSource {
    RevitIni,
    RegistryProfileMru
}

[ExportTsEnum]
public enum RevitRecentDocumentPathKind {
    LocalPath,
    CloudPath,
    Unknown
}

[ExportTsInterface]
public record RevitRecentDocumentsRequest(
    string? RevitYear = null,
    bool IncludeRegistryMru = false,
    bool LocalFilesOnly = true
);

[ExportTsInterface]
public record RevitRecentDocumentEntry(
    RevitRecentDocumentSource Source,
    string RevitYear,
    int? Rank,
    string Path,
    RevitRecentDocumentPathKind PathKind,
    string Title,
    bool? Exists,
    string? Profile
);

[ExportTsInterface]
public record RevitRecentDocumentsData(
    List<RevitRecentDocumentEntry> Documents
);

[ExportTsInterface]
public record OpenRevitDocumentData(
    RevitDocumentSummary Document,
    RevitDocumentSessionContextData Session
);
