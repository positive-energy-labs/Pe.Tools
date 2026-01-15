using Pe.Extensions.FamDocument;
using Pe.Extensions.FamDocument.GetValue;
using Pe.Extensions.FamDocument.SetValue;
using Pe.Extensions.FamManager;
using Pe.Extensions.FamParameter.Formula;
using Pe.FamilyFoundry.OperationSettings;

namespace Pe.FamilyFoundry.Operations;

/// <summary>
///     Sets parameter values on a per-type basis.
///     Handles two scenarios:
///     1. Explicit per-type values from PerTypeParameters (different value per named type)
///     2. Fallback for Parameters that failed SetGlobalValue (deferred via GroupContext)
///     Values are context-aware but must NOT contain parameter references
///     (formulas with param refs should use SetParamValues instead).
///     If a Family Type does not exist, it will NOT be created
/// </summary>
public class SetParamValuesPerType(AddAndSetParamsSettings settings)
    : TypeOperation<AddAndSetParamsSettings>(settings) {
    public override string Description =>
        "Set parameter values per family type (explicit per-type values or fallback for failed global values).";

    public override OperationLog Execute(FamilyDocument famDoc,
        FamilyProcessingContext processingContext,
        OperationContext groupContext) {
        if (groupContext is null) {
            throw new InvalidOperationException(
                $"{this.Name} requires a GroupContext (must be used within an OperationGroup)");
        }

        var fm = famDoc.FamilyManager;
        var currentTypeName = fm.CurrentType?.Name;

        // Check if all work items are already handled
        var incomplete = groupContext.GetAllInComplete();
        if (incomplete.Count == 0) this.AbortOperation("All parameters were handled by prior operations");

        // Check if any unhandled param has work to do for current type
        var data = incomplete.Select(e => {
            var paramModel = this.Settings.Parameters.First(p => e.Key == p.Name);
            return (paramModel, e.Value);
        });

        foreach (var (paramModel, log) in data) {
            var parameter = fm.FindParameter(paramModel.Name);
            if (parameter is null) {
                _ = log.Error($"Parameter '{paramModel.Name}' not found");
                continue;
            }

            // Handle fallback for failed global values from SetParamValues and proiritize ValueOrFormula over ValuesPerType 
            if (!string.IsNullOrWhiteSpace(paramModel.ValueOrFormula)) {
                try {
                    var success = famDoc.TrySetFormula(parameter, paramModel.ValueOrFormula, out _);
                    _ = log.Success("Set per-type value (fallback)");
                    continue; // break early, this is a proper success
                } catch {
                    // allow retries by below loop
                }
            }

            if (!(paramModel.ValuesPerType?.Count > 0)
                || currentTypeName is null
                || !paramModel.ValuesPerType.TryGetValue(currentTypeName, out var value)
                || string.IsNullOrWhiteSpace(value)) continue;
            if (!this.Settings.OverrideExistingValues && famDoc.HasValue(parameter))
                continue;

            // Handle explicit per-type parameters (ValuesPerType is set, probably Family Manager path)
            try {
                SetValueForCurrentFamType(famDoc, parameter, value);
                _ = log.Defer("Set per-type value");
            } catch (Exception ex) {
                _ = log.Error(ex);
            }
        }

        return new OperationLog(this.Name, groupContext.TakeSnapshot());
    }

    /// <summary>
    ///     Set a per-type parameter value using a user-provided string value.
    ///     Rejects values that contain parameter references and strips double-quotes from string literals.
    /// </summary>
    private static void SetValueForCurrentFamType(FamilyDocument famDoc, FamilyParameter parameter, string userValue) {
        var fm = famDoc.FamilyManager;

        // Check for double-quoted string literal: "\"text\"" → strip quotes
        var actualValue = IsQuotedStringLiteral(userValue) ? userValue.Trim()[1..^1] : userValue;

        // Reject values that contain parameter references (check AFTER stripping quotes)
        var referencedParams = fm.Parameters.GetReferencedIn(actualValue).ToList();
        if (referencedParams.Count != 0) {
            throw new InvalidOperationException(
                $"Per-type value '{actualValue}' contains parameter references. Use ValueOrFormula with SetAsFormula=true for formulas, not ValuesPerType.");
        }

        _ = famDoc.SetValue(parameter, actualValue, nameof(BuiltInCoercionStrategy.CoerceByStorageType));
    }

    /// <summary>
    ///     Checks if the value is a double-quoted string literal: starts and ends with quotes.
    /// </summary>
    private static bool IsQuotedStringLiteral(string value) {
        if (string.IsNullOrWhiteSpace(value)) return false;
        var trimmed = value.Trim();
        return trimmed.Length >= 2 && trimmed.StartsWith("\"") && trimmed.EndsWith("\"");
    }
}