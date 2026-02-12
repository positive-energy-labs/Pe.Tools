namespace Pe.Global.Services.Storage.Core.Json;

/// <summary>
///     Marks a list property for uniform-child-key serialization.
///     When applied, all object-like children in the list are serialized with the same key set.
///     Missing keys are emitted with <see cref="MissingValue" />.
/// </summary>
[AttributeUsage(AttributeTargets.Property)]
public class UniformChildKeysAttribute : Attribute {
    /// <summary>
    ///     Initializes a new attribute that forces list child objects to share uniform keys at write time.
    /// </summary>
    /// <param name="missingValue">Value used for missing keys. Defaults to empty string.</param>
    public UniformChildKeysAttribute(string missingValue = "") => this.MissingValue = missingValue;

    /// <summary>
    ///     Value emitted for missing keys during serialization.
    /// </summary>
    public string MissingValue { get; }
}
