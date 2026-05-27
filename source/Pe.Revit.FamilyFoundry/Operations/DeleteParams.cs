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

        foreach (var targetName in targetNames) {
            var paramToDelete = fm.FindParameter(targetName);

            if (paramToDelete == null) {
                logs.Add(new LogEntry(targetName).Skip("Parameter not found."));
                continue;
            }
            
            if (paramToDelete.IsBuiltInParameter()) {
                logs.Add(new LogEntry(targetName).Skip("Built-in parameters cannot be deleted."));
                continue;
            }

            if (paramToDelete.GetDependents(doc.FamilyManager.Parameters).Any(dependent => dependent.HasDirectAssociation(doc))) {
                logs.Add(new LogEntry(targetName).Skip("Blocked by dependent parameter association."));
                continue;
            }

            if (paramToDelete.HasDirectAssociation(doc)) {
                logs.Add(new LogEntry(targetName).Skip("Blocked by direct association."));
                continue;
            }

            try {
                doc.FamilyManager.RemoveParameter(paramToDelete);
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
