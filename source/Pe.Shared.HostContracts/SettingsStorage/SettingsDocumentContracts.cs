using Pe.Shared.HostContracts.Protocol;
using Pe.Shared.Codegen;

namespace Pe.Shared.HostContracts.SettingsStorage;

[ExportTsSchema]
public record SettingsModuleStorageOptionsContract(
    List<string> IncludeRoots,
    List<string> PresetRoots
);

[ExportTsSchema]
public record SettingsRootDescriptor(
    string RootKey,
    string DisplayName
);

[ExportTsSchema]
public record SettingsModuleDescriptor(
    string ModuleKey,
    string DefaultRootKey,
    List<SettingsRootDescriptor> Roots,
    SettingsModuleStorageOptionsContract StorageOptions,
    HostModuleScope Scope,
    HostModuleActiveDocumentKind ActiveDocumentKind
);

[ExportTsSchema]
public record GetSettingsModuleCatalogBridgeResponse(
    List<SettingsModuleDescriptor> Modules
);
