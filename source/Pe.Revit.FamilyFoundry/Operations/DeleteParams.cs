using Pe.Revit.Extensions.FamDocument;
using Pe.Revit.Extensions.FamManager;
using Pe.Revit.Extensions.FamParameter;
using Pe.Revit.Extensions.FamParameter.Formula;
using System.ComponentModel;
using System.ComponentModel.DataAnnotations;

namespace Pe.Revit.FamilyFoundry.Operations;

public sealed class DeleteParams(DeleteParamsSettings settings) : DocOperation<DeleteParamsSettings>(settings) {
    public override string Description => "Delete explicitly named family parameters";

    public override OperationLog Execute(
        FamilyDocument doc,
        FamilyProcessingContext processingContext,
        OperationContext groupContext
    ) {
        var logs = new List<LogEntry>();
        var targetNames = this.Settings.Names
            .Where(name => !string.IsNullOrWhiteSpace(name))
            .Distinct(StringComparer.Ordinal)
            .ToList(); // ordered: the reconciler sorts by formula length descending (gotcha 21)

        if (targetNames.Count == 0) {
            logs.Add(new LogEntry("DeleteParams").Skip("No parameter names were provided."));
            return new OperationLog(this.Name, logs);
        }

        var fm = doc.FamilyManager;
        var stableParameters = new List<FamilyParameter>();
        var stableParametersByName = new Dictionary<string, FamilyParameter>(StringComparer.OrdinalIgnoreCase);

        foreach (var parameter in fm.GetParameters()) {
            if (parameter == null)
                continue;

            string? parameterName;
            try {
                parameterName = parameter.Definition?.Name;
            } catch {
                continue;
            }

            if (string.IsNullOrWhiteSpace(parameterName))
                continue;

            stableParameters.Add(parameter);
            stableParametersByName.TryAdd(parameterName, parameter);
        }

        foreach (var targetName in targetNames) {
            if (!stableParametersByName.TryGetValue(targetName, out var paramToDelete)) {
                logs.Add(new LogEntry(targetName).Skip("Parameter not found."));
                continue;
            }

            if (paramToDelete.IsBuiltInParameter()) {
                logs.Add(new LogEntry(targetName).Skip("Built-in parameters cannot be deleted."));
                continue;
            }

            var blockers = stableParameters
                .Where(candidate => candidate.Id != paramToDelete.Id && !candidate.IsBuiltInParameter())
                .Where(candidate => paramToDelete.IsReferencedIn(candidate.Formula) && candidate.HasDirectAssociation(doc))
                .Select(candidate => candidate.Definition.Name)
                .ToList();
            if (paramToDelete.HasDirectAssociation(doc)) blockers.Insert(0, targetName);
            if (blockers.Count > 0) {
                logs.Add(new LogEntry(targetName).Error($"Blocked by association on: {string.Join(", ", blockers)}. Delete the dimension, array or connector binding first."));
                continue;
            }

            try {
                doc.FamilyManager.RemoveParameter(paramToDelete);
                stableParameters.RemoveAll(parameter => parameter.Id == paramToDelete.Id);
                stableParametersByName.Remove(targetName);
                logs.Add(new LogEntry(targetName).Success("Deleted."));
            } catch (Exception ex) {
                logs.Add(new LogEntry(targetName).Error(ex));
            }
        }

        return new OperationLog(this.Name, logs);
    }
}

public sealed class DeleteParamsSettings : IOperationSettings {
    [Description("Exact parameter names to delete. Wildcards and pattern matching are not supported.")]
    [Required]
    public List<string> Names { get; init; } = [];

    public bool Enabled { get; init; } = true;
}
