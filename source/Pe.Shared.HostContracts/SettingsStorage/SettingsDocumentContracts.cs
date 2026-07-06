using Pe.Shared.HostContracts.Protocol;

namespace Pe.Shared.HostContracts.SettingsStorage;

public record SettingsModuleStorageOptionsContract(
    List<string> IncludeRoots,
    List<string> PresetRoots
);

public record SettingsRootDescriptor(
    string RootKey,
    string DisplayName
);

public record SettingsModuleDescriptor(
    string ModuleKey,
    string DefaultRootKey,
    List<SettingsRootDescriptor> Roots,
    SettingsModuleStorageOptionsContract StorageOptions,
    HostModuleScope Scope,
    HostModuleActiveDocumentKind ActiveDocumentKind
);

public record GetSettingsModuleCatalogBridgeResponse(
    List<SettingsModuleDescriptor> Modules
);
