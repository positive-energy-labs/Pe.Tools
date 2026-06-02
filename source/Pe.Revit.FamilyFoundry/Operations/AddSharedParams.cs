using Pe.Revit.Extensions.FamDocument;

namespace Pe.Revit.FamilyFoundry.Operations;

public class AddSharedParams(
    IEnumerable<SharedParameterMappingTarget> targets
) : DocOperation<DefaultOperationSettings>(new DefaultOperationSettings()) {
    private IEnumerable<SharedParameterMappingTarget> Targets { get; } = targets;

    public override string Description => "Download and add shared parameters from Autodesk Parameters Service";

    public override OperationLog Execute(FamilyDocument doc,
        FamilyProcessingContext processingContext,
        OperationContext groupContext) {
        var logs = new List<LogEntry>();
        foreach (var target in this.Targets) {
            try {
                var addedParam = doc.AddSharedParameter(target.SharedParameter);
                logs.Add(new LogEntry(addedParam.Definition.Name)
                    .WithParameterEvent(
                        ParameterEventOutcome.TargetAdded,
                        targetParameter: target.Name,
                        parameterName: target.Name,
                        mappingKey: target.Name,
                        dataType: target.Definition.DataTypeId,
                        isInstance: target.IsInstance)
                    .Success("Added"));
            } catch (Exception ex) {
                logs.Add(new LogEntry(target.Name)
                    .WithParameterEvent(
                        ParameterEventOutcome.TargetAddFailed,
                        ParameterEventReason.AddParameterError,
                        targetParameter: target.Name,
                        parameterName: target.Name,
                        mappingKey: target.Name,
                        dataType: target.Definition.DataTypeId,
                        isInstance: target.IsInstance)
                    .Error(ex));
            }
        }

        return new OperationLog(this.Name, logs);
    }
}
