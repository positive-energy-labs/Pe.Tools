using Pe.Revit.Extensions.FamDocument;
using Pe.Revit.Extensions.FamParameter;
using Pe.Revit.Extensions.FamParameter.Formula;

namespace Pe.Revit.FamilyFoundry.Operations;

public class PurgeParams : DocOperation<PurgeParamsSettings> {
    public PurgeParams(PurgeParamsSettings settings, IEnumerable<string> ExcludeNamesEqualing) :
        base(settings) =>
        this.ExternalExcludeNamesEqualing = ExcludeNamesEqualing;

    public override string Description => "Recursively delete unused parameters from the family";

    public IEnumerable<string> ExternalExcludeNamesEqualing { get; set; } = [];

    public bool IsParameterEmpty(FamilyParameter param, FamilyProcessingContext processingContext) {
        if (processingContext == null) return false;

        var snapshot = processingContext.PreProcessSnapshot?.Parameters?.Data
            ?.FirstOrDefault(p => p.Matches(param));

        if (snapshot == null) return false;

        // If parameter has a formula, check if it's a constant empty/zero value
        if (!string.IsNullOrWhiteSpace(snapshot.Formula))
            return this.IsFormulaEmpty(snapshot.Formula);

        // For non-formula parameters, check actual values
        var values = snapshot.ValuesPerType.Values.ToList();
        // Absence of evidence is not emptiness: a capture gap must never authorize a delete.
        if (values.Count == 0) return false;

        return values.All(this.IsValueEmpty);
    }

    private bool IsValueEmpty(string? value) {
        if (value == null) return true;
        if (this.Settings.ConsiderEmptyStringAsEmpty && string.IsNullOrWhiteSpace(value)) return true;
        if (this.Settings.ConsiderZeroValueAsEmpty && IsZeroValue(value)) return true;
        return false;
    }

    private static bool IsZeroValue(string value) {
        if (string.IsNullOrWhiteSpace(value)) return false;
        // Handle numeric zero (int, double)
        if (double.TryParse(value, out var d) && d == 0) return true;
        return false;
    }

    /// <summary>
    ///     Checks if a formula is a constant that evaluates to empty/zero.
    ///     Handles patterns like: 0", 0', 0' 0", 0.0, 0, ""
    /// </summary>
    private bool IsFormulaEmpty(string formula) {
        if (string.IsNullOrWhiteSpace(formula)) return true;

        var trimmed = formula.Trim();

        // Empty string formula
        if (trimmed == "\"\"") return this.Settings.ConsiderEmptyStringAsEmpty;

        // Check for zero-value formulas (0", 0', 0' 0", 0, 0.0, etc.)
        if (!this.Settings.ConsiderZeroValueAsEmpty) return false;

        // Remove unit indicators and whitespace, check if remaining is all zeros/dots
        var cleaned = trimmed
            .Replace("\"", "") // Remove inch marks
            .Replace("'", "") // Remove foot marks
            .Replace(" ", "") // Remove spaces
            .Replace(".", ""); // Remove decimal points

        // If what remains is empty or all zeros, it's a zero formula
        return string.IsNullOrEmpty(cleaned) || cleaned.All(c => c == '0');
    }

    public override OperationLog Execute(FamilyDocument doc,
        FamilyProcessingContext processingContext,
        OperationContext groupContext) {
        var logs = new List<LogEntry>();
        this.RecursiveDelete(doc, logs, processingContext);
        return new OperationLog(this.Name, logs);
    }

    private void RecursiveDelete(FamilyDocument doc, List<LogEntry> logs, FamilyProcessingContext processingContext) {
        var deleteCount = 0;
        var excludeSet = this.ExternalExcludeNamesEqualing.ToHashSet();

        var allParams = doc.FamilyManager.Parameters;

        var parameters = allParams
            .OfType<FamilyParameter>()
            .Where(p => !excludeSet.Contains(p.Definition.Name))
            .Where(p => !IsExcluded(p, this.Settings.ExcludeNames))
            .Where(p => !p.IsBuiltInParameter())
            .OrderByDescending(p => p.Formula?.Length ?? 0)
            .ToList();

        foreach (var param in parameters) {
            var parameterName = param.Definition.Name;

            // A parameter that labels a dimension or array, or drives a connector, is load-bearing whatever its value.
            if (param.HasDirectAssociation(doc)) continue;

            // If empty AND DirectDelete is enabled, delete immediately (its own dependents are not consulted)
            if (this.Settings.DirectDeleteEmptyParameters
                && this.IsParameterEmpty(param, processingContext)) {
                var log = new LogEntry(parameterName);
                try {
                    doc.FamilyManager.RemoveParameter(param);
                    _ = log
                        .WithParameterEvent(
                            ParameterEventOutcome.ParameterDeleted,
                            ParameterEventReason.EmptyParameter,
                            parameterName: parameterName)
                        .Success("Deleted (empty parameter)");
                    deleteCount++;
                } catch (Exception ex) {
                    _ = log
                        .WithParameterEvent(
                            ParameterEventOutcome.ParameterDeleteFailed,
                            ParameterEventReason.DeleteParameterError,
                            parameterName: parameterName)
                        .Error(ex);
                }

                logs.Add(log);
                continue;
            }


            // For non-empty parameters, do the normal association checks
            if (param.GetDependents(allParams).Any(p => p.HasDirectAssociation(doc))) continue;

            var normalLog = new LogEntry(parameterName);
            try {
                doc.FamilyManager.RemoveParameter(param);
                _ = normalLog
                    .WithParameterEvent(
                        ParameterEventOutcome.ParameterDeleted,
                        ParameterEventReason.UnusedParameter,
                        parameterName: parameterName)
                    .Success("Deleted");
                deleteCount++;
            } catch (Exception ex) {
                _ = normalLog
                    .WithParameterEvent(
                        ParameterEventOutcome.ParameterDeleteFailed,
                        ParameterEventReason.DeleteParameterError,
                        parameterName: parameterName)
                    .Error(ex);
            }

            logs.Add(normalLog);
        }

        if (deleteCount > 0) this.RecursiveDelete(doc, logs, processingContext);
    }

    private static bool IsExcluded(FamilyParameter parameter, ExcludeSharedParameter names) =>
        names.Equaling.Any(parameter.Definition.Name.Equals) ||
        names.Containing.Any(parameter.Definition.Name.Contains) ||
        names.StartingWith.Any(parameter.Definition.Name.StartsWith);
}
