using Pe.Revit.SettingsRuntime.Json.RevitTypes;
using Pe.Shared.RevitData;
using System.ComponentModel;
using System.ComponentModel.DataAnnotations;

namespace Pe.Revit.FamilyFoundry.Snapshots;

/// <summary>
///     Base spec for parameter identity and creation metadata.
///     Shared between ParameterSnapshot (captured state) and FamilyParamDefinitionModel (authored settings).
///     Contains the minimum information needed to identify or create a parameter.
/// </summary>
public record ParameterSpec {
    private ParameterDefinitionDescriptor _definition = ParameterDefinitionDescriptorFactory.NameFallback(string.Empty);

    [Description("Portable parameter definition used to identify, compare, or recreate the parameter.")]
    [Required]
    public ParameterDefinitionDescriptor Definition {
        get => this._definition;
        init => this._definition = value;
    }

    [Description("The name of the parameter")]
    [Required]
    public string Name {
        get => this.Definition.Identity.Name;
        init => this._definition = this.Definition with {
            Identity = new ParameterIdentity($"name:{NormalizeName(value)}", ParameterIdentityKind.NameFallback, value, null, null, null)
        };
    }

    [Description(
        "Whether the parameter is an instance parameter (true) or a type parameter (false). Defaults to true.")]
    public bool? IsInstance {
        get => this.Definition.IsInstance;
        init => this._definition = this.Definition with { IsInstance = value };
    }

    [Description("The properties group of the parameter. Defaults to \"Other\" Properties Palette group.")]
    [ForgeKind(ForgeKind.Group)]
    public ForgeTypeId PropertiesGroup {
        get => ToForgeTypeId(this.Definition.GroupTypeId) ?? new ForgeTypeId(string.Empty);
        init => this._definition = this.Definition with { GroupTypeId = NormalizeForgeTypeId(value) };
    }

    [Description("The data type of the parameter")]
    [ForgeKind(ForgeKind.Spec)]
    public ForgeTypeId DataType {
        get => ToForgeTypeId(this.Definition.DataTypeId) ?? SpecTypeId.String.Text;
        init => this._definition = this.Definition with { DataTypeId = NormalizeForgeTypeId(value) };
    }

    private static ForgeTypeId? ToForgeTypeId(string? typeId) =>
        string.IsNullOrWhiteSpace(typeId) ? null : new ForgeTypeId(typeId);

    private static string? NormalizeForgeTypeId(ForgeTypeId? forgeTypeId) =>
        string.IsNullOrWhiteSpace(forgeTypeId?.TypeId) ? null : forgeTypeId.TypeId;

    private static string NormalizeName(string? name) => (name ?? string.Empty).Trim().ToLowerInvariant();
}

/// <summary>
///     Canonical parameter snapshot - single source of truth for:
///     - Parameter spec (can recreate the parameter)
///     - Assignment mode (formula vs values)
///     - Per-type values for audit and apply-oriented projection
/// </summary>
public record ParameterSnapshot : ParameterSpec {
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

    public string? TryGetUniformValueOrFormula() =>
        !string.IsNullOrWhiteSpace(this.Formula)
            ? this.Formula
            : this.TryGetUniformNonEmptyValue();

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
    ///     by a uniform global assignment.
    /// </summary>
    public PerTypeAssignmentRow? ProjectToPerTypeAssignmentRow() {
        if (!string.IsNullOrWhiteSpace(this.Formula)) return null;

        var nonNullValues = this.ValuesPerType
            .Where(kv => !string.IsNullOrWhiteSpace(kv.Key) && !string.IsNullOrWhiteSpace(kv.Value))
            .ToDictionary(kv => kv.Key, kv => kv.Value!, StringComparer.Ordinal);

        if (nonNullValues.Count == 0) return null;
        if (nonNullValues.Values.Distinct(StringComparer.Ordinal).Count() == 1) return null;

        var row = new PerTypeAssignmentRow { Parameter = this.Name };
        foreach (var kv in nonNullValues)
            row.ValuesByType[kv.Key] = kv.Value;
        return row;
    }

    public GlobalParamAssignment? ProjectToGlobalAssignment() {
        var valueOrFormula = this.TryGetUniformValueOrFormula();
        if (string.IsNullOrWhiteSpace(valueOrFormula))
            return null;

        return new GlobalParamAssignment {
            Parameter = this.Name,
            Kind = !string.IsNullOrWhiteSpace(this.Formula) ? ParamAssignmentKind.Formula : ParamAssignmentKind.Value,
            Value = valueOrFormula
        };
    }

    private string? TryGetUniformNonEmptyValue() {
        var distinctValues = this.ValuesPerType.Values
            .Where(v => !string.IsNullOrWhiteSpace(v))
            .Distinct(StringComparer.Ordinal)
            .ToList();

        return distinctValues.Count == 1 ? distinctValues[0] : null;
    }
}

