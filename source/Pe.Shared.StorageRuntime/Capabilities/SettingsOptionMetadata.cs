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

public record SettingsOptionsDependency(
    string Key,
    SettingsOptionsDependencyScope Scope
);