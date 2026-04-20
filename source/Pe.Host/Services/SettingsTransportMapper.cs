using RuntimeDiscoveryResult = Pe.Shared.StorageRuntime.SettingsDiscoveryResult;
using RuntimeDirectoryNode = Pe.Shared.StorageRuntime.SettingsDirectoryNode;
using RuntimeFileEntry = Pe.Shared.StorageRuntime.SettingsFileEntry;
using RuntimeFileKind = Pe.Shared.StorageRuntime.SettingsFileKind;
using RuntimeFileNode = Pe.Shared.StorageRuntime.SettingsFileNode;
using RuntimeDocumentDependency = Pe.Shared.StorageRuntime.Documents.SettingsDocumentDependency;
using RuntimeDocumentDependencyKind = Pe.Shared.StorageRuntime.Documents.SettingsDocumentDependencyKind;
using RuntimeDocumentId = Pe.Shared.StorageRuntime.Documents.SettingsDocumentId;
using RuntimeDocumentMetadata = Pe.Shared.StorageRuntime.Documents.SettingsDocumentMetadata;
using RuntimeDocumentSnapshot = Pe.Shared.StorageRuntime.Documents.SettingsDocumentSnapshot;
using RuntimeDirectiveScope = Pe.Shared.StorageRuntime.Documents.SettingsDirectiveScope;
using RuntimeRootDescriptor = Pe.Shared.StorageRuntime.Documents.SettingsRootDescriptor;
using RuntimeSaveResult = Pe.Shared.StorageRuntime.Documents.SaveSettingsDocumentResult;
using RuntimeSettingsModuleWorkspaceDescriptor = Pe.Shared.StorageRuntime.Documents.SettingsModuleWorkspaceDescriptor;
using RuntimeValidationIssue = Pe.Shared.StorageRuntime.Documents.SettingsValidationIssue;
using RuntimeValidationResult = Pe.Shared.StorageRuntime.Documents.SettingsValidationResult;
using RuntimeValidateRequest = Pe.Shared.StorageRuntime.Documents.ValidateSettingsDocumentRequest;
using RuntimeOpenRequest = Pe.Shared.StorageRuntime.Documents.OpenSettingsDocumentRequest;
using RuntimeSaveRequest = Pe.Shared.StorageRuntime.Documents.SaveSettingsDocumentRequest;
using RuntimeVersionToken = Pe.Shared.StorageRuntime.Documents.SettingsVersionToken;
using RuntimeWorkspaceDescriptor = Pe.Shared.StorageRuntime.Documents.SettingsWorkspaceDescriptor;
using RuntimeWorkspacesData = Pe.Shared.StorageRuntime.Documents.SettingsWorkspacesData;
using HostSettingsStorage = Pe.Shared.HostContracts.SettingsStorage;

namespace Pe.Host.Services;

internal static class SettingsTransportMapper {
    public static HostSettingsStorage.SettingsDiscoveryResult ToContract(this RuntimeDiscoveryResult result) =>
        new(
            result.Files.Select(ToContract).ToList(),
            result.Root.ToContract()
        );

    public static HostSettingsStorage.SettingsDocumentSnapshot ToContract(this RuntimeDocumentSnapshot snapshot) =>
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

    public static HostSettingsStorage.SaveSettingsDocumentResult ToContract(this RuntimeSaveResult result) =>
        new(
            result.Metadata.ToContract(),
            result.WriteApplied,
            result.ConflictDetected,
            result.ConflictMessage,
            result.Validation.ToContract()
        );

    public static HostSettingsStorage.SettingsValidationResult ToContract(this RuntimeValidationResult result) =>
        new(
            result.IsValid,
            result.Issues.Select(ToContract).ToList()
        );

    public static HostSettingsStorage.SettingsWorkspacesData ToContract(this RuntimeWorkspacesData data) =>
        new(data.Workspaces.Select(ToContract).ToList());

    public static RuntimeOpenRequest ToRuntime(this HostSettingsStorage.OpenSettingsDocumentRequest request) =>
        new(request.DocumentId.ToRuntime(), request.IncludeComposedContent);

    public static RuntimeSaveRequest ToRuntime(this HostSettingsStorage.SaveSettingsDocumentRequest request) =>
        new(
            request.DocumentId.ToRuntime(),
            request.RawContent,
            request.ExpectedVersionToken?.ToRuntime()
        );

    public static RuntimeValidateRequest ToRuntime(this HostSettingsStorage.ValidateSettingsDocumentRequest request) =>
        new(request.DocumentId.ToRuntime(), request.RawContent);

    private static HostSettingsStorage.SettingsWorkspacesData ToContract(
        this IReadOnlyList<RuntimeWorkspaceDescriptor> workspaces
    ) => new(workspaces.Select(ToContract).ToList());

    private static HostSettingsStorage.SettingsWorkspaceDescriptor ToContract(
        this RuntimeWorkspaceDescriptor descriptor) =>
        new(
            descriptor.WorkspaceKey,
            descriptor.DisplayName,
            descriptor.BasePath,
            descriptor.Modules.Select(ToContract).ToList()
        );

    private static HostSettingsStorage.SettingsModuleWorkspaceDescriptor ToContract(
        this RuntimeSettingsModuleWorkspaceDescriptor descriptor
    ) => new(
        descriptor.ModuleKey,
        descriptor.DefaultRootKey,
        descriptor.Roots.Select(ToContract).ToList()
    );

    private static HostSettingsStorage.SettingsRootDescriptor ToContract(this RuntimeRootDescriptor descriptor) =>
        new(descriptor.RootKey, descriptor.DisplayName);

    private static HostSettingsStorage.SettingsDocumentMetadata ToContract(this RuntimeDocumentMetadata metadata) =>
        new(
            metadata.DocumentId.ToContract(),
            metadata.Kind.ToContract(),
            metadata.ModifiedUtc,
            metadata.VersionToken?.ToContract()
        );

    private static HostSettingsStorage.SettingsDocumentDependency
        ToContract(this RuntimeDocumentDependency dependency) =>
        new(
            dependency.DocumentId.ToContract(),
            dependency.DirectivePath,
            dependency.Scope.ToContract(),
            dependency.Kind.ToContract()
        );

    private static HostSettingsStorage.SettingsDocumentId ToContract(this RuntimeDocumentId documentId) =>
        new(documentId.ModuleKey, documentId.RootKey, documentId.RelativePath);

    private static HostSettingsStorage.SettingsVersionToken ToContract(this RuntimeVersionToken token) =>
        new(token.Value);

    private static HostSettingsStorage.SettingsValidationIssue ToContract(this RuntimeValidationIssue issue) =>
        new(issue.Path, issue.Code, issue.Severity, issue.Message, issue.Suggestion);

    private static HostSettingsStorage.SettingsFileEntry ToContract(this RuntimeFileEntry entry) =>
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

    private static HostSettingsStorage.SettingsDirectoryNode ToContract(this RuntimeDirectoryNode node) =>
        new(
            node.Name,
            node.RelativePath,
            node.Directories.Select(ToContract).ToList(),
            node.Files.Select(ToContract).ToList()
        );

    private static HostSettingsStorage.SettingsFileNode ToContract(this RuntimeFileNode node) =>
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

    private static HostSettingsStorage.SettingsFileKind ToContract(this RuntimeFileKind kind) =>
        kind switch {
            RuntimeFileKind.Profile => HostSettingsStorage.SettingsFileKind.Profile,
            RuntimeFileKind.Fragment => HostSettingsStorage.SettingsFileKind.Fragment,
            RuntimeFileKind.Schema => HostSettingsStorage.SettingsFileKind.Schema,
            _ => HostSettingsStorage.SettingsFileKind.Other
        };

    private static HostSettingsStorage.SettingsDirectiveScope ToContract(this RuntimeDirectiveScope scope) =>
        scope == RuntimeDirectiveScope.Global
            ? HostSettingsStorage.SettingsDirectiveScope.Global
            : HostSettingsStorage.SettingsDirectiveScope.Local;

    private static HostSettingsStorage.SettingsDocumentDependencyKind ToContract(
        this RuntimeDocumentDependencyKind kind
    ) =>
        kind == RuntimeDocumentDependencyKind.Preset
            ? HostSettingsStorage.SettingsDocumentDependencyKind.Preset
            : HostSettingsStorage.SettingsDocumentDependencyKind.Include;

    private static RuntimeDocumentId ToRuntime(this HostSettingsStorage.SettingsDocumentId documentId) =>
        new(documentId.ModuleKey, documentId.RootKey, documentId.RelativePath);

    private static RuntimeVersionToken ToRuntime(this HostSettingsStorage.SettingsVersionToken token) =>
        new(token.Value);
}