namespace Pe.Shared.StorageRuntime.Json;

[AttributeUsage(AttributeTargets.Property)]
public class UniformChildKeysAttribute : Attribute {
    public UniformChildKeysAttribute(string missingValue = "") => this.MissingValue = missingValue;

    public string MissingValue { get; }
}