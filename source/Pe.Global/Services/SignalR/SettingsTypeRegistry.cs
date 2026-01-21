using Pe.Global.Services.AutoTag.Core;

namespace Pe.Global.Services.SignalR;

/// <summary>
///     Registry of settings types that can be edited through the settings editor.
///     Maps friendly type names to their actual .NET types.
/// </summary>
public class SettingsTypeRegistry {
    private readonly Dictionary<string, Type> _types = new(StringComparer.OrdinalIgnoreCase);
    private readonly Dictionary<string, string> _storageNames = new(StringComparer.OrdinalIgnoreCase);

    public SettingsTypeRegistry() {
        // Register built-in types
        this.Register<AutoTagSettings>("AutoTagSettings", "AutoTag");

        // Note: ProfileRemap and ScheduleSpec are in Pe.FamilyFoundry which may not be available
        // They should be registered by the consuming application if needed
    }

    /// <summary>
    ///     Register a settings type with its friendly name and storage name.
    /// </summary>
    public void Register<T>(string typeName, string storageName) where T : class {
        this._types[typeName] = typeof(T);
        this._storageNames[typeName] = storageName;
    }

    /// <summary>
    ///     Register a settings type with its friendly name and storage name.
    /// </summary>
    public void Register(Type type, string typeName, string storageName) {
        this._types[typeName] = type;
        this._storageNames[typeName] = storageName;
    }

    /// <summary>
    ///     Resolve a type name to its actual .NET type.
    /// </summary>
    public Type ResolveType(string typeName) {
        if (this._types.TryGetValue(typeName, out var type))
            return type;

        throw new ArgumentException($"Unknown settings type: {typeName}. " +
                                    $"Available types: {string.Join(", ", this._types.Keys)}");
    }

    /// <summary>
    ///     Get the storage name for a settings type (used to locate files).
    /// </summary>
    public string GetStorageName(string typeName) {
        if (this._storageNames.TryGetValue(typeName, out var storageName))
            return storageName;

        throw new ArgumentException($"Unknown settings type: {typeName}");
    }

    /// <summary>
    ///     Get all registered type names.
    /// </summary>
    public IEnumerable<string> GetRegisteredTypes() => this._types.Keys;
}
