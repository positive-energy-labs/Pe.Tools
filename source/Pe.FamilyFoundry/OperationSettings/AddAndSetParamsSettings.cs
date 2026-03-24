using Newtonsoft.Json;
using Newtonsoft.Json.Converters;
using Newtonsoft.Json.Linq;
using Pe.FamilyFoundry.Aggregators.Snapshots;
using Pe.StorageRuntime.Json;
using System.ComponentModel;
using System.ComponentModel.DataAnnotations;

namespace Pe.FamilyFoundry.OperationSettings;

[JsonConverter(typeof(StringEnumConverter))]
public enum ParamAssignmentKind {
    Value,
    Formula
}

/// <summary>
///     Family parameter definition metadata used for parameter creation and tooltip configuration.
///     PE_ parameters are not valid family parameter definitions.
/// </summary>
public sealed record FamilyParamDefinitionModel : ParamDefinitionBase {
    [Description(
        "Tooltip/description shown in Revit UI and properties palette. Only applies to family parameters (not shared or built-in parameters).")]
    public string? Tooltip { get; init; }
}

/// <summary>
///     Uniform assignment applied to all family types.
/// </summary>
public sealed record GlobalParamAssignment {
    [Description("The parameter name receiving the global assignment.")]
    [Required]
    public string Parameter { get; init; } = string.Empty;

    [Description("Whether the assignment should be set as a literal value or a formula.")]
    [Required]
    public ParamAssignmentKind Kind { get; init; } = ParamAssignmentKind.Formula;

    [Description(
        "The value or formula to assign to the parameter. Unit-formatted strings are supported.")]
    [Required]
    public string Value { get; init; } = string.Empty;
}

/// <summary>
///     Per-type table row with a strongly-typed parameter name and dynamic type columns.
/// </summary>
public sealed record PerTypeAssignmentRow {
    [Description("The parameter name for this per-type assignment row.")]
    [Required]
    public string Parameter { get; init; } = string.Empty;

    [JsonExtensionData]
    public IDictionary<string, JToken> ValuesByType { get; init; } =
        new Dictionary<string, JToken>(StringComparer.Ordinal);
}

public sealed class AddFamilyParamsSettings : IOperationSettings {
    [Description(
        "Definition metadata for family parameters to create and/or configure. " +
        "PE_ parameters are invalid here because they must come from APS/shared parameter provisioning.")]
    public List<FamilyParamDefinitionModel> Parameters { get; init; } = [];

    public bool Enabled { get; init; } = true;

    public void AddParameters(List<FamilyParamDefinitionModel> parameters) => this.Parameters.AddRange(parameters);
}

public sealed class SetKnownParamsSettings : IOperationSettings {
    public const string PerTypeAssignmentsTableParameterColumn = "Parameter";

    [Description("Overwrite a family's existing parameter value(s) if they already exist.")]
    public bool OverrideExistingValues { get; init; } = true;

    [Description(
        "Optional global assignments applied uniformly to all family types. " +
        "Assignments can be set as values or formulas.")]
    public List<GlobalParamAssignment> GlobalAssignments { get; init; } = [];

    [Description(
        "Optional table of per-type values. " +
        $"Each row must include a '{PerTypeAssignmentsTableParameterColumn}' column containing the parameter name. " +
        "All other columns are treated as family type names and their cell values are set as per-type values. " +
        "Values are always set as values, never formulas.")]
    [UniformChildKeys]
    public List<PerTypeAssignmentRow> PerTypeAssignmentsTable { get; init; } = [];

    public bool Enabled { get; init; } = true;

    public Dictionary<string, GlobalParamAssignment> GetGlobalAssignmentsByParameter() {
        var assignments = new Dictionary<string, GlobalParamAssignment>(StringComparer.Ordinal);

        foreach (var assignment in this.GlobalAssignments) {
            var parameterName = assignment.Parameter?.Trim();
            if (string.IsNullOrWhiteSpace(parameterName)) {
                throw new InvalidOperationException("Global assignment is missing required parameter name.");
            }

            if (!assignments.TryAdd(parameterName, assignment with { Parameter = parameterName })) {
                throw new InvalidOperationException(
                    $"Duplicate global assignment for parameter '{parameterName}'.");
            }
        }

        return assignments;
    }

    public Dictionary<string, Dictionary<string, string>> GetPerTypeAssignmentsByParameter() {
        var valuesByParameter = new Dictionary<string, Dictionary<string, string>>(StringComparer.Ordinal);
        if (this.PerTypeAssignmentsTable.Count == 0) return valuesByParameter;

        for (var rowIndex = 0; rowIndex < this.PerTypeAssignmentsTable.Count; rowIndex++) {
            var row = this.PerTypeAssignmentsTable[rowIndex];
            var parameterName = row.Parameter?.Trim();
            if (string.IsNullOrWhiteSpace(parameterName)) {
                throw new InvalidOperationException(
                    $"Per-type assignments table row {rowIndex + 1} is missing required '{PerTypeAssignmentsTableParameterColumn}' value.");
            }

            if (!valuesByParameter.TryGetValue(parameterName, out var valuesPerType)) {
                valuesPerType = new Dictionary<string, string>(StringComparer.Ordinal);
                valuesByParameter[parameterName] = valuesPerType;
            }

            foreach (var kvp in row.ValuesByType) {
                var typeName = kvp.Key?.Trim();
                var value = kvp.Value?.ToString();
                if (string.IsNullOrWhiteSpace(typeName) || string.IsNullOrWhiteSpace(value))
                    continue;
                if (valuesPerType.ContainsKey(typeName)) {
                    throw new InvalidOperationException(
                        $"Duplicate per-type assignment for parameter '{parameterName}' and type '{typeName}'.");
                }

                valuesPerType[typeName] = value;
            }
        }

        return valuesByParameter;
    }

    public HashSet<string> GetReferencedFamilyTypeNames() {
        var typeNames = new HashSet<string>(StringComparer.Ordinal);
        var valuesByParameter = this.GetPerTypeAssignmentsByParameter();

        foreach (var valuesPerType in valuesByParameter.Values) {
            foreach (var typeName in valuesPerType.Keys)
                _ = typeNames.Add(typeName);
        }

        return typeNames;
    }

    public HashSet<string> GetAllReferencedParameterNames() {
        var parameterNames = this.GetGlobalAssignmentsByParameter().Keys
            .ToHashSet(StringComparer.Ordinal);

        foreach (var parameterName in this.GetPerTypeAssignmentsByParameter().Keys)
            _ = parameterNames.Add(parameterName);

        return parameterNames;
    }
}
