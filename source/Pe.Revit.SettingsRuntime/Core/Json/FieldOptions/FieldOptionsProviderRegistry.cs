namespace Pe.Revit.SettingsRuntime.Core.Json.FieldOptions;

public interface IFieldOptionsProviderRegistry {
    void Register(string providerKey, Func<IFieldOptionsSource> factory);
    bool TryCreate(string providerKey, out IFieldOptionsSource source);
    void Clear();
}

public sealed class FieldOptionsProviderRegistry : IFieldOptionsProviderRegistry {
    private readonly Dictionary<string, Func<IFieldOptionsSource>> _factories =
        new(StringComparer.OrdinalIgnoreCase);

    public static FieldOptionsProviderRegistry Shared { get; } = new();

    public void Register(string providerKey, Func<IFieldOptionsSource> factory) {
        if (string.IsNullOrWhiteSpace(providerKey))
            throw new ArgumentException("Provider key is required.", nameof(providerKey));
        if (factory == null)
            throw new ArgumentNullException(nameof(factory));

        this._factories[providerKey] = factory;
    }

    public bool TryCreate(string providerKey, out IFieldOptionsSource source) {
        if (string.IsNullOrWhiteSpace(providerKey) || !this._factories.TryGetValue(providerKey, out var factory)) {
            source = null!;
            return false;
        }

        source = factory();
        return true;
    }

    public void Clear() => this._factories.Clear();
}