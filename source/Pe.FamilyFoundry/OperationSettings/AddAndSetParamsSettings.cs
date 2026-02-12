using Pe.FamilyFoundry.Aggregators.Snapshots;
using Pe.Global.Services.Storage.Core.Json;
using System;
using System.ComponentModel;
using System.ComponentModel.DataAnnotations;
using System.Linq;

namespace Pe.FamilyFoundry.OperationSettings;

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
        "Set SetAsFormula=false to set as a value instead. " +
        "If null, per-type values can be supplied through AddAndSetParamsSettings.PerTypeValuesTable.")]
    public string ValueOrFormula { get; init; } = null;

    /// <summary>
    ///     Whether ValueOrFormula should be set as a formula (true) or a value (false).
    ///     Only applicable when ValueOrFormula is set. Ignored when parameter values come from PerTypeValuesTable.
    /// </summary>
    [Description(
        "Whether ValueOrFormula should be set as a formula (true) or a value (false). " +
        "Defaults to true. Setting as a formula 'locks' the parameter from manual editing. " +
        "Set to false to: 1) calculate values per family type without setting a formula, or " +
        "2) set a simple number/text value without locking the parameter. " +
        "Only applicable when ValueOrFormula is set. Ignored when parameter values come from PerTypeValuesTable.")]
    [Required]
    public bool SetAsFormula { get; init; } = true;

    /// <summary>
    ///     Tooltip/description shown in Revit UI. Only applies to family parameters (not shared/built-in).
    /// </summary>
    [Description(
        "Tooltip/description shown in Revit UI and properties palette. Only applies to family parameters (not shared or built-in parameters).")]
    public string? Tooltip { get; init; } = null;
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
    public List<Dictionary<string, string>> PerTypeValuesTable { get; init; } = [];

    public bool Enabled { get; init; } = true;

    public void AddParameters(List<ParamSettingModel> parameters) => this.Parameters.AddRange(parameters);

    public Dictionary<string, Dictionary<string, string>> GetPerTypeValuesByParameter() {
        var valuesByParameter = new Dictionary<string, Dictionary<string, string>>(StringComparer.Ordinal);
        if (this.PerTypeValuesTable.Count == 0) return valuesByParameter;

        for (var rowIndex = 0; rowIndex < this.PerTypeValuesTable.Count; rowIndex++) {
            var row = this.PerTypeValuesTable[rowIndex];

            var parameterNamePair = row.FirstOrDefault(kv =>
                string.Equals(kv.Key, PerTypeValuesTableParameterColumn, StringComparison.OrdinalIgnoreCase));

            var parameterName = parameterNamePair.Value?.Trim();
            if (string.IsNullOrWhiteSpace(parameterName)) {
                throw new InvalidOperationException(
                    $"Per-type values table row {rowIndex + 1} is missing required '{PerTypeValuesTableParameterColumn}' value.");
            }
            var parameterNameKey = parameterName!;

            if (!valuesByParameter.TryGetValue(parameterNameKey, out var valuesPerType)) {
                valuesPerType = new Dictionary<string, string>(StringComparer.Ordinal);
                valuesByParameter[parameterNameKey] = valuesPerType;
            }

            foreach (var kvp in row) {
                var typeName = kvp.Key;
                var value = kvp.Value;
                if (string.Equals(typeName, PerTypeValuesTableParameterColumn, StringComparison.OrdinalIgnoreCase))
                    continue;
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