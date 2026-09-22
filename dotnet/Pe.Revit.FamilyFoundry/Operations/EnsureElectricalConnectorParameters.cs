using Autodesk.Revit.DB.Electrical;
using Pe.Revit.Extensions.FamDocument;
using Pe.Shared.RevitData.Families;

namespace Pe.Revit.FamilyFoundry.Operations;

internal sealed class EnsureElectricalConnectorParameters(ElectricalConnectorParameterRule rule)
    : DocOperation<DefaultOperationSettings>(new DefaultOperationSettings()) {
    public override string Description => "Associate company parameters to every electrical connector";

    public override OperationLog Execute(FamilyDocument doc, FamilyProcessingContext ctx, OperationContext g) {
        var changed = doc.EnsureElectricalConnectorAssociations(new Dictionary<BuiltInParameter, string> {
            [BuiltInParameter.RBS_ELEC_VOLTAGE] = rule.Voltage,
            [BuiltInParameter.RBS_ELEC_NUMBER_OF_POLES] = rule.NumberOfPoles,
            [BuiltInParameter.RBS_ELEC_APPARENT_LOAD] = rule.ApparentPower
        }, rule.CreateIfAbsent);
        return new OperationLog(this.Name, [changed.Count == 0
            ? new LogEntry("Electrical connectors").Skip("Associations unchanged.")
            : new LogEntry("Electrical connectors").Success($"Associated {changed.Count} connector(s): {string.Join(", ", changed.Select(id => id.Value()))}.")]);
    }
}
