namespace Pe.Shared.StorageRuntime.Documents;

public readonly record struct SettingsDocumentId(
    string ModuleKey,
    string RootKey,
    string RelativePath
) {
    public string StableId => $"{this.ModuleKey}:{this.RootKey}:{this.RelativePath}".ToLowerInvariant();
}

public readonly record struct SettingsVersionToken(string Value) {
    public override string ToString() => this.Value;
}

public record SettingsDocumentMetadata(
    SettingsDocumentId DocumentId,
    SettingsFileKind Kind,
    DateTimeOffset? ModifiedUtc,
    SettingsVersionToken? VersionToken
);

public record SettingsDocumentSnapshot(
    SettingsDocumentMetadata Metadata,
    string RawContent,
    string? ComposedContent,
    IReadOnlyList<SettingsDocumentDependency> Dependencies,
    SettingsValidationResult Validation,
    IReadOnlyDictionary<string, string> CapabilityHints
);

public record DiscoverSettingsDocumentsRequest(
    string ModuleKey,
    string RootKey,
    SettingsDiscoveryOptions? Options = null
);

public record OpenSettingsDocumentRequest(
    SettingsDocumentId DocumentId,
    bool IncludeComposedContent = false
);

public record SaveSettingsDocumentRequest(
    SettingsDocumentId DocumentId,
    string RawContent,
    SettingsVersionToken? ExpectedVersionToken = null
);

public record ValidateSettingsDocumentRequest(
    SettingsDocumentId DocumentId,
    string RawContent
);

public record SaveSettingsDocumentResult(
    SettingsDocumentMetadata Metadata,
    bool WriteApplied,
    bool ConflictDetected,
    string? ConflictMessage,
    SettingsValidationResult Validation
);

public enum SettingsDirectiveScope {
    Local,
    Global
}

public enum SettingsDocumentDependencyKind {
    Include,
    Preset
}

public record SettingsDocumentDependency(
    SettingsDocumentId DocumentId,
    string DirectivePath,
    SettingsDirectiveScope Scope,
    SettingsDocumentDependencyKind Kind
);

public record SettingsValidationIssue(
    string Path,
    string Code,
    string Severity,
    string Message,
    string? Suggestion = null
);

public record SettingsValidationResult(
    bool IsValid,
    IReadOnlyList<SettingsValidationIssue> Issues
);

public record SettingsRootDescriptor(
    string RootKey,
    string DisplayName
);

public record SettingsModuleWorkspaceDescriptor(
    string ModuleKey,
    string DefaultRootKey,
    IReadOnlyList<SettingsRootDescriptor> Roots
);

public record SettingsWorkspaceDescriptor(
    string WorkspaceKey,
    string DisplayName,
    string BasePath,
    IReadOnlyList<SettingsModuleWorkspaceDescriptor> Modules
);

public record SettingsWorkspacesData(
    IReadOnlyList<SettingsWorkspaceDescriptor> Workspaces
);