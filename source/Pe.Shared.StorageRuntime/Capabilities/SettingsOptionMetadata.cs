using TypeGen.Core.TypeAnnotations;

namespace Pe.Shared.StorageRuntime.Capabilities;

[ExportTsEnum]
public enum SettingsOptionsResolverKind {
    Remote,
    Dataset
}

[ExportTsEnum]
public enum SettingsOptionsMode {
    Suggestion,
    Constraint
}

[ExportTsEnum]
public enum SettingsOptionsDependencyScope {
    Sibling,
    Context
}

[ExportTsInterface]
public sealed record SettingsOptionsDependency(
    string Key,
    SettingsOptionsDependencyScope Scope
);

// Single source of truth for a field's options source: the runtime descriptor is
// also the TS-exported wire shape. The x-options payload carries every field
// except RequiredRuntimeMode, which the writer emits separately under
// x-runtime-capabilities; the browser reads x-options loosely, so the extra
// field is harmless.
[ExportTsInterface]
public sealed record SettingsValueDomainDescriptor(
    string Key,
    SettingsOptionsResolverKind Resolver,
    SettingsOptionsMode Mode,
    bool AllowsCustomValue,
    IReadOnlyList<SettingsOptionsDependency> DependsOn,
    SettingsRuntimeMode RequiredRuntimeMode
);
