using Pe.Shared.SettingsCatalog;
using Pe.Shared.SettingsCatalog.Manifests;
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
    IReadOnlyList<HostSettingsModuleDescriptor> GetTransportDescriptors();
    HostWorkspacesData GetWorkspaces();
    bool TryGetModule(string moduleKey, out ISettingsModuleManifest module);
}

public sealed class HostSettingsModuleCatalog : IHostSettingsModuleCatalog {
    private readonly SettingsRuntimeMode _runtimeMode;
    private readonly IReadOnlyList<ISettingsModuleManifest> _modules = KnownSettingsRegistry.All;
    private readonly IReadOnlyDictionary<string, ISettingsModuleManifest> _modulesByModuleKey;
    private readonly IReadOnlyList<HostSettingsModuleDescriptor> _transportDescriptors;
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
        this._transportDescriptors = this._modules
            .Select(module => new HostSettingsModuleDescriptor(
                module.ModuleKey,
                module.DefaultRootKey
            ))
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
    public IReadOnlyList<HostSettingsModuleDescriptor> GetTransportDescriptors() => this._transportDescriptors;
    public HostWorkspacesData GetWorkspaces() => this._workspaces;

    public bool TryGetModule(string moduleKey, out ISettingsModuleManifest module) =>
        this._modulesByModuleKey.TryGetValue(moduleKey, out module!);
}
