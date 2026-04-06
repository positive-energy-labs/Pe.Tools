using Pe.Revit.Extensions.FamDocument;
using Pe.Revit.Extensions.FamDocument.GetValue;
using Pe.Revit.Extensions.FamDocument.SetValue;
using Pe.Revit.Extensions.FamManager;
using Pe.Revit.Extensions.FamParameter.Formula;
using Pe.FamilyFoundry.OperationSettings;

namespace Pe.FamilyFoundry.Operations;

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
        var currentTypeName = fm.CurrentType?.Name;
        var perTypeAssignmentsByParameter = this.Settings.GetPerTypeAssignmentsByParameter();
        var globalAssignmentsByParameter = this.Settings.GetGlobalAssignmentsByParameter();

        var incomplete = groupContext.GetAllInComplete();
        if (incomplete.Count == 0)
            this.AbortOperation("All parameters were handled by prior operations");

        foreach (var (parameterName, log) in incomplete) {
            var parameter = fm.FindParameter(parameterName);
            if (parameter is null) {
                _ = log.Error($"Parameter '{parameterName}' not found");
                continue;
            }

            string? valueToSet = null;
            var isFallback = false;

            if (currentTypeName is not null
                && perTypeAssignmentsByParameter.TryGetValue(parameterName, out var valuesPerType)
                && valuesPerType.TryGetValue(currentTypeName, out var perTypeValue)) {
                valueToSet = perTypeValue;
            } else if (globalAssignmentsByParameter.TryGetValue(parameterName, out var assignment)
                       && assignment.Kind == ParamAssignmentKind.Value) {
                valueToSet = assignment.Value;
                isFallback = true;
            }

            if (string.IsNullOrWhiteSpace(valueToSet))
                continue;

            if (!this.Settings.OverrideExistingValues && famDoc.HasValue(parameter)) {
                _ = log.Skip("Already has value");
                continue;
            }

            try {
                SetValueForCurrentFamType(famDoc, parameter, valueToSet);
                _ = log.Defer(isFallback ? "Set per-type value (fallback)" : "Set per-type value");
            } catch (Exception ex) {
                _ = log.Error(ex);
            }
        }

        return new OperationLog(this.Name, groupContext.TakeSnapshot());
    }

    private static void SetValueForCurrentFamType(FamilyDocument famDoc, FamilyParameter parameter, string userValue) {
        var fm = famDoc.FamilyManager;
        var trimmedUserValue = userValue.Trim();

        var actualValue = IsQuotedStringLiteral(userValue)
            ? trimmedUserValue.Substring(1, trimmedUserValue.Length - 2)
            : userValue;

        var referencedParams = fm.Parameters.GetReferencedIn(actualValue).ToList();
        if (referencedParams.Count != 0) {
            throw new InvalidOperationException(
                $"Per-type value '{actualValue}' contains parameter references. " +
                $"Use {nameof(SetKnownParamsSettings.GlobalAssignments)} with Kind=Formula for formulas, not {nameof(SetKnownParamsSettings.PerTypeAssignmentsTable)}.");
        }

        _ = famDoc.SetValue(parameter, actualValue, nameof(BuiltInCoercionStrategy.CoerceByStorageType));
    }

    private static bool IsQuotedStringLiteral(string value) {
        if (string.IsNullOrWhiteSpace(value))
            return false;

        var trimmed = value.Trim();
        return trimmed.Length >= 2 && trimmed.StartsWith("\"") && trimmed.EndsWith("\"");
    }
}
