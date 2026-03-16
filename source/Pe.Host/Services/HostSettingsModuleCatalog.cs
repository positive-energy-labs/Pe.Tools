using Pe.SettingsCatalog.Revit;
using Pe.Host.Contracts;
using Pe.StorageRuntime;
using Pe.StorageRuntime.Capabilities;
using Pe.StorageRuntime.Modules;
using HostSettingsModuleDescriptor = Pe.Host.Contracts.SettingsModuleDescriptor;
using HostRootDescriptor = Pe.Host.Contracts.SettingsRootDescriptor;
using HostSettingsModuleWorkspaceDescriptor = Pe.Host.Contracts.SettingsModuleWorkspaceDescriptor;
using HostWorkspaceDescriptor = Pe.Host.Contracts.SettingsWorkspaceDescriptor;
using HostWorkspacesData = Pe.Host.Contracts.SettingsWorkspacesData;

namespace Pe.Host.Services;

public interface IHostSettingsModuleCatalog {
    IReadOnlyList<SettingsSchemaRegistration> GetModules();

    IReadOnlyList<HostSettingsModuleDescriptor> GetTransportDescriptors();

    IReadOnlyDictionary<string, SettingsStorageModuleDefinition> GetStorageDefinitions();

    HostWorkspacesData GetWorkspaces();

    bool TryGetModule(string moduleKey, out SettingsSchemaRegistration module);
}

public sealed class HostSettingsModuleCatalog : IHostSettingsModuleCatalog {
    private readonly SettingsRuntimeCapabilities _availableCapabilities;
    private readonly IReadOnlyList<SettingsSchemaRegistration> _modules = KnownSettingsSchemas.All;
    private readonly IReadOnlyDictionary<string, SettingsSchemaRegistration> _modulesByModuleKey;
    private readonly IReadOnlyList<HostSettingsModuleDescriptor> _transportDescriptors;
    private readonly HostWorkspacesData _workspaces;

    public HostSettingsModuleCatalog()
        : this(null, SettingsRuntimeCapabilityProfiles.RevitAssemblyOnly) { }

    public HostSettingsModuleCatalog(IHostBridgeCapabilityService bridgeCapabilityService)
        : this(bridgeCapabilityService, SettingsRuntimeCapabilityProfiles.RevitAssemblyOnly) { }

    public HostSettingsModuleCatalog(
        IHostBridgeCapabilityService? bridgeCapabilityService,
        SettingsRuntimeCapabilities availableCapabilities
    ) {
        this._availableCapabilities = availableCapabilities;
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

    public IReadOnlyList<SettingsSchemaRegistration> GetModules() => this._modules;

    public IReadOnlyList<HostSettingsModuleDescriptor> GetTransportDescriptors() => this._transportDescriptors;

    public IReadOnlyDictionary<string, SettingsStorageModuleDefinition> GetStorageDefinitions() =>
        KnownSettingsStorageDefinitions.Create(this._availableCapabilities);

    public HostWorkspacesData GetWorkspaces() => this._workspaces;

    public bool TryGetModule(string moduleKey, out SettingsSchemaRegistration module) =>
        this._modulesByModuleKey.TryGetValue(moduleKey, out module!);
}
