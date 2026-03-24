using Pe.Extensions.FamDocument;
using Pe.Extensions.FamDocument.GetValue;
using Pe.Extensions.FamManager;
using Pe.FamilyFoundry.OperationSettings;

namespace Pe.FamilyFoundry.Operations;

/// <summary>
///     Sets parameter values or formulas from SetKnownParams.GlobalAssignments.
///     - Formula assignments use SetFormula
///     - Value assignments use TrySetUnsetFormula as the fast global-value path
///     Value failures defer to SetParamValuesPerType for per-type fallback.
/// </summary>
public class SetParamValues(SetKnownParamsSettings settings)
    : DocOperation<SetKnownParamsSettings>(settings) {
    public override string Description =>
        "Set parameter values or formulas from SetKnownParams.GlobalAssignments.";

    public override OperationLog Execute(
        FamilyDocument doc,
        FamilyProcessingContext processingContext,
        OperationContext groupContext
    ) {
        if (groupContext is null) {
            throw new InvalidOperationException(
                $"{this.Name} requires a GroupContext (must be used within an OperationGroup)");
        }

        var fm = doc.FamilyManager;
        var assignmentsByName = this.Settings.GetGlobalAssignmentsByParameter();
        var incomplete = groupContext.GetAllInComplete();

        foreach (var (parameterName, log) in incomplete) {
            if (!assignmentsByName.TryGetValue(parameterName, out var assignment))
                continue;

            var parameter = fm.FindParameter(parameterName);
            if (parameter is null) {
                _ = log.Error($"Parameter '{parameterName}' not found");
                continue;
            }

            if (!this.Settings.OverrideExistingValues && doc.HasValue(parameter)) {
                _ = log.Skip("Already has value");
                continue;
            }

            if (assignment.Kind == ParamAssignmentKind.Formula) {
                var success = doc.TrySetFormula(parameter, assignment.Value, out var errMsg);
                _ = success
                    ? log.Success("Set formula")
                    : log.Error($"Error setting formula: {errMsg}");
                continue;
            }

            var setValueSuccess = doc.TrySetUnsetFormula(parameter, assignment.Value, out var valueErrMsg);
            _ = setValueSuccess
                ? log.Success("Set global value")
                : log.Defer($"Needs per-type fallback, error setting global value: {valueErrMsg}");
        }

        return new OperationLog(this.Name, groupContext.TakeSnapshot());
    }
}
