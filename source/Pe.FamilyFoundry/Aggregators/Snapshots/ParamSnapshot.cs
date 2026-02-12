using Pe.Global.Services.Storage.Core.Json.RevitTypes;
using Pe.Global.Services.Storage.Core.Json.SchemaProcessors;
using Pe.Global.Services.Storage.Core.Json.SchemaProviders;
using System.ComponentModel;
using System.ComponentModel.DataAnnotations;
using System.Linq;

namespace Pe.FamilyFoundry.Aggregators.Snapshots;

/// <summary>
///     Base definition for parameter identity and creation metadata.
///     Shared between ParamSnapshot (audit/replay) and ParamSettingModel (settings).
///     Contains the minimum information needed to identify or create a parameter.
/// </summary>
public record ParamDefinitionBase {
    [SchemaExamples(typeof(SharedParameterNamesProvider))]
    [Description("The name of the parameter")]
    [Required]
    public string Name { get; init; }

    [Description(
        "Whether the parameter is an instance parameter (true) or a type parameter (false). Defaults to true.")]
    public bool IsInstance { get; init; } = true;

    [Description("The properties group of the parameter. Defaults to \"Other\" Properties Palette group.")]
    [ForgeKind(ForgeKind.Group)]
    public ForgeTypeId PropertiesGroup { get; init; } = new("");

    [Description("The data type of the parameter")]
    [ForgeKind(ForgeKind.Spec)]
    public ForgeTypeId DataType { get; init; } = SpecTypeId.String.Text;
}

/// <summary>
///     Canonical parameter snapshot - single source of truth for:
///     - Parameter definition (can recreate the param)
///     - Assignment mode (formula vs values)
///     - Per-type values (audit + replay)
/// </summary>
public record ParamSnapshot : ParamDefinitionBase {
    // Assignment mode - if Formula != null, it is the authoritative assignment
    public string? Formula { get; init; } = null;

    // Per-type values: TypeName -> setter-acceptable string value
    // Null means no value for that type. Empty string "" is a valid value for String parameters.
    // Note: JSON serialization preserves null vs "" distinction when using proper serializer settings.
    public Dictionary<string, string?> ValuesPerType { get; init; } = new(StringComparer.Ordinal);

    // Audit metadata (not for replay, but useful)
    public bool IsBuiltIn { get; init; } = false;
    public Guid? SharedGuid { get; init; } = null;
    public StorageType StorageType { get; init; }

    /// <summary>
    ///     Indicates if this is a project parameter (exists in Document.ParameterBindings).
    ///     Only populated when collecting from project document. Always false for family doc collection.
    /// </summary>
    public bool IsProjectParameter { get; init; } = false;

    /// <summary>
    ///     Settings-compatible value field.
    ///     - Formula when formula exists.
    ///     - Uniform value when all non-empty type values are the same.
    ///     - Null when values vary by type (use PerTypeValuesTable row).
    /// </summary>
    public string? ValueOrFormula =>
        !string.IsNullOrWhiteSpace(this.Formula)
            ? this.Formula
            : this.TryGetUniformNonEmptyValue();

    /// <summary>
    ///     Settings-compatible assignment mode.
    ///     True only when this snapshot represents a formula.
    /// </summary>
    public bool SetAsFormula => !string.IsNullOrWhiteSpace(this.Formula);

    /// <summary>Checks if a parameter has a (non-empty) value for all family types.</summary>
    public bool HasValueForAllTypes() {
        if (this is null) return false;
        var familyTypes = this.ValuesPerType.Count;
        if (familyTypes == 0) return false;
        return familyTypes == this.GetTypesWithValue().Count;
    }

    /// <summary>Gets the list of family types that have a value for the specified parameter.</summary>
    public List<string> GetTypesWithValue() {
        if (this is null) return [];

        return string.IsNullOrWhiteSpace(this.Formula)
            ? [
                .. this.ValuesPerType
                    .Where(kv => !string.IsNullOrWhiteSpace(kv.Value))
                    .Select(kv => kv.Key)
            ]
            : [.. this.ValuesPerType.Keys];
    }

    /// <summary>
    ///     Builds a settings-compatible per-type table row when values are not representable
    ///     by ValueOrFormula (non-uniform values with no formula).
    /// </summary>
    public Dictionary<string, string>? ToPerTypeValuesTableRow(string parameterColumnName = "Parameter") {
        if (!string.IsNullOrWhiteSpace(this.Formula)) return null;

        var nonNullValues = this.ValuesPerType
            .Where(kv => !string.IsNullOrWhiteSpace(kv.Key) && !string.IsNullOrWhiteSpace(kv.Value))
            .ToDictionary(kv => kv.Key, kv => kv.Value!, StringComparer.Ordinal);

        if (nonNullValues.Count == 0) return null;
        if (nonNullValues.Values.Distinct(StringComparer.Ordinal).Count() == 1) return null;

        var row = new Dictionary<string, string>(StringComparer.Ordinal) {
            [parameterColumnName] = this.Name
        };
        foreach (var kv in nonNullValues)
            row[kv.Key] = kv.Value;
        return row;
    }

    private string? TryGetUniformNonEmptyValue() {
        var distinctValues = this.ValuesPerType.Values
            .Where(v => !string.IsNullOrWhiteSpace(v))
            .Distinct(StringComparer.Ordinal)
            .ToList();

        return distinctValues.Count == 1 ? distinctValues[0] : null;
    }
}