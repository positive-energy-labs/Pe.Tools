using Pe.StorageRuntime.Capabilities;
using Pe.StorageRuntime.Context;

namespace Pe.StorageRuntime.Revit.Core.Json.SchemaProviders;

public sealed class SettingsProviderContext {
    private static readonly IReadOnlyDictionary<string, string> EmptyContextValues =
        new Dictionary<string, string>(StringComparer.Ordinal);

    public SettingsProviderContext(
        SettingsCapabilityTier availableCapabilityTier,
        ISettingsDocumentContextAccessor? documentContextAccessor = null,
        IReadOnlyDictionary<string, string>? contextValues = null
    ) {
        this.AvailableCapabilityTier = availableCapabilityTier;
        this.DocumentContextAccessor = documentContextAccessor;
        this.ContextValues = contextValues ?? EmptyContextValues;
    }

    public SettingsCapabilityTier AvailableCapabilityTier { get; }
    public IReadOnlyDictionary<string, string> ContextValues { get; }
    public ISettingsDocumentContextAccessor? DocumentContextAccessor { get; }

    public TDocument? GetActiveDocument<TDocument>() where TDocument : class =>
        this.DocumentContextAccessor?.GetActiveDocument() as TDocument;

    public bool TryGetContextValue(string key, out string value) => this.ContextValues.TryGetValue(key, out value!);
}
