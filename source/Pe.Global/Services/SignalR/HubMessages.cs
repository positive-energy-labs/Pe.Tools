using TypeGen.Core.TypeAnnotations;

namespace Pe.Global.Services.SignalR;

// =============================================================================
// Schema Hub Messages
// =============================================================================

/// <summary>
///     Request to get a JSON schema for a settings type.
/// </summary>
[ExportTsInterface]
public record SchemaRequest(
    string SettingsTypeName,
    bool IsExtends = false
);

/// <summary>
///     Response containing the generated JSON schema.
/// </summary>
[ExportTsInterface]
public record SchemaResponse(
    string SchemaJson,
    string? FragmentSchemaJson
);

/// <summary>
///     Request to get examples for a specific property, with optional sibling filtering.
/// </summary>
[ExportTsInterface]
public record ExamplesRequest(
    string SettingsTypeName,
    string PropertyPath,
    Dictionary<string, string>? SiblingValues
);

/// <summary>
///     Response containing the examples for a property.
/// </summary>
[ExportTsInterface]
public record ExamplesResponse(
    List<string> Examples
);

// =============================================================================
// Settings Hub Messages
// =============================================================================

/// <summary>
///     Represents a settings file in the filesystem.
/// </summary>
[ExportTsInterface]
public record SettingsFile(
    string Path,
    string Name,
    DateTimeOffset Modified,
    bool IsFragment
);

/// <summary>
///     Request to list settings files.
/// </summary>
[ExportTsInterface]
public record ListSettingsRequest(
    string SettingsTypeName,
    string? SubDirectory
);

/// <summary>
///     Request to read a settings file.
/// </summary>
[ExportTsInterface]
public record ReadSettingsRequest(
    string SettingsTypeName,
    string FileName,
    bool ResolveComposition
);

/// <summary>
///     Response containing the settings JSON.
/// </summary>
[ExportTsInterface]
public record ReadSettingsResponse(
    string Json,
    string ResolvedJson,
    List<string> ValidationErrors
);

/// <summary>
///     Request to write settings to a file.
/// </summary>
[ExportTsInterface]
public record WriteSettingsRequest(
    string SettingsTypeName,
    string FileName,
    string Json,
    bool Validate
);

/// <summary>
///     Response from writing settings.
/// </summary>
[ExportTsInterface]
public record WriteSettingsResponse(
    bool Success,
    List<string> ValidationErrors
);

// =============================================================================
// Actions Hub Messages
// =============================================================================

/// <summary>
///     Request to execute a Revit action.
/// </summary>
[ExportTsInterface]
public record ExecuteActionRequest(
    string ActionName,
    string SettingsTypeName,
    string SettingsJson,
    bool PersistSettings
);

/// <summary>
///     Response from executing an action.
/// </summary>
[ExportTsInterface]
public record ExecuteActionResponse(
    bool Success,
    string? Error,
    object? Result
);

/// <summary>
///     Progress update during long-running operations.
/// </summary>
[ExportTsInterface]
public record ProgressUpdate(
    int Percent,
    string Message,
    string? CurrentItem
);

// =============================================================================
// Document State Messages
// =============================================================================

/// <summary>
///     Information about the currently active Revit document.
/// </summary>
[ExportTsInterface]
public record DocumentInfo(
    string Title,
    string PathName,
    bool IsModified
);

/// <summary>
///     Notification sent when document state changes.
/// </summary>
[ExportTsInterface]
public record DocumentChangedNotification(
    DocumentInfo? Document,
    bool ExamplesInvalidated
);
