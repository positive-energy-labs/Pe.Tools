using Autodesk.Revit.DB.Mechanical;
using Newtonsoft.Json;
using Newtonsoft.Json.Converters;
using Pe.Extensions.FamDocument;

namespace Pe.FamilyFoundry.Operations;

public class SetDuctConnectorSettings(DuctConnectorConfigurator settings)
    : DocOperation<DefaultOperationSettings>(new DefaultOperationSettings()) {
    private readonly DuctConnectorConfigurator settings = settings;
    public override string Description => "Make Duct Connector Variants";

    public override OperationLog Execute(FamilyDocument famDoc,
        FamilyProcessingContext processingContext,
        OperationContext groupContext) {
        var logs = new List<LogEntry>();
        try {
            var connectorElements = new FilteredElementCollector(famDoc)
                .OfClass(typeof(ConnectorElement))
                .Cast<ConnectorElement>()
                .Where(ce => ce.Domain == Domain.DomainHvac)
                .ToList();

            foreach (var ce in connectorElements) {
                this.settings.ApplyTo(ce);
                logs.Add(new LogEntry(ce.Name).Success("Applied"));
            }
        } catch (Exception ex) {
            logs.Add(new LogEntry("Error applying settings").Error(ex));
        }

        return new OperationLog(nameof(SetDuctConnectorSettings), logs);
    }
}

public class DuctConnectorConfigurator {
    public static readonly DuctConnectorConfigurator PresetATSupply = new() {
        FlowConfiguration = DuctFlowConfigurationType.Preset,
        FlowDirection = FlowDirectionType.In,
        SystemClassification = MEPSystemClassification.SupplyAir,
        LossMethod = DuctLossMethodType.NotDefined
    };

    public static readonly DuctConnectorConfigurator PresetATReturn = new() {
        FlowConfiguration = DuctFlowConfigurationType.Preset,
        FlowDirection = FlowDirectionType.Out,
        SystemClassification = MEPSystemClassification.ReturnAir,
        LossMethod = DuctLossMethodType.NotDefined
    };

    public static readonly DuctConnectorConfigurator PresetATExhaust = new() {
        FlowConfiguration = DuctFlowConfigurationType.Preset,
        FlowDirection = FlowDirectionType.Out,
        SystemClassification = MEPSystemClassification.ExhaustAir,
        LossMethod = DuctLossMethodType.NotDefined
    };

    public static readonly DuctConnectorConfigurator PresetATIntake = new() {
        FlowConfiguration = DuctFlowConfigurationType.Preset,
        FlowDirection = FlowDirectionType.Out,
        SystemClassification = MEPSystemClassification.ReturnAir,
        LossMethod = DuctLossMethodType.NotDefined
    };

    public DuctFlowConfigurationType FlowConfiguration { get; init; }
    public FlowDirectionType FlowDirection { get; init; }
    public MEPSystemClassification SystemClassification { get; init; }
    public DuctLossMethodType LossMethod { get; init; }

    public void ApplyTo(ConnectorElement ce) {
        ce.SystemClassification = this.SystemClassification;
        _ = ce.get_Parameter(BuiltInParameter.RBS_DUCT_FLOW_CONFIGURATION_PARAM)
            .Set((int)this.FlowConfiguration);
        _ = ce.get_Parameter(BuiltInParameter.RBS_DUCT_FLOW_DIRECTION_PARAM)
            .Set((int)this.FlowDirection);
        _ = ce.get_Parameter(BuiltInParameter.RBS_DUCT_FITTING_LOSS_METHOD_PARAM)
            .Set((int)this.LossMethod);
    }

    public static DuctConnectorConfigurator FromConnectorElement(ConnectorElement ce) =>
        new() {
            SystemClassification = ce.SystemClassification,
            FlowConfiguration =
                (DuctFlowConfigurationType)ce.get_Parameter(BuiltInParameter.RBS_DUCT_FLOW_CONFIGURATION_PARAM)
                    .AsInteger(),
            FlowDirection =
                (FlowDirectionType)ce.get_Parameter(BuiltInParameter.RBS_DUCT_FLOW_DIRECTION_PARAM).AsInteger(),
            LossMethod =
                (DuctLossMethodType)ce.get_Parameter(BuiltInParameter.RBS_DUCT_FITTING_LOSS_METHOD_PARAM).AsInteger()
        };

    public override string ToString() =>
        JsonConvert.SerializeObject(this,
            new JsonSerializerSettings {
                Formatting = Formatting.Indented, Converters = new List<JsonConverter> { new StringEnumConverter() }
            });

    public string ToStringUnConverted() =>
        JsonConvert.SerializeObject(this, new JsonSerializerSettings { Formatting = Formatting.Indented });
}