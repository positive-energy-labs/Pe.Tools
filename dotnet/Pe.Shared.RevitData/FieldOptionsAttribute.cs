namespace Pe.Shared.RevitData;

/// <summary>
///     Binds a request DTO property to a live value domain so generated request schemas
///     carry an <c>x-options</c> node (the same shape the settings schema pipeline emits and
///     @pe/schema-core reads). Forms resolve the options at runtime through the
///     <c>revit.catalog.field-options</c> bridge op with this source key.
/// </summary>
[AttributeUsage(AttributeTargets.Property)]
public sealed class FieldOptionsAttribute(string sourceKey) : Attribute {
    /// <summary>Value-domain key, e.g. "category-names" (see SettingsRuntime ValueDomainKeys).</summary>
    public string SourceKey { get; } = sourceKey;

    /// <summary>True when the value must come from the option list; default is suggestion-only.</summary>
    public bool Constraint { get; init; }

    public bool AllowsCustomValue { get; init; } = true;
}
