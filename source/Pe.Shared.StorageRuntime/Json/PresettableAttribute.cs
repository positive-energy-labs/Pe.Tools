namespace Pe.Shared.StorageRuntime.Json;

[AttributeUsage(AttributeTargets.Property)]
public sealed class PresettableAttribute : Attribute {
    public PresettableAttribute(IncludableFragmentRoot fragmentRoot)
        : this(IncludableFragmentRoots.ToSchemaName(fragmentRoot)) {
    }

    public PresettableAttribute(string fragmentSchemaName) {
        if (string.IsNullOrWhiteSpace(fragmentSchemaName))
            throw new ArgumentException("Preset fragment root is required.", nameof(fragmentSchemaName));
        this.FragmentSchemaName = fragmentSchemaName;
    }

    public string FragmentSchemaName { get; }
}