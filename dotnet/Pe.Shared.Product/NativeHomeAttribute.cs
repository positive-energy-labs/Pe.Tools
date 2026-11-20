namespace Pe.Shared.Product;

/// <summary>Expose an owning static field to the offline operation catalog.</summary>
[AttributeUsage(AttributeTargets.Field)]
public sealed class NativeHomeAttribute(string name, string kind = "owner-blob") : Attribute {
    public string Name { get; } = name;
    public string Kind { get; } = kind;
}
