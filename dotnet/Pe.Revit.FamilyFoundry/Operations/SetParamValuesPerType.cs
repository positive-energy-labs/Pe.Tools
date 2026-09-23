using Pe.Revit.Extensions.FamDocument;
using Pe.Revit.Extensions.FamDocument.SetValue;
using Pe.Revit.Extensions.FamManager;
using Pe.Revit.Parameters;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace Pe.Revit.FamilyFoundry.Operations;

/// <summary>
///     Sets parameter values on a per-type basis.
///     Handles two scenarios:
///     1. Explicit per-type values from SetKnownParamsSettings.PerTypeAssignmentsTable
///     2. Fallback for GlobalAssignments value entries that failed SetParamValues
///     Values are context-aware but must NOT contain parameter references.
/// </summary>
public class SetParamValuesPerType(SetKnownParamsSettings settings)
    : TypeOperation<SetKnownParamsSettings>(settings) {
    public override string Description =>
        "Set parameter values per family type (explicit per-type values or fallback for failed global values).";

    public override OperationLog Execute(
        FamilyDocument famDoc,
        FamilyProcessingContext processingContext,
        OperationContext groupContext
    ) {
        if (groupContext is null) {
            throw new InvalidOperationException(
                $"{this.Name} requires a GroupContext (must be used within an OperationGroup)");
        }

        var fm = famDoc.FamilyManager;
        var currentTypeName = fm.CurrentType?.Name?.Trim();
        var perTypeAssignmentsByParameter = this.Settings.GetPerTypeAssignmentsByParameter();
        var globalAssignmentsByParameter = this.Settings.GetGlobalAssignmentsByParameter();

        var incomplete = groupContext.GetAllInComplete();
        if (incomplete.Count == 0)
            this.AbortOperation("All parameters were handled by prior operations");

        foreach (var (parameterName, log) in incomplete) {
            var parameter = fm.FindParameter(parameterName);
            if (parameter is null) {
                _ = log
                    .WithParameterEvent(
                        ParameterEventOutcome.ParameterMissing,
                        ParameterEventReason.ParameterNotFound,
                        parameterName: parameterName)
                    .Error($"Parameter '{parameterName}' not found");
                continue;
            }

            JToken? valueToSet = null;
            var isFallback = false;

            if (currentTypeName is not null
                && perTypeAssignmentsByParameter.TryGetValue(parameterName, out var valuesPerType)
                && valuesPerType.TryGetValue(currentTypeName, out var perTypeValue))
                valueToSet = perTypeValue;
            else if (globalAssignmentsByParameter.TryGetValue(parameterName, out var assignment)
                     && assignment.Kind == ParamAssignmentKind.Value) {
                valueToSet = assignment.Value;
                isFallback = true;
            }

            if (valueToSet is null) {
                _ = log
                    .WithParameterEvent(
                        ParameterEventOutcome.PerTypeValueSkipped,
                        ParameterEventReason.PerTypeValueMissing,
                        parameterName: parameterName,
                        details: currentTypeName is null
                            ? null
                            : new Dictionary<string, string> { ["FamilyTypeName"] = currentTypeName })
                    .SkipForType("No per-type value for current family type");
                continue;
            }

            if (!this.Settings.OverrideExistingValues && famDoc.HasValue(parameter)) {
                _ = log
                    .WithParameterEvent(
                        ParameterEventOutcome.AlreadyHasValue,
                        ParameterEventReason.AlreadyHasValue,
                        parameterName: parameterName,
                        details: currentTypeName is null
                            ? null
                            : new Dictionary<string, string> { ["FamilyTypeName"] = currentTypeName })
                    .SkipForType("Already has value");
                continue;
            }

            IReadOnlyDictionary<string, string>? setValueDetails = null;
            try {
                setValueDetails = valueToSet is JObject measured
                    ? SetMeasured(famDoc, parameter, (string)measured["value"]!, (string)measured["unit"]!)
                    : SetValueForCurrentFamType(famDoc, parameter, (string)valueToSet!);
                _ = log
                    .WithParameterEvent(
                        ParameterEventOutcome.PerTypeValueSet,
                        isFallback ? ParameterEventReason.GlobalValueError : ParameterEventReason.NotApplicable,
                        parameterName: parameterName,
                        details: MergeDetails(setValueDetails, new Dictionary<string, string> {
                            ["Value"] = valueToSet.ToString(Formatting.None),
                            ["IsFallback"] = isFallback.ToString(),
                            ["FamilyTypeName"] = currentTypeName ?? string.Empty
                        }))
                    .SuccessForType(isFallback ? "Set per-type value (fallback)" : "Set per-type value");
            } catch (Exception ex) {
                _ = log
                    .WithParameterEvent(
                        ParameterEventOutcome.PerTypeValueSet,
                        ParameterEventReason.Exception,
                        parameterName: parameterName,
                        details: MergeDetails(setValueDetails, new Dictionary<string, string> {
                            ["Value"] = valueToSet.ToString(Formatting.None),
                            ["FamilyTypeName"] = currentTypeName ?? string.Empty
                        }))
                    .Error(ex);
            }
        }

        return new OperationLog(this.Name, groupContext.TakeSnapshot());
    }

    /// <summary>A measured `{ value, unit }` converts through the one unit door and is set as internal units.</summary>
    private static IReadOnlyDictionary<string, string> SetMeasured(FamilyDocument famDoc, FamilyParameter parameter, string value, string unit) {
        var internalValue = UnitValueResolver.ToInternal(value, unit, parameter.Definition.GetDataType());
        famDoc.FamilyManager.Set(parameter, internalValue);
        return new Dictionary<string, string> { ["Unit"] = unit, ["Internal"] = internalValue.ToString("R", System.Globalization.CultureInfo.InvariantCulture) };
    }

    private static IReadOnlyDictionary<string, string> SetValueForCurrentFamType(FamilyDocument famDoc, FamilyParameter parameter, string userValue) {
        var trimmedUserValue = userValue.Trim();

        var actualValue = IsQuotedStringLiteral(userValue)
            ? trimmedUserValue.Substring(1, trimmedUserValue.Length - 2)
            : userValue;

        var details = famDoc.DescribeSetValue(parameter, actualValue, nameof(MappingStrategy.CoerceByStorageType));
        _ = famDoc.SetValue(parameter, actualValue, nameof(MappingStrategy.CoerceByStorageType));
        return details;
    }

    private static IReadOnlyDictionary<string, string> MergeDetails(
        IReadOnlyDictionary<string, string>? setValueDetails,
        Dictionary<string, string> details
    ) {
        if (setValueDetails == null)
            return details;

        foreach (var (key, value) in setValueDetails)
            details[key] = value;

        return details;
    }

    private static bool IsQuotedStringLiteral(string value) {
        if (string.IsNullOrWhiteSpace(value))
            return false;

        var trimmed = value.Trim();
        return trimmed.Length >= 2 && trimmed.StartsWith("\"") && trimmed.EndsWith("\"");
    }
}
