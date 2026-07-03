using Pe.Shared.Codegen;

namespace Pe.Shared.StorageRuntime.Capabilities;

[ExportTsSchema]
public enum SettingsOptionsResolverKind {
    Remote,
    Dataset
}

[ExportTsSchema]
public enum SettingsOptionsMode {
    Suggestion,
    Constraint
}

[ExportTsSchema]
public enum SettingsOptionsDependencyScope {
    Sibling,
    Context
}

[ExportTsSchema]
public sealed record SettingsOptionsDependency(
    string Key,
    SettingsOptionsDependencyScope Scope
);

// Single source of truth for a field's options source: the runtime descriptor is
// also the TS-exported wire shape. The x-options payload carries every field
// except RequiredRuntimeMode, which the writer emits separately under
// x-runtime-capabilities; the browser reads x-options loosely, so the extra
// field is harmless.
[ExportTsSchema]
public sealed record SettingsValueDomainDescriptor(
    string Key,
    SettingsOptionsResolverKind Resolver,
    SettingsOptionsMode Mode,
    bool AllowsCustomValue,
    IReadOnlyList<SettingsOptionsDependency> DependsOn,
    SettingsRuntimeMode RequiredRuntimeMode
);
