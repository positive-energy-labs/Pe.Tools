using Newtonsoft.Json;
using Newtonsoft.Json.Converters;
using Newtonsoft.Json.Linq;
using Pe.FamilyFoundry.Aggregators.Snapshots;
using Pe.Global.Services.Storage.Core.Json;
using Pe.Global.Services.Storage.Core.Json.SchemaProcessors;
using Pe.Global.Services.Storage.Core.Json.SchemaProviders;
using System.ComponentModel;
using System.ComponentModel.DataAnnotations;

namespace Pe.FamilyFoundry.OperationSettings;

[JsonConverter(typeof(StringEnumConverter))]
public enum ParamSettingMode {
    Value,
    Formula,
}


/// <summary>
///     Parameter setting model for parameter metadata plus optional global value/formula.
///     Inherits parameter definition properties from ParamDefinitionBase.
/// </summary>
public record ParamSettingModel : ParamDefinitionBase {
    // Note: Name, IsInstance, PropertiesGroup, DataType inherited from ParamDefinitionBase

    /// <summary>
    ///     Global value or formula to apply to all family types.
    ///     If null, this parameter may still receive per-type values from AddAndSetParamsSettings.PerTypeValuesTable.
    /// </summary>
    [Description(
        "Global value or formula to apply to all family types. " +
        "Unit-formatted strings (e.g., \"10'\", \"120V\", \"35 SF\") are fully supported. " +
        "By default, this is set as a formula (even if it contains no parameter references). " +
        "Set SetAs=false to set as a value instead. " +
        "If null, per-type values can be supplied through AddAndSetParamsSettings.PerTypeValuesTable.")]
    public string? ValueOrFormula { get; init; } = null;

    /// <summary>
    ///     Whether ValueOrFormula should be set as a formula (true) or a value (false).
    ///     Only applicable when ValueOrFormula is set. Ignored when parameter values come from PerTypeValuesTable.
    /// </summary>
    [Description(
        "Whether ValueOrFormula should be set as a formula or a value (default is formula)." +
        "Note that like you can set a value (e.g. \"120V\") as a formula" +
        "you can also set a formula as a value (e.g \"length1 + length2\")." +
        "Under the hood this sets then unsets the formula, which results with every " +
        "family type containing the would-be results of the formula. " +
        "\n Of course you can still set a value as a value and a formula as a formula")]
    [Required]
    public ParamSettingMode SetAs { get; init; } = ParamSettingMode.Formula;

    /// <summary>
    ///     Tooltip/description shown in Revit UI. Only applies to family parameters (not shared/built-in).
    /// </summary>
    [Description(
        "Tooltip/description shown in Revit UI and properties palette. Only applies to family parameters (not shared or built-in parameters).")]
    public string? Tooltip { get; init; } = null;
}

/// <summary>
///     Per-type table row with a strongly-typed parameter name and dynamic type columns.
///     Dynamic family type columns are captured by JsonExtensionData and serialized flat.
/// </summary>
public record PerTypeValueRow {
    [SchemaExamples(typeof(SharedParameterNamesProvider))]
    [Description("The parameter name for this per-type value row.")]
    [Required]
    public string Parameter { get; init; } = string.Empty;

    [JsonExtensionData]
    public IDictionary<string, JToken> ValuesByType { get; init; } = new Dictionary<string, JToken>(StringComparer.Ordinal);
}

public class AddAndSetParamsSettings : IOperationSettings {
    public const string PerTypeValuesTableParameterColumn = "Parameter";

    [Description("Overwrite a family's existing parameter value/s if they already exist.")]
    public bool OverrideExistingValues { get; init; } = true;

    [Description("Create a family parameter if it is missing.")]
    public bool CreateFamParamIfMissing { get; init; } = true;

    [Description(
        "List of parameters to create and/or set. " +
        "Use ValueOrFormula for global value/formula behavior, or leave it null and provide values in PerTypeValuesTable.")]
    public List<ParamSettingModel> Parameters { get; init; } = [];

    [Description(
        "Optional table of per-type values. " +
        $"Each row must include a '{PerTypeValuesTableParameterColumn}' column containing the parameter name. " +
        "All other columns are treated as family type names and their cell values are set as per-type values." +
        "Unit-formatted strings (e.g., \"10'\", \"120V\", \"Yes\", \"No\") are fully supported. " +
        "Values are always set as values (not formulas). " +
        "Mutually exclusive with ValueOrFormula.")]
    [UniformChildKeys]
    public List<PerTypeValueRow> PerTypeValuesTable { get; init; } = [];

    public bool Enabled { get; init; } = true;

    public void AddParameters(List<ParamSettingModel> parameters) => this.Parameters.AddRange(parameters);

    public Dictionary<string, Dictionary<string, string>> GetPerTypeValuesByParameter() {
        var valuesByParameter = new Dictionary<string, Dictionary<string, string>>(StringComparer.Ordinal);
        if (this.PerTypeValuesTable.Count == 0) return valuesByParameter;

        for (var rowIndex = 0; rowIndex < this.PerTypeValuesTable.Count; rowIndex++) {
            var row = this.PerTypeValuesTable[rowIndex];
            var parameterName = row.Parameter?.Trim();
            if (string.IsNullOrWhiteSpace(parameterName)) {
                throw new InvalidOperationException(
                    $"Per-type values table row {rowIndex + 1} is missing required '{PerTypeValuesTableParameterColumn}' value.");
            }
            var parameterNameKey = parameterName!;

            if (!valuesByParameter.TryGetValue(parameterNameKey, out var valuesPerType)) {
                valuesPerType = new Dictionary<string, string>(StringComparer.Ordinal);
                valuesByParameter[parameterNameKey] = valuesPerType;
            }

            foreach (var kvp in row.ValuesByType) {
                var typeName = kvp.Key;
                var value = kvp.Value?.ToString();
                if (string.IsNullOrWhiteSpace(typeName) || string.IsNullOrWhiteSpace(value))
                    continue;
                if (valuesPerType.ContainsKey(typeName)) {
                    throw new InvalidOperationException(
                        $"Duplicate per-type value for parameter '{parameterName}' and type '{typeName}'.");
                }

                valuesPerType[typeName] = value;
            }
        }

        return valuesByParameter;
    }

    public HashSet<string> GetReferencedFamilyTypeNames() {
        var typeNames = new HashSet<string>(StringComparer.Ordinal);
        var valuesByParameter = this.GetPerTypeValuesByParameter();

        foreach (var kvp in valuesByParameter) {
            var valuesPerType = kvp.Value;
            foreach (var typeName in valuesPerType.Keys)
                _ = typeNames.Add(typeName);
        }

        return typeNames;
    }
}