using Pe.StorageRuntime.Capabilities;
using Pe.StorageRuntime.Context;

namespace Pe.StorageRuntime.Json.FieldOptions;

public sealed record FieldOptionsDependency(
    string Key,
    SettingsOptionsDependencyScope Scope
);

public sealed record FieldOptionItem(
    string Value,
    string Label,
    string? Description
);

public sealed record FieldOptionsDescriptor(
    string Key,
    SettingsOptionsResolverKind Resolver,
    SettingsOptionsDatasetKind? Dataset,
    SettingsOptionsMode Mode,
    bool AllowsCustomValue,
    IReadOnlyList<FieldOptionsDependency> DependsOn,
    SettingsRuntimeCapabilities RequiredCapabilities
);

public sealed record FieldOptionsExecutionContext {
    private static readonly IReadOnlyDictionary<string, string> EmptyFieldValues =
        new Dictionary<string, string>(StringComparer.Ordinal);

    public FieldOptionsExecutionContext(
        SettingsRuntimeCapabilities capabilities,
        ISettingsDocumentContextAccessor? documentContextAccessor = null,
        IReadOnlyDictionary<string, string>? fieldValues = null
    ) {
        this.Capabilities = capabilities ?? throw new ArgumentNullException(nameof(capabilities));
        this.DocumentContextAccessor = documentContextAccessor;
        this.FieldValues = fieldValues ?? EmptyFieldValues;
    }

    public SettingsRuntimeCapabilities Capabilities { get; }
    public ISettingsDocumentContextAccessor? DocumentContextAccessor { get; }
    public IReadOnlyDictionary<string, string> FieldValues { get; }

    public TDocument? GetActiveDocument<TDocument>() where TDocument : class =>
        this.DocumentContextAccessor?.GetActiveDocument() as TDocument;

    public bool TryGetFieldValue(string key, out string value) =>
        this.FieldValues.TryGetValue(key, out value!);

    public bool TryGetContextValue(string key, out string value) =>
        this.TryGetFieldValue(key, out value);
}

public interface IFieldOptionsSource {
    FieldOptionsDescriptor Describe();

    ValueTask<IReadOnlyList<FieldOptionItem>> GetOptionsAsync(
        FieldOptionsExecutionContext context,
        CancellationToken cancellationToken = default
    );
}

public enum FieldOptionsResultKind {
    Success,
    Empty,
    Unsupported,
    Failure
}

public sealed record FieldOptionsResult(
    FieldOptionsResultKind Kind,
    string Message,
    FieldOptionsDescriptor? Descriptor,
    IReadOnlyList<FieldOptionItem> Items
);
