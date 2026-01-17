using Autodesk.Revit.DB.Electrical;
using Pe.Extensions.FamDocument;
using Pe.Global.Services.Storage.Core.Json.SchemaProcessors;
using Pe.Global.Services.Storage.Core.Json.SchemaProviders;
using System.ComponentModel.DataAnnotations;

namespace Pe.FamilyFoundry.Operations;

public class MakeElecConnector(MakeElecConnectorSettings settings) : DocOperation<MakeElecConnectorSettings>(settings) {
    /// <summary>Attempting to associate these will throw a "This parameter cannot be associated" exception.</summary>
    public List<string> UnassociableConnParams =
        ["Category", "System Type", "Power Factor State", "Design Option", "Family Name", "Type Name"];

    public override string Description =>
        "Configure electrical connector parameters and associate them with family parameters";

    public override OperationLog Execute(FamilyDocument doc,
        FamilyProcessingContext processingContext,
        OperationContext groupContext) {
        var logs = new List<LogEntry>();

        // TODO: Figure out PE_E___LoadClassification migration!!!!!!!!!
        // Note: Load Classification (RBS_ELEC_LOAD_CLASSIFICATION) is intentionally NOT mapped here.
        // Load Classification is a Reference type (SpecTypeId.Reference.LoadClassification) that requires
        // an ElementId pointing to an ElectricalLoadClassification element. These elements only exist
        // in project documents, not family documents, so we cannot set a default value in the family.
        // Load Classification must be set at the project level when family instances are placed.
        var targetMappings =
            new Dictionary<BuiltInParameter, string> {
                { BuiltInParameter.RBS_ELEC_VOLTAGE, this.Settings.SourceParameterNames.Voltage },
                { BuiltInParameter.RBS_ELEC_NUMBER_OF_POLES, this.Settings.SourceParameterNames.NumberOfPoles },
                { BuiltInParameter.RBS_ELEC_APPARENT_LOAD, this.Settings.SourceParameterNames.ApparentPower }
            };

        var connectorElements = new FilteredElementCollector(doc)
            .OfClass(typeof(ConnectorElement))
            .Cast<ConnectorElement>()
            .Where(ce => ce.Domain == Domain.DomainElectrical)
            .ToList();

        if (!connectorElements.Any()) {
            connectorElements.Add(MakeElectricalConnector(doc));
            logs.Add(new LogEntry("Create connector").Success());
        }

        foreach (var connectorElement in connectorElements)
            logs.AddRange(this.HandleConnectorParameters(doc, connectorElement.Parameters, targetMappings));

        return new OperationLog(this.Name, logs);
    }

    private List<LogEntry> HandleConnectorParameters(FamilyDocument doc,
        ParameterSet connectorParameters,
        Dictionary<BuiltInParameter, string> targetMappings
    ) {
        List<LogEntry> logs = [];
        foreach (Parameter targetParam in connectorParameters) {
            if (this.UnassociableConnParams.Contains(targetParam.Definition.Name)) continue;
            try {
                var bip = targetParam.Definition.Cast<InternalDefinition>().BuiltInParameter;
                var tgtAssociations = doc.FamilyManager.GetAssociatedFamilyParameter(targetParam);
                _ = targetMappings.TryGetValue(bip, out var sourceName);
                if (string.IsNullOrWhiteSpace(sourceName)) continue;

                var sourceParam = this.GetSourceParameter(doc, sourceName);
                if (sourceParam == null) {
                    logs.Add(new LogEntry(sourceName).Error("Parameter not found"));
                    continue;
                }

                // Dissociate everything and it explicitly
                if (tgtAssociations != null) {
                    logs.Add(new LogEntry($"Connector {tgtAssociations.Definition.Name}").Success("Unassociated"));
                    doc.FamilyManager.AssociateElementParameterToFamilyParameter(targetParam, null);
                }

                // Associate only if we can
                if (targetParam.Definition.GetDataType() == sourceParam.Definition.GetDataType()) {
                    logs.Add(new LogEntry($"Connector {sourceParam.Definition.Name}").Success("Associated"));
                    doc.FamilyManager.AssociateElementParameterToFamilyParameter(targetParam, sourceParam);
                }
            } catch (Exception ex) {
                logs.Add(new LogEntry($"Connector {targetParam.Definition.Name}").Error(ex));
            }
        }

        return logs;
    }

    private FamilyParameter GetSourceParameter(FamilyDocument doc, string name) =>
        doc.FamilyManager.Parameters
            .OfType<FamilyParameter>()
            .FirstOrDefault(fp => fp.Definition.Name == name);

    /// <summary>
    ///     Make an electrical connector on the family at the origin
    /// </summary>
    private static ConnectorElement MakeElectricalConnector(FamilyDocument doc) {
        var referenceCollector = new FilteredElementCollector(doc)
            .OfClass(typeof(ReferencePlane))
            .Cast<ReferencePlane>()
            .FirstOrDefault(rp => rp.Name is "Center (Left/Right)" or "CenterLR");

        Reference faceReference = null;

        faceReference = new Reference(referenceCollector);

        if (faceReference == null) {
            throw new InvalidOperationException(
                "Could not find a suitable planar face or reference plane to place the electrical connector on.");
        }

        try {
            // Create the electrical connector using PowerCircuit system type
            return ConnectorElement.CreateElectricalConnector(
                doc,
                ElectricalSystemType.PowerBalanced,
                faceReference);
        } catch (Exception ex) {
            throw new InvalidOperationException($"Failed to create electrical connector: {ex.Message}", ex);
        }
    }
}

public class MakeElecConnectorSettings : IOperationSettings {
    public Parameters SourceParameterNames { get; init; } = new();
    public bool Enabled { get; init; } = true;

    public class Parameters {
        [SchemaExamples(typeof(SharedParameterNamesProvider))]
        [Required]
        public string NumberOfPoles { get; init; } = "PE_E___NumberOfPoles";

        [SchemaExamples(typeof(SharedParameterNamesProvider))]
        [Required]
        public string ApparentPower { get; init; } = "PE_E___ApparentPower";

        [SchemaExamples(typeof(SharedParameterNamesProvider))]
        [Required]
        public string Voltage { get; init; } = "PE_E___Voltage";

        [SchemaExamples(typeof(SharedParameterNamesProvider))]
        [Required]
        public string MinimumCircuitAmpacity { get; init; } = "PE_E___MCA";
    }
}