using Pe.Revit.Extensions.FamDocument;
using Pe.Revit.Extensions.FamParameter;
using Pe.Revit.Extensions.FamParameter.Formula;
using Pe.Revit.FamilyFoundry.OperationSettings;
using System.ComponentModel;
using System.ComponentModel.DataAnnotations;

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
            ?.FirstOrDefault(p => string.Equals(p.Name, param.Definition.Name, StringComparison.Ordinal)
                                  && p.IsInstance == param.IsInstance);

        if (snapshot == null) return false;

        // If parameter has a formula, check if it's a constant empty/zero value
        if (!string.IsNullOrWhiteSpace(snapshot.Formula))
            return this.IsFormulaEmpty(snapshot.Formula);

        // For non-formula parameters, check actual values
        var values = snapshot.ValuesPerType.Values.ToList();
        if (values.Count == 0) return true;

        return values.All(this.IsValueEmpty);
    }

    private bool IsValueEmpty(string value) {
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
            .Where(this.Settings.Filter)
            .Where(p => !p.IsBuiltInParameter())
            .OrderByDescending(p => p.Formula?.Length ?? 0)
            .ToList();

        foreach (var param in parameters) {
            // If empty AND DirectDelete is enabled, delete immediately (bypass association checks)
            if (this.Settings.DirectDeleteEmptyParameters
                && this.IsParameterEmpty(param, processingContext)) {
                var log = new LogEntry(param.Definition.Name);
                try {
                    doc.FamilyManager.RemoveParameter(param);
                    _ = log.Success("Deleted (empty parameter)");
                    deleteCount++;
                } catch (Exception ex) {
                    _ = log.Error(ex);
                }

                logs.Add(log);
                continue;
            }


            // For non-empty parameters, do the normal association checks
            if (param.GetDependents(allParams).Any(p => p.HasDirectAssociation(doc))) continue;
            if (param.HasDirectAssociation(doc)) continue;

            var normalLog = new LogEntry(param.Definition.Name);
            try {
                doc.FamilyManager.RemoveParameter(param);
                _ = normalLog.Success("Deleted");
                deleteCount++;
            } catch (Exception ex) {
                _ = normalLog.Error(ex);
            }

            logs.Add(normalLog);
        }

        if (deleteCount > 0) this.RecursiveDelete(doc, logs, processingContext);
    }
}

public class PurgeParamsSettings : PurgeParamsBase, IOperationSettings {
    public bool Enabled { get; init; } = true;
}

public class PurgeParamsBase {
    [Description(
        "Whether to delete parameters that have no value for every family type, regardless of whether they are used in the family. This is rare but possible. This setting is useful for properties like url variations where there are often multiple url parameters with no value.")]
    public bool DirectDeleteEmptyParameters { get; init; } = true;

    [Description("Whether to consider zero value as \"empty\" when deleting empty parameters.")]
    public bool ConsiderZeroValueAsEmpty { get; init; } = true;

    [Description("Whether to consider empty string as \"empty\" when deleting empty parameters.")]
    public bool ConsiderEmptyStringAsEmpty { get; init; } = true;

    [Description(
        "Exclude parameters from the deletion list. Parameters matching any exclude filter (Equaling, Containing, or StartingWith) will be protected from deletion.")]
    [Required]
    public ExcludeSharedParameter ExcludeNames { get; init; } = new();

    public bool Filter(FamilyParameter p) => !this.IsExcluded(p);

    private bool IsExcluded(FamilyParameter p) =>
        this.ExcludeNames.Equaling.Any(p.Definition.Name.Equals) ||
        this.ExcludeNames.Containing.Any(p.Definition.Name.Contains) ||
        this.ExcludeNames.StartingWith.Any(p.Definition.Name.StartsWith);
}