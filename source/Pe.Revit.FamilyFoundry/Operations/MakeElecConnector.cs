using Autodesk.Revit.DB.Electrical;
using Pe.Revit.Extensions.FamDocument;
using Pe.StorageRuntime.Revit.Core.Json.SchemaProviders;
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
            if (!TryMakeElectricalConnector(doc, out var connectorElement, out var failureMessage) ||
                connectorElement == null) {
                logs.Add(new LogEntry("Create connector").Error(failureMessage));
                return new OperationLog(this.Name, logs);
            }

            connectorElements.Add(connectorElement);
            logs.Add(new LogEntry("Create connector").Success("Created electrical connector"));
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

    private static bool TryMakeElectricalConnector(
        FamilyDocument doc,
        out ConnectorElement? connectorElement,
        out string failureMessage
    ) {
        connectorElement = null;
        var attempts = new List<string>();
        var hostCandidates = GetReferencePlaneHostCandidates(doc)
            .Concat(GetPlanarFaceHostCandidates(doc));

        foreach (var candidate in hostCandidates) {
            if (TryCreateConnectorForCandidate(doc, candidate, out connectorElement, out var attemptMessage)) {
                failureMessage = string.Empty;
                return true;
            }

            attempts.Add(attemptMessage);
        }

        failureMessage = attempts.Count == 0
            ? "Could not create electrical connector: no candidate reference planes were found."
            : $"Could not create electrical connector. Attempts: {string.Join(" | ", attempts)}";
        return false;
    }

    private static bool TryCreateConnectorForCandidate(
        FamilyDocument doc,
        ConnectorHostCandidate candidate,
        out ConnectorElement? connectorElement,
        out string attemptMessage
    ) {
        connectorElement = null;
        try {
            connectorElement = ConnectorElement.CreateElectricalConnector(
                doc,
                ElectricalSystemType.PowerBalanced,
                candidate.HostReference
            );
            attemptMessage = string.Empty;
            return true;
        } catch (Exception refOnlyEx) {
            if (candidate.Edge == null) {
                attemptMessage = $"{candidate.Source}: {refOnlyEx.Message}";
                return false;
            }

            try {
                connectorElement = ConnectorElement.CreateElectricalConnector(
                    doc,
                    ElectricalSystemType.PowerBalanced,
                    candidate.HostReference,
                    candidate.Edge
                );
                attemptMessage = string.Empty;
                return true;
            } catch (Exception refEdgeEx) {
                attemptMessage = $"{candidate.Source}: {refOnlyEx.Message} | with edge: {refEdgeEx.Message}";
                return false;
            }
        }
    }

    private static IEnumerable<ConnectorHostCandidate> GetReferencePlaneHostCandidates(FamilyDocument doc) {
        var referencePlanes = new FilteredElementCollector(doc)
            .OfClass(typeof(ReferencePlane))
            .Cast<ReferencePlane>()
            .ToList();

        if (!referencePlanes.Any())
            yield break;

        var preferredNames = new[] {
            "Center (Left/Right)", "CenterLR", "Center (Front/Back)", "CenterFB", "Reference Plane"
        };

        var preferredSet = new HashSet<string>(preferredNames, StringComparer.OrdinalIgnoreCase);

        var preferred = preferredNames
            .Select(name => referencePlanes.FirstOrDefault(rp =>
                string.Equals(rp.Name, name, StringComparison.OrdinalIgnoreCase)))
            .Where(rp => rp != null)
            .Cast<ReferencePlane>();

        var fallback = referencePlanes
            .Where(rp => !preferredSet.Contains(rp.Name));

        foreach (var referencePlane in preferred.Concat(fallback)) {
            Reference planeReference;
            try {
                planeReference = referencePlane.GetReference();
            } catch {
                // Let downstream attempt reporting handle this in a consistent way.
                continue;
            }

            yield return new ConnectorHostCandidate(planeReference, null, $"'{referencePlane.Name}'");
        }
    }

    private static IEnumerable<ConnectorHostCandidate> GetPlanarFaceHostCandidates(FamilyDocument doc) {
        var revitDoc = doc.Document;
        var options = new Options {
            ComputeReferences = true, IncludeNonVisibleObjects = true, DetailLevel = ViewDetailLevel.Fine
        };

        var candidates = new List<(ConnectorHostCandidate Candidate, double Area)>();
        var seen = new HashSet<string>(StringComparer.Ordinal);

        var elements = new FilteredElementCollector(revitDoc)
            .WhereElementIsNotElementType()
            .ToElements();

        foreach (var element in elements) {
            if (element is ConnectorElement) continue;

            GeometryElement geometry;
            try {
                geometry = element.get_Geometry(options);
            } catch {
                continue;
            }

            if (geometry == null) continue;

            foreach (var (face, source) in EnumeratePlanarFaces(geometry, $"ElementId={element.Id}")) {
                if (face.Reference == null) continue;

                string stableRef;
                try {
                    stableRef = face.Reference.ConvertToStableRepresentation(revitDoc);
                } catch {
                    stableRef = $"{element.Id}:{source}:{face.Area}";
                }

                if (!seen.Add(stableRef)) continue;

                var firstEdge = face.EdgeLoops
                    .Cast<EdgeArray>()
                    .SelectMany(loop => loop.Cast<Edge>())
                    .FirstOrDefault();

                candidates.Add((new ConnectorHostCandidate(face.Reference, firstEdge, source), face.Area));
            }
        }

        return candidates
            .OrderByDescending(x => x.Area)
            .Select(x => x.Candidate);
    }

    private static IEnumerable<(PlanarFace Face, string Source)> EnumeratePlanarFaces(
        GeometryElement geometry,
        string sourcePrefix
    ) {
        foreach (var obj in geometry) {
            switch (obj) {
            case Solid solid when solid.Faces.Size > 0:
                foreach (Face face in solid.Faces) {
                    if (face is PlanarFace planarFace)
                        yield return (planarFace, $"{sourcePrefix}/SolidFace");
                }

                break;

            case GeometryInstance instance:
                GeometryElement instanceGeometry;
                try {
                    instanceGeometry = instance.GetInstanceGeometry();
                } catch {
                    continue;
                }

                foreach (var nested in EnumeratePlanarFaces(instanceGeometry, $"{sourcePrefix}/Instance"))
                    yield return nested;
                break;
            }
        }
    }

    private sealed record ConnectorHostCandidate(Reference HostReference, Edge? Edge, string Source);
}

public class MakeElecConnectorSettings : IOperationSettings {
    public Parameters SourceParameterNames { get; init; } = new();
    public bool Enabled { get; init; } = true;

    public class Parameters {
        [Required]
        public string NumberOfPoles { get; init; } = "PE_E___NumberOfPoles";

        [Required]
        public string ApparentPower { get; init; } = "PE_E___ApparentPower";

        [Required]
        public string Voltage { get; init; } = "PE_E___Voltage";

        [Required]
        public string MinimumCircuitAmpacity { get; init; } = "PE_E___MCA";
    }
}
