using Pe.FamilyFoundry.Aggregators.Snapshots;
using Pe.Global.Services.Storage.Core.Json.SchemaProcessors;
using System.ComponentModel;
using System.ComponentModel.DataAnnotations;

namespace Pe.FamilyFoundry.OperationSettings;

/// <summary>
///     Unified parameter setting model supporting both global values/formulas and per-type values.
///     Use either ValueOrFormula (applies to all types) OR ValuesPerType (different value per type), not both.
///     Inherits parameter definition properties from ParamDefinitionBase.
/// </summary>
[OneOfProperties(nameof(ValueOrFormula), nameof(ValuesPerType), AllowNone = true)]
public record ParamSettingModel : ParamDefinitionBase {
    // Note: Name, IsInstance, PropertiesGroup, DataType inherited from ParamDefinitionBase

    // ===== Mutually Exclusive: Use ValueOrFormula OR ValuesPerType, not both =====

    /// <summary>
    ///     Global value or formula to apply to all family types.
    ///     Mutually exclusive with ValuesPerType - use one or the other.
    /// </summary>
    [Description(
        "Global value or formula to apply to all family types. " +
        "Unit-formatted strings (e.g., \"10'\", \"120V\", \"35 SF\") are fully supported. " +
        "By default, this is set as a formula (even if it contains no parameter references). " +
        "Set SetAsFormula=false to set as a value instead. " +
        "Mutually exclusive with ValuesPerType.")]
    public string ValueOrFormula { get; init; } = null;

    /// <summary>
    ///     Whether ValueOrFormula should be set as a formula (true) or a value (false).
    ///     Only applicable when ValueOrFormula is set. Ignored when using ValuesPerType.
    /// </summary>
    [Description(
        "Whether ValueOrFormula should be set as a formula (true) or a value (false). " +
        "Defaults to true. Setting as a formula 'locks' the parameter from manual editing. " +
        "Set to false to: 1) calculate values per family type without setting a formula, or " +
        "2) set a simple number/text value without locking the parameter. " +
        "Only applicable when ValueOrFormula is set.")]
    [Required]
    public bool SetAsFormula { get; init; } = true;

    /// <summary>
    ///     Dictionary of family type names to values. Allows setting different values per type.
    ///     Mutually exclusive with ValueOrFormula - use one or the other.
    /// </summary>
    [Description(
        "Dictionary of family type names to values. Allows setting different values per type. " +
        "Unit-formatted strings (e.g., \"10'\", \"120V\", \"Yes\", \"No\") are fully supported. " +
        "Values are always set as values (not formulas). " +
        "Mutually exclusive with ValueOrFormula.")]
    public Dictionary<string, string> ValuesPerType { get; init; } = null;
}

public class AddAndSetParamsSettings : IOperationSettings {
    [Description("Overwrite a family's existing parameter value/s if they already exist.")]
    public bool OverrideExistingValues { get; init; } = true;

    [Description("Create a family parameter if it is missing.")]
    public bool CreateFamParamIfMissing { get; init; } = true;

    [Description("Disable per-type fallback to speed up processing. Do not use outside of testing")]
    public bool DisablePerTypeFallback { get; init; } = false;

    [Description(
        "List of parameters to set. Each parameter can use either ValueOrFormula (global value/formula for all types) " +
        "or ValuesPerType (different value per type), but not both.")]
    public List<ParamSettingModel> Parameters { get; init; } = [];

    public bool Enabled { get; init; } = true;

    public void AddParameters(List<ParamSettingModel> parameters) => this.Parameters.AddRange(parameters);
}