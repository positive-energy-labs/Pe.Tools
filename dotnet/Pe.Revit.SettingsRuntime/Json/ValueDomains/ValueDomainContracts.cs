using Pe.Shared.StorageRuntime.Capabilities;

namespace Pe.Revit.SettingsRuntime.Json.ValueDomains;

public sealed record ValueDomainOptionItem(
    string Value,
    string Label,
    string? Description,
    Dictionary<string, string>? Metadata = null
);

public sealed record ValueDomainExecutionContext {
    private static readonly IReadOnlyDictionary<string, string> EmptyFieldValues =
        new Dictionary<string, string>(StringComparer.Ordinal);

    public ValueDomainExecutionContext(
        SettingsRuntimeMode runtimeMode,
        IReadOnlyDictionary<string, string>? fieldValues = null,
        Document? document = null
    ) {
        this.RuntimeMode = runtimeMode;
        this.FieldValues = fieldValues ?? EmptyFieldValues;
        this.Document = document;
    }

    public SettingsRuntimeMode RuntimeMode { get; }
    public IReadOnlyDictionary<string, string> FieldValues { get; }
    private Document? Document { get; }

    public Document GetActiveDocument() => this.Document
                                           ?? throw new InvalidOperationException("No document was supplied for live value-domain resolution.");

    public bool TryGetFieldValue(string key, out string value) =>
        this.FieldValues.TryGetValue(key, out value!);

    public bool TryGetContextValue(string key, out string value) =>
        this.TryGetFieldValue(key, out value);
}

public interface ISettingsValueDomain {
    SettingsValueDomainDescriptor Describe();

    ValueTask<IReadOnlyList<ValueDomainOptionItem>> GetOptionsAsync(
        ValueDomainExecutionContext context,
        CancellationToken cancellationToken = default
    );
}

public enum ValueDomainResultKind {
    Success,
    Empty,
    Unsupported,
    Failure
}

public sealed record ValueDomainResult(
    ValueDomainResultKind Kind,
    string Message,
    SettingsValueDomainDescriptor? Descriptor,
    IReadOnlyList<ValueDomainOptionItem> Items
);
