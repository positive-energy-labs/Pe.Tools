using Pe.Revit.FamilyFoundry;
using Pe.Revit.Global.Revit.Documents.Schedules;
using Pe.Shared.StorageRuntime;
using Pe.Shared.StorageRuntime.Capabilities;
using Pe.Shared.StorageRuntime.Modules;
using HostSettingsModuleDescriptor = Pe.Shared.HostContracts.Protocol.HostModuleDescriptor;
using HostRootDescriptor = Pe.Shared.HostContracts.SettingsStorage.SettingsRootDescriptor;
using HostSettingsModuleWorkspaceDescriptor = Pe.Shared.HostContracts.SettingsStorage.SettingsModuleWorkspaceDescriptor;
using HostWorkspaceDescriptor = Pe.Shared.HostContracts.SettingsStorage.SettingsWorkspaceDescriptor;
using HostWorkspacesData = Pe.Shared.HostContracts.SettingsStorage.SettingsWorkspacesData;

namespace Pe.Host.Services;

public interface IHostSettingsModuleCatalog {
    IReadOnlyList<ISettingsModuleManifest> GetModules();
    IReadOnlyList<HostSettingsModuleDescriptor> GetCatalogDescriptors();
    HostWorkspacesData GetWorkspaces();
    bool TryGetModule(string moduleKey, out ISettingsModuleManifest module);
}

public sealed class HostSettingsModuleCatalog : IHostSettingsModuleCatalog {
    private readonly SettingsRuntimeMode _runtimeMode;
    private readonly IReadOnlyList<ISettingsModuleManifest> _modules =
        SettingsModuleCatalogComposer.Combine(
            StorageRuntimeSettingsModules.All,
            RevitGlobalSettingsModules.All,
            FamilyFoundrySettingsModules.All
        );
    private readonly IReadOnlyDictionary<string, ISettingsModuleManifest> _modulesByModuleKey;
    private readonly IReadOnlyList<HostSettingsModuleDescriptor> _catalogDescriptors;
    private readonly HostWorkspacesData _workspaces;

    public HostSettingsModuleCatalog()
        : this(SettingsRuntimeMode.HostOnly) {
    }

    public HostSettingsModuleCatalog(SettingsRuntimeMode runtimeMode) {
        this._runtimeMode = runtimeMode;
        this._modulesByModuleKey = this._modules.ToDictionary(
            module => module.ModuleKey,
            StringComparer.OrdinalIgnoreCase
        );
        this._catalogDescriptors = this._modules
            .Select(CreateTransportDescriptor)
            .ToList();
        this._workspaces = new HostWorkspacesData([
            new HostWorkspaceDescriptor(
                "default",
                "Default Workspace",
                SettingsStorageLocations.GetDefaultBasePath(),
                this._modules.Select(module => new HostSettingsModuleWorkspaceDescriptor(
                    module.ModuleKey,
                    module.DefaultRootKey,
                    module.Roots
                        .Select(root => new HostRootDescriptor(root.RootKey, root.DisplayName))
                        .ToList()
                )).ToList()
            )
        ]);
    }

    public IReadOnlyList<ISettingsModuleManifest> GetModules() => this._modules;
    public IReadOnlyList<HostSettingsModuleDescriptor> GetCatalogDescriptors() => this._catalogDescriptors;
    public HostWorkspacesData GetWorkspaces() => this._workspaces;

    public bool TryGetModule(string moduleKey, out ISettingsModuleManifest module) =>
        this._modulesByModuleKey.TryGetValue(moduleKey, out module!);

    private static HostSettingsModuleDescriptor CreateTransportDescriptor(ISettingsModuleManifest module) =>
        new(
            module.ModuleKey,
            module.DefaultRootKey,
            module.HostScope switch {
                SettingsModuleHostScope.Host => Pe.Shared.HostContracts.Protocol.HostModuleScope.Host,
                SettingsModuleHostScope.ActiveDocument => Pe.Shared.HostContracts.Protocol.HostModuleScope.ActiveDocument,
                _ => Pe.Shared.HostContracts.Protocol.HostModuleScope.Session
            },
            module.ActiveDocumentKind switch {
                SettingsModuleActiveDocumentKind.ProjectOnly => Pe.Shared.HostContracts.Protocol.HostModuleActiveDocumentKind.ProjectOnly,
                SettingsModuleActiveDocumentKind.FamilyOnly => Pe.Shared.HostContracts.Protocol.HostModuleActiveDocumentKind.FamilyOnly,
                _ => Pe.Shared.HostContracts.Protocol.HostModuleActiveDocumentKind.Any
            }
        );
}
