using Pe.Global.Services.Storage.Core.Json.RevitTypes;
using Pe.Global.Services.Storage.Core.Json.SchemaProcessors;
using Pe.Global.Services.Storage.Core.Json.SchemaProviders;
using System.ComponentModel;
using System.ComponentModel.DataAnnotations;

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
    public required string Name { get; init; }

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

    // Audit metadata (not required for replay, but useful)
    public bool IsBuiltIn { get; init; } = false;
    public Guid? SharedGuid { get; init; } = null;
    public StorageType StorageType { get; init; }

    /// <summary>
    ///     Indicates if this is a project parameter (exists in Document.ParameterBindings).
    ///     Only populated when collecting from project document. Always false for family doc collection.
    /// </summary>
    public bool IsProjectParameter { get; init; } = false;

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
}