using Pe.StorageRuntime.Capabilities;
using Pe.StorageRuntime.Context;

namespace Pe.StorageRuntime.Json.SchemaProviders;

public sealed class SettingsProviderContext(
    SettingsCapabilityTier availableCapabilityTier,
    ISettingsDocumentContextAccessor? documentContextAccessor = null,
    IReadOnlyDictionary<string, string>? contextValues = null
    ) {
    private static readonly IReadOnlyDictionary<string, string> EmptyContextValues =
        new Dictionary<string, string>(StringComparer.Ordinal);

    public SettingsCapabilityTier AvailableCapabilityTier { get; } = availableCapabilityTier;
    public IReadOnlyDictionary<string, string> ContextValues { get; } = contextValues ?? EmptyContextValues;
    public ISettingsDocumentContextAccessor? DocumentContextAccessor { get; } = documentContextAccessor;

    public TDocument? GetActiveDocument<TDocument>() where TDocument : class =>
        this.DocumentContextAccessor?.GetActiveDocument() as TDocument;

    public bool TryGetContextValue(string key, out string value) => this.ContextValues.TryGetValue(key, out value!);
}
