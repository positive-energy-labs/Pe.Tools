namespace Pe.Shared.RevitData;

/// <summary>
///     Binds a request DTO property to a registered value domain so generated request schemas
///     carry that domain's <c>x-options</c> descriptor (the same node the settings schema pipeline
///     emits and @pe/schema-core reads). Forms read the options through the <c>field-options</c> Reading.
/// </summary>
[AttributeUsage(AttributeTargets.Property)]
public sealed class FieldOptionsAttribute(string sourceKey) : Attribute {
    /// <summary>Value-domain key, e.g. "category-names" (see SettingsRuntime ValueDomainKeys).</summary>
    public string SourceKey { get; } = sourceKey;
}
