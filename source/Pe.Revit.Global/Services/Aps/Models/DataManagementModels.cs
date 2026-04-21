namespace Pe.Revit.Global.Services.Aps.Models;

public sealed record DataManagementHubEntry(
    string Id,
    string Name,
    string? Region
);

public sealed record DataManagementProjectEntry(
    string Id,
    string Name
);

public sealed record DataManagementContentEntry(
    string Id,
    string Name,
    bool IsFolder,
    string? ExtensionType
);

public sealed record DataManagementVersionEntry(
    string Id,
    string DisplayName,
    string? FileType,
    string? MimeType,
    string? ExtensionType,
    DateTimeOffset? CreatedAt,
    string? ProjectGuid,
    string? ModelGuid
);
