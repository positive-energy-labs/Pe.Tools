namespace Pe.Shared.StorageRuntime.Core.Json.RevitTypes;

public enum ForgeKind {
    Spec,
    Group
}

[AttributeUsage(AttributeTargets.Property)]
public class ForgeKindAttribute(ForgeKind kind) : Attribute {
    public ForgeKind Kind { get; } = kind;
}
