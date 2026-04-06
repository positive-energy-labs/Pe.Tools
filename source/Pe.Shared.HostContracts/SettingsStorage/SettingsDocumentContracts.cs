using Newtonsoft.Json;
using Newtonsoft.Json.Converters;
using TypeGen.Core.TypeAnnotations;

namespace Pe.Shared.HostContracts.SettingsStorage;

[JsonConverter(typeof(StringEnumConverter))]
[ExportTsEnum]
public enum SettingsFileKind {
    Profile,
    Fragment,
    Schema,
    Other
}

[JsonConverter(typeof(StringEnumConverter))]
[ExportTsEnum]
public enum SettingsDirectiveScope {
    Local,
    Global
}

[JsonConverter(typeof(StringEnumConverter))]
[ExportTsEnum]
public enum SettingsDocumentDependencyKind {
    Include,
    Preset
}

[ExportTsInterface]
public record SettingsDocumentId(
    string ModuleKey,
    string RootKey,
    string RelativePath
) {
    public string StableId => $"{this.ModuleKey}:{this.RootKey}:{this.RelativePath}".ToLowerInvariant();
}

[ExportTsInterface]
public record SettingsVersionToken(string Value);

[ExportTsInterface]
public record SettingsDocumentMetadata(
    SettingsDocumentId DocumentId,
    SettingsFileKind Kind,
    DateTimeOffset? ModifiedUtc,
    SettingsVersionToken? VersionToken
);

[ExportTsInterface]
public record SettingsDocumentDependency(
    SettingsDocumentId DocumentId,
    string DirectivePath,
    SettingsDirectiveScope Scope,
    SettingsDocumentDependencyKind Kind
);

[ExportTsInterface]
public record SettingsValidationIssue(
    string Path,
    string Code,
    string Severity,
    string Message,
    string? Suggestion = null
);

[ExportTsInterface]
public record SettingsValidationResult(
    bool IsValid,
    List<SettingsValidationIssue> Issues
);

[ExportTsInterface]
public record SettingsDocumentSnapshot(
    SettingsDocumentMetadata Metadata,
    string RawContent,
    string? ComposedContent,
    List<SettingsDocumentDependency> Dependencies,
    SettingsValidationResult Validation,
    Dictionary<string, string> CapabilityHints
);

[ExportTsInterface]
public record OpenSettingsDocumentRequest(
    SettingsDocumentId DocumentId,
    bool IncludeComposedContent = false
);

[ExportTsInterface]
public record SaveSettingsDocumentRequest(
    SettingsDocumentId DocumentId,
    string RawContent,
    SettingsVersionToken? ExpectedVersionToken = null
);

[ExportTsInterface]
public record ValidateSettingsDocumentRequest(
    SettingsDocumentId DocumentId,
    string RawContent
);

[ExportTsInterface]
public record SaveSettingsDocumentResult(
    SettingsDocumentMetadata Metadata,
    bool WriteApplied,
    bool ConflictDetected,
    string? ConflictMessage,
    SettingsValidationResult Validation
);

[ExportTsInterface]
public record SettingsRootDescriptor(
    string RootKey,
    string DisplayName
);

[ExportTsInterface]
public record SettingsModuleWorkspaceDescriptor(
    string ModuleKey,
    string DefaultRootKey,
    List<SettingsRootDescriptor> Roots
);

[ExportTsInterface]
public record SettingsWorkspaceDescriptor(
    string WorkspaceKey,
    string DisplayName,
    string BasePath,
    List<SettingsModuleWorkspaceDescriptor> Modules
);

[ExportTsInterface]
public record SettingsWorkspacesData(
    List<SettingsWorkspaceDescriptor> Workspaces
);

[ExportTsInterface]
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

[ExportTsInterface]
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

[ExportTsInterface]
public record SettingsDirectoryNode(
    string Name,
    string RelativePath,
    List<SettingsDirectoryNode> Directories,
    List<SettingsFileNode> Files
);

[ExportTsInterface]
public record SettingsDiscoveryResult(
    List<SettingsFileEntry> Files,
    SettingsDirectoryNode Root
);

[ExportTsInterface]
public record SettingsTreeRequest {
    public string ModuleKey { get; init; } = string.Empty;
    public string RootKey { get; init; } = string.Empty;
    public string? SubDirectory { get; init; }
    public bool Recursive { get; init; }
    public bool IncludeFragments { get; init; }
    public bool IncludeSchemas { get; init; }
}
