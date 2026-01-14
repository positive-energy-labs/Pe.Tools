using Pe.Extensions.FamDocument;
using Pe.Extensions.FamDocument.GetValue;
using Pe.Extensions.FamManager;
using Pe.FamilyFoundry.OperationSettings;

namespace Pe.FamilyFoundry.Operations;

/// <summary>
///     Sets parameter values or formulas based on SetAsFormula property.
///     - If SetAsFormula is true (default) → SetFormula (applies to all types, "locks" the parameter)
///     - If SetAsFormula is false → SetGlobalValue (fast path for all types at once)
///     On SetGlobalValue failure, defers to SetParamValuesPerType via GroupContext.
/// </summary>
public class SetParamValues(AddAndSetParamsSettings settings)
    : DocOperation<AddAndSetParamsSettings>(settings) {
    public override string Description =>
        "Set parameter values or formulas based on SetAsFormula property.";

    public override OperationLog Execute(FamilyDocument doc,
        FamilyProcessingContext processingContext,
        OperationContext groupContext) {
        if (groupContext is null) {
            throw new InvalidOperationException(
                $"{this.Name} requires a GroupContext (must be used within an OperationGroup)");
        }

        var fm = doc.FamilyManager;
        var incomplete = groupContext.GetAllInComplete();
        var data = incomplete.Select(e => {
            var paramModel = this.Settings.Parameters.First(p => e.Key == p.Name);
            return (paramModel, e.Value);
        });

        foreach (var (p, log) in data) {
            // Skip if using ValuesPerType (handled by SetParamValuesPerType)
            if (string.IsNullOrWhiteSpace(p.ValueOrFormula)) continue;

            var parameter = fm.FindParameter(p.Name);
            if (parameter is null) {
                _ = log.Error($"Parameter '{p.Name}' not found");
                continue;
            }

            if (!this.Settings.OverrideExistingValues && doc.HasValue(parameter)) {
                _ = log.Skip("Already has value");
                continue;
            }

            if (p.SetAsFormula) {
                var success = doc.TrySetFormula(parameter, p.ValueOrFormula, out var errMsg);
                _ = success
                    ? log.Success("Set formula")
                    : log.Defer($"Error setting formula: {errMsg}");

            } else {
                var success = doc.SetUnsetFormula(parameter, p.ValueOrFormula);
                _ = success
                    ? log.Success("Set global value")
                    : log.Defer($"Needs per-type fallback");
            }
        }

        return new OperationLog(this.Name, groupContext.TakeSnapshot());
    }
}