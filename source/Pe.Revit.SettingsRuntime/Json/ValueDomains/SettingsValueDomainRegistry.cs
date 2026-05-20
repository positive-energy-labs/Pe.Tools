using Pe.Shared.StorageRuntime.Capabilities;

namespace Pe.Revit.SettingsRuntime.Json.ValueDomains;

public interface ISettingsValueDomainRegistry {
    void Register(string domainKey, Func<ISettingsValueDomain> factory);
    bool TryCreate(string domainKey, out ISettingsValueDomain domain);
    bool TryDescribe(string domainKey, out SettingsValueDomainDescriptor descriptor);
    void Clear();
}

public sealed class SettingsValueDomainRegistry : ISettingsValueDomainRegistry {
    private readonly Dictionary<string, Func<ISettingsValueDomain>> _factories =
        new(StringComparer.OrdinalIgnoreCase);

    public static SettingsValueDomainRegistry Shared { get; } = new();

    public void Register(string domainKey, Func<ISettingsValueDomain> factory) {
        if (string.IsNullOrWhiteSpace(domainKey))
            throw new ArgumentException("Value domain key is required.", nameof(domainKey));
        if (factory == null)
            throw new ArgumentNullException(nameof(factory));

        this._factories[domainKey] = factory;
    }

    public bool TryCreate(string domainKey, out ISettingsValueDomain domain) {
        if (string.IsNullOrWhiteSpace(domainKey) || !this._factories.TryGetValue(domainKey, out var factory)) {
            domain = null!;
            return false;
        }

        domain = factory();
        return true;
    }

    public bool TryDescribe(string domainKey, out SettingsValueDomainDescriptor descriptor) {
        if (!this.TryCreate(domainKey, out var domain)) {
            descriptor = null!;
            return false;
        }

        descriptor = domain.Describe();
        return true;
    }

    public void Clear() => this._factories.Clear();
}
