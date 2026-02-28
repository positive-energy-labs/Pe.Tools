using Pe.Extensions.FamDocument;
using Pe.Global;

namespace Pe.FamilyFoundry.Operations;

public class AddSharedParams(
    IEnumerable<SharedParameterDefinition> sharedParams
) : DocOperation<DefaultOperationSettings>(new DefaultOperationSettings()) {
    private IEnumerable<SharedParameterDefinition> SharedParams {
        get;
    } = sharedParams;

    public override string Description => "Download and add shared parameters from Autodesk Parameters Service";

    public override OperationLog Execute(FamilyDocument doc,
        FamilyProcessingContext processingContext,
        OperationContext groupContext) {
        var logs = new List<LogEntry>();
        foreach (var sharedParam in this.SharedParams) {
            var name = sharedParam.ExternalDefinition.Name;
            try {
                var addedParam = doc.AddSharedParameter(sharedParam);
                logs.Add(new LogEntry(addedParam.Definition.Name).Success("Added"));
            } catch (Exception ex) {
                logs.Add(new LogEntry(name).Error(ex));
            }
        }

        return new OperationLog(this.Name, logs);
    }
}