using Pe.Shared.StorageRuntime.Documents;

namespace Pe.Shared.StorageRuntime.Modules;

/// <summary>A settings library: its module name and the roots its `$schema` URLs name.</summary>
public sealed record StructuralSettingsModuleDescriptor(
    string ModuleKey,
    IReadOnlyList<SettingsRootDescriptor> Roots
);

public interface ISettingsRootBinding {
    StructuralSettingsModuleDescriptor Module { get; }
    string RootKey { get; }
    Type SettingsType { get; }
}

public interface ISettingsRootBinding<TSettings> : ISettingsRootBinding where TSettings : class;

public sealed class SettingsRootBinding<TSettings>(
    StructuralSettingsModuleDescriptor module,
    string root
) : ISettingsRootBinding<TSettings> where TSettings : class {
    public StructuralSettingsModuleDescriptor Module { get; } = module ?? throw new ArgumentNullException(nameof(module));

    public string RootKey { get; } = string.IsNullOrWhiteSpace(root)
        ? throw new ArgumentException("Root is required.", nameof(root))
        : root;

    public Type SettingsType => typeof(TSettings);
}
