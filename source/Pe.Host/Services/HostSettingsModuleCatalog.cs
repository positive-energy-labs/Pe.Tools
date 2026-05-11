using Pe.Shared.HostContracts.Operations;
using Pe.Shared.HostContracts.Protocol;
using Pe.Shared.HostContracts.SettingsStorage;
using Pe.Shared.StorageRuntime;
using Pe.Shared.StorageRuntime.Modules;
using HostSettingsModuleDescriptor = Pe.Shared.HostContracts.Protocol.HostModuleDescriptor;
using HostRootDescriptor = Pe.Shared.HostContracts.SettingsStorage.SettingsRootDescriptor;
using HostSettingsModuleWorkspaceDescriptor = Pe.Shared.HostContracts.SettingsStorage.SettingsModuleWorkspaceDescriptor;
using HostWorkspaceDescriptor = Pe.Shared.HostContracts.SettingsStorage.SettingsWorkspaceDescriptor;
using HostWorkspacesData = Pe.Shared.HostContracts.SettingsStorage.SettingsWorkspacesData;
using RuntimeRootDescriptor = Pe.Shared.StorageRuntime.Documents.SettingsRootDescriptor;

namespace Pe.Host.Services;

public interface IHostSettingsModuleCatalog {
    Task<IReadOnlyList<StructuralSettingsModuleDescriptor>> GetModulesAsync(
        CancellationToken cancellationToken = default
    );

    Task<HostWorkspacesData> GetWorkspacesAsync(
        CancellationToken cancellationToken = default
    );

    Task<StructuralSettingsModuleDescriptor?> TryGetModuleAsync(
        string moduleKey,
        CancellationToken cancellationToken = default
    );
}

public sealed class HostSettingsModuleCatalog(
    BridgeServer bridgeServer
) : IHostSettingsModuleCatalog {
    private readonly BridgeServer _bridgeServer = bridgeServer;

    public async Task<IReadOnlyList<StructuralSettingsModuleDescriptor>> GetModulesAsync(
        CancellationToken cancellationToken = default
    ) {
        var modules = StorageRuntimeStructuralModules.All.ToDictionary(
            module => module.ModuleKey,
            StringComparer.OrdinalIgnoreCase
        );

        if (!this._bridgeServer.GetSnapshot().BridgeIsConnected)
            return modules.Values.ToList();

        var response = await this._bridgeServer.InvokeAsync<
            GetSettingsModuleCatalogBridgeRequest,
            GetSettingsModuleCatalogBridgeResponse
        >(
            GetSettingsModuleCatalogBridgeOperationContract.Definition.Key,
            new GetSettingsModuleCatalogBridgeRequest(),
            cancellationToken
        );

        foreach (var module in response.Modules.Select(ToStructuralDescriptor)) {
            if (!modules.ContainsKey(module.ModuleKey))
                modules[module.ModuleKey] = module;
        }

        return modules.Values.ToList();
    }

    public async Task<HostWorkspacesData> GetWorkspacesAsync(
        CancellationToken cancellationToken = default
    ) {
        var modules = await this.GetModulesAsync(cancellationToken);
        return new HostWorkspacesData([
            new HostWorkspaceDescriptor(
                "default",
                "Default Workspace",
                SettingsStorageLocations.GetDefaultBasePath(),
                modules.Select(module => new HostSettingsModuleWorkspaceDescriptor(
                    module.ModuleKey,
                    module.DefaultRootKey,
                    module.Roots
                        .Select(root => new HostRootDescriptor(root.RootKey, root.DisplayName))
                        .ToList()
                )).ToList()
            )
        ]);
    }

    public async Task<StructuralSettingsModuleDescriptor?> TryGetModuleAsync(
        string moduleKey,
        CancellationToken cancellationToken = default
    ) => (await this.GetModulesAsync(cancellationToken))
        .FirstOrDefault(module => string.Equals(module.ModuleKey, moduleKey, StringComparison.OrdinalIgnoreCase));

    public static IReadOnlyList<HostSettingsModuleDescriptor> GetCatalogDescriptors(BridgeRuntimeSnapshot snapshot) {
        var descriptors = StorageRuntimeStructuralModules.All
            .Select(CreateTransportDescriptor)
            .ToDictionary(descriptor => descriptor.ModuleKey, StringComparer.OrdinalIgnoreCase);

        foreach (var module in snapshot.ConnectedSession?.AvailableModules ?? []) {
            if (!descriptors.ContainsKey(module.ModuleKey))
                descriptors[module.ModuleKey] = module;
        }

        return descriptors.Values.ToList();
    }

    private static StructuralSettingsModuleDescriptor ToStructuralDescriptor(SettingsModuleDescriptor module) =>
        new(
            module.ModuleKey,
            module.DefaultRootKey,
            module.Roots
                .Select(root => new RuntimeRootDescriptor(root.RootKey, root.DisplayName))
                .ToList(),
            new SettingsStorageModuleOptions(
                module.StorageOptions.IncludeRoots,
                module.StorageOptions.PresetRoots
            ),
            module.Scope switch {
                HostModuleScope.Host => SettingsModuleHostScope.Host,
                HostModuleScope.ActiveDocument => SettingsModuleHostScope.ActiveDocument,
                _ => SettingsModuleHostScope.Session
            },
            module.ActiveDocumentKind switch {
                HostModuleActiveDocumentKind.ProjectOnly => SettingsModuleActiveDocumentKind.ProjectOnly,
                HostModuleActiveDocumentKind.FamilyOnly => SettingsModuleActiveDocumentKind.FamilyOnly,
                _ => SettingsModuleActiveDocumentKind.Any
            }
        );

    private static HostSettingsModuleDescriptor CreateTransportDescriptor(StructuralSettingsModuleDescriptor module) =>
        new(
            module.ModuleKey,
            module.DefaultRootKey,
            module.HostScope switch {
                SettingsModuleHostScope.Host => HostModuleScope.Host,
                SettingsModuleHostScope.ActiveDocument => HostModuleScope.ActiveDocument,
                _ => HostModuleScope.Session
            },
            module.ActiveDocumentKind switch {
                SettingsModuleActiveDocumentKind.ProjectOnly => HostModuleActiveDocumentKind.ProjectOnly,
                SettingsModuleActiveDocumentKind.FamilyOnly => HostModuleActiveDocumentKind.FamilyOnly,
                _ => HostModuleActiveDocumentKind.Any
            }
        );
}
