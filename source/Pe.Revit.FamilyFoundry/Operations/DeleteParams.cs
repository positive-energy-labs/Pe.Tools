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
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();

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

            var hasBlockingDependentAssociation = stableParameters
                .Where(candidate => candidate.Id != paramToDelete.Id)
                .Where(candidate => !candidate.IsBuiltInParameter())
                .Where(candidate => paramToDelete.IsReferencedIn(candidate.Formula))
                .Any(candidate => candidate.HasDirectAssociation(doc));

            if (hasBlockingDependentAssociation) {
                logs.Add(new LogEntry(targetName).Skip("Blocked by dependent parameter association."));
                continue;
            }

            if (paramToDelete.HasDirectAssociation(doc)) {
                logs.Add(new LogEntry(targetName).Skip("Blocked by direct association."));
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
