namespace Pe.Shared.StorageRuntime;

/// <summary>
///     Settings file classification used by discovery results.
/// </summary>
public enum SettingsFileKind {
    Profile,
    Fragment,
    Schema,
    Other
}

/// <summary>
///     Discovery options for settings files.
/// </summary>
public record SettingsDiscoveryOptions(
    string? SubDirectory = null,
    bool Recursive = false,
    bool IncludeFragments = true,
    bool IncludeSchemas = true
);

/// <summary>
///     Flat file entry emitted by settings discovery.
/// </summary>
public record SettingsFileEntry(
    string Path,
    string RelativePath,
    string RelativePathWithoutExtension,
    string Name,
    string BaseName,
    string? Directory,
    DateTimeOffset ModifiedUtc,
    SettingsFileKind Kind,
    bool IsFragment,
    bool IsSchema
);

/// <summary>
///     File node used in settings directory tree projections.
/// </summary>
public record SettingsFileNode(
    string Name,
    string RelativePath,
    string RelativePathWithoutExtension,
    string Id,
    DateTimeOffset ModifiedUtc,
    SettingsFileKind Kind,
    bool IsFragment,
    bool IsSchema
);

/// <summary>
///     Directory node used in settings directory tree projections.
/// </summary>
public record SettingsDirectoryNode(
    string Name,
    string RelativePath,
    List<SettingsDirectoryNode> Directories,
    List<SettingsFileNode> Files
);

/// <summary>
///     Canonical discovery result containing flat files and a tree.
/// </summary>
public record SettingsDiscoveryResult(
    List<SettingsFileEntry> Files,
    SettingsDirectoryNode Root
);