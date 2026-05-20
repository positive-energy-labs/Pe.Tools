namespace Pe.Shared.StorageRuntime.Capabilities;

public enum SettingsOptionsResolverKind {
    Remote,
    Dataset
}

public enum SettingsOptionsMode {
    Suggestion,
    Constraint
}

public enum SettingsOptionsDependencyScope {
    Sibling,
    Context
}

public sealed record SettingsOptionsDependency(
    string Key,
    SettingsOptionsDependencyScope Scope
);

public sealed record SettingsValueDomainDescriptor(
    string Key,
    SettingsOptionsResolverKind Resolver,
    SettingsOptionsMode Mode,
    bool AllowsCustomValue,
    IReadOnlyList<SettingsOptionsDependency> DependsOn,
    SettingsRuntimeMode RequiredRuntimeMode
);