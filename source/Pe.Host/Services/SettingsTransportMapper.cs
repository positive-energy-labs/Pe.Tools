using RuntimeDiscoveryResult = Pe.StorageRuntime.SettingsDiscoveryResult;
using RuntimeDirectoryNode = Pe.StorageRuntime.SettingsDirectoryNode;
using RuntimeFileEntry = Pe.StorageRuntime.SettingsFileEntry;
using RuntimeFileKind = Pe.StorageRuntime.SettingsFileKind;
using RuntimeFileNode = Pe.StorageRuntime.SettingsFileNode;
using RuntimeDocumentDependency = Pe.StorageRuntime.Documents.SettingsDocumentDependency;
using RuntimeDocumentDependencyKind = Pe.StorageRuntime.Documents.SettingsDocumentDependencyKind;
using RuntimeDocumentId = Pe.StorageRuntime.Documents.SettingsDocumentId;
using RuntimeDocumentMetadata = Pe.StorageRuntime.Documents.SettingsDocumentMetadata;
using RuntimeDocumentSnapshot = Pe.StorageRuntime.Documents.SettingsDocumentSnapshot;
using RuntimeDirectiveScope = Pe.StorageRuntime.Documents.SettingsDirectiveScope;
using RuntimeRootDescriptor = Pe.StorageRuntime.Documents.SettingsRootDescriptor;
using RuntimeSaveResult = Pe.StorageRuntime.Documents.SaveSettingsDocumentResult;
using RuntimeSettingsModuleWorkspaceDescriptor = Pe.StorageRuntime.Documents.SettingsModuleWorkspaceDescriptor;
using RuntimeValidationIssue = Pe.StorageRuntime.Documents.SettingsValidationIssue;
using RuntimeValidationResult = Pe.StorageRuntime.Documents.SettingsValidationResult;
using RuntimeValidateRequest = Pe.StorageRuntime.Documents.ValidateSettingsDocumentRequest;
using RuntimeOpenRequest = Pe.StorageRuntime.Documents.OpenSettingsDocumentRequest;
using RuntimeSaveRequest = Pe.StorageRuntime.Documents.SaveSettingsDocumentRequest;
using RuntimeVersionToken = Pe.StorageRuntime.Documents.SettingsVersionToken;
using RuntimeWorkspaceDescriptor = Pe.StorageRuntime.Documents.SettingsWorkspaceDescriptor;
using RuntimeWorkspacesData = Pe.StorageRuntime.Documents.SettingsWorkspacesData;

namespace Pe.Host.Services;

internal static class SettingsTransportMapper {
    public static Pe.Host.Contracts.SettingsDiscoveryResult ToContract(this RuntimeDiscoveryResult result) =>
        new(
            result.Files.Select(ToContract).ToList(),
            result.Root.ToContract()
        );

    public static Pe.Host.Contracts.SettingsDocumentSnapshot ToContract(this RuntimeDocumentSnapshot snapshot) =>
        new(
            snapshot.Metadata.ToContract(),
            snapshot.RawContent,
            snapshot.ComposedContent,
            snapshot.Dependencies.Select(ToContract).ToList(),
            snapshot.Validation.ToContract(),
            snapshot.CapabilityHints.ToDictionary(
                pair => pair.Key,
                pair => pair.Value,
                StringComparer.OrdinalIgnoreCase
            )
        );

    public static Pe.Host.Contracts.SaveSettingsDocumentResult ToContract(this RuntimeSaveResult result) =>
        new(
            result.Metadata.ToContract(),
            result.WriteApplied,
            result.ConflictDetected,
            result.ConflictMessage,
            result.Validation.ToContract()
        );

    public static Pe.Host.Contracts.SettingsValidationResult ToContract(this RuntimeValidationResult result) =>
        new(
            result.IsValid,
            result.Issues.Select(ToContract).ToList()
        );

    public static Pe.Host.Contracts.SettingsWorkspacesData ToContract(this RuntimeWorkspacesData data) =>
        new(data.Workspaces.Select(ToContract).ToList());

    public static RuntimeOpenRequest ToRuntime(this Pe.Host.Contracts.OpenSettingsDocumentRequest request) =>
        new(request.DocumentId.ToRuntime(), request.IncludeComposedContent);

    public static RuntimeSaveRequest ToRuntime(this Pe.Host.Contracts.SaveSettingsDocumentRequest request) =>
        new(
            request.DocumentId.ToRuntime(),
            request.RawContent,
            request.ExpectedVersionToken?.ToRuntime()
        );

    public static RuntimeValidateRequest ToRuntime(this Pe.Host.Contracts.ValidateSettingsDocumentRequest request) =>
        new(request.DocumentId.ToRuntime(), request.RawContent);

    private static Pe.Host.Contracts.SettingsWorkspacesData ToContract(
        this IReadOnlyList<RuntimeWorkspaceDescriptor> workspaces
    ) => new(workspaces.Select(ToContract).ToList());

    private static Pe.Host.Contracts.SettingsWorkspaceDescriptor ToContract(this RuntimeWorkspaceDescriptor descriptor) =>
        new(
            descriptor.WorkspaceKey,
            descriptor.DisplayName,
            descriptor.BasePath,
            descriptor.Modules.Select(ToContract).ToList()
        );

    private static Pe.Host.Contracts.SettingsModuleWorkspaceDescriptor ToContract(
        this RuntimeSettingsModuleWorkspaceDescriptor descriptor
    ) => new(
        descriptor.ModuleKey,
        descriptor.DefaultRootKey,
        descriptor.Roots.Select(ToContract).ToList()
    );

    private static Pe.Host.Contracts.SettingsRootDescriptor ToContract(this RuntimeRootDescriptor descriptor) =>
        new(descriptor.RootKey, descriptor.DisplayName);

    private static Pe.Host.Contracts.SettingsDocumentMetadata ToContract(this RuntimeDocumentMetadata metadata) =>
        new(
            metadata.DocumentId.ToContract(),
            metadata.Kind.ToContract(),
            metadata.ModifiedUtc,
            metadata.VersionToken?.ToContract()
        );

    private static Pe.Host.Contracts.SettingsDocumentDependency ToContract(this RuntimeDocumentDependency dependency) =>
        new(
            dependency.DocumentId.ToContract(),
            dependency.DirectivePath,
            dependency.Scope.ToContract(),
            dependency.Kind.ToContract()
        );

    private static Pe.Host.Contracts.SettingsDocumentId ToContract(this RuntimeDocumentId documentId) =>
        new(documentId.ModuleKey, documentId.RootKey, documentId.RelativePath);

    private static Pe.Host.Contracts.SettingsVersionToken ToContract(this RuntimeVersionToken token) =>
        new(token.Value);

    private static Pe.Host.Contracts.SettingsValidationIssue ToContract(this RuntimeValidationIssue issue) =>
        new(issue.Path, issue.Code, issue.Severity, issue.Message, issue.Suggestion);

    private static Pe.Host.Contracts.SettingsFileEntry ToContract(this RuntimeFileEntry entry) =>
        new(
            entry.Path,
            entry.RelativePath,
            entry.RelativePathWithoutExtension,
            entry.Name,
            entry.BaseName,
            entry.Directory,
            entry.ModifiedUtc,
            entry.Kind.ToContract(),
            entry.IsFragment,
            entry.IsSchema
        );

    private static Pe.Host.Contracts.SettingsDirectoryNode ToContract(this RuntimeDirectoryNode node) =>
        new(
            node.Name,
            node.RelativePath,
            node.Directories.Select(ToContract).ToList(),
            node.Files.Select(ToContract).ToList()
        );

    private static Pe.Host.Contracts.SettingsFileNode ToContract(this RuntimeFileNode node) =>
        new(
            node.Name,
            node.RelativePath,
            node.RelativePathWithoutExtension,
            node.Id,
            node.ModifiedUtc,
            node.Kind.ToContract(),
            node.IsFragment,
            node.IsSchema
        );

    private static Pe.Host.Contracts.SettingsFileKind ToContract(this RuntimeFileKind kind) =>
        kind switch {
            RuntimeFileKind.Profile => Pe.Host.Contracts.SettingsFileKind.Profile,
            RuntimeFileKind.Fragment => Pe.Host.Contracts.SettingsFileKind.Fragment,
            RuntimeFileKind.Schema => Pe.Host.Contracts.SettingsFileKind.Schema,
            _ => Pe.Host.Contracts.SettingsFileKind.Other
        };

    private static Pe.Host.Contracts.SettingsDirectiveScope ToContract(this RuntimeDirectiveScope scope) =>
        scope == RuntimeDirectiveScope.Global
            ? Pe.Host.Contracts.SettingsDirectiveScope.Global
            : Pe.Host.Contracts.SettingsDirectiveScope.Local;

    private static Pe.Host.Contracts.SettingsDocumentDependencyKind ToContract(
        this RuntimeDocumentDependencyKind kind
    ) =>
        kind == RuntimeDocumentDependencyKind.Preset
            ? Pe.Host.Contracts.SettingsDocumentDependencyKind.Preset
            : Pe.Host.Contracts.SettingsDocumentDependencyKind.Include;

    private static RuntimeDocumentId ToRuntime(this Pe.Host.Contracts.SettingsDocumentId documentId) =>
        new(documentId.ModuleKey, documentId.RootKey, documentId.RelativePath);

    private static RuntimeVersionToken ToRuntime(this Pe.Host.Contracts.SettingsVersionToken token) =>
        new(token.Value);
}
