using Autodesk.Revit.DB;
using Autodesk.Revit.DB.ExtensibleStorage;
using Autodesk.Revit.DB.Electrical;
using Autodesk.Revit.DB.Mechanical;
using Autodesk.Revit.DB.Plumbing;
using Newtonsoft.Json;
using Pe.Extensions.FamDocument;
using Pe.FamilyFoundry.Helpers;
using Pe.FamilyFoundry.OperationSettings;
using Pe.FamilyFoundry.Snapshots;

namespace Pe.FamilyFoundry.Operations;

public sealed class MakeParamDrivenConnectors(MakeParamDrivenConnectorsSettings settings)
    : DocOperation<MakeParamDrivenConnectorsSettings>(settings) {
    private const double DefaultStubDepth = 0.5 / 12.0;
    private static readonly JsonSerializerSettings JsonSettings = new() {
        Formatting = Formatting.None,
        ReferenceLoopHandling = ReferenceLoopHandling.Ignore
    };

    private static readonly Guid SchemaGuid = new("5B783D25-75C1-4C23-8F7D-5762D4D0DB6B");
    private const string SchemaName = "PE_ParamDrivenConnectorMetadata";
    private static readonly HashSet<string> UnassociableConnectorParameters = [
        "Category", "System Type", "Power Factor State", "Design Option", "Family Name", "Type Name"
    ];

    public override string Description => "Create semantic ParamDrivenSolids connectors with stub geometry";

    public override OperationLog Execute(
        FamilyDocument doc,
        FamilyProcessingContext processingContext,
        OperationContext groupContext
    ) {
        var logs = new List<LogEntry>();

        foreach (var connector in this.Settings.Connectors)
            CreateConnectorUnit(doc, connector, logs);

        return new OperationLog(this.Name, logs);
    }

    internal static StoredParamDrivenConnectorMetadata? TryReadStoredMetadata(Element element) {
        var schema = Schema.Lookup(SchemaGuid);
        if (schema == null)
            return null;

        var entity = element.GetEntity(schema);
        if (!entity.IsValid())
            return null;

        var json = entity.Get<string>("JsonData");
        return string.IsNullOrWhiteSpace(json)
            ? null
            : JsonConvert.DeserializeObject<StoredParamDrivenConnectorMetadata>(json, JsonSettings);
    }

    private static void CreateConnectorUnit(
        FamilyDocument doc,
        CompiledParamDrivenConnectorSpec spec,
        List<LogEntry> logs
    ) {
        var key = $"Connector: {spec.Name}";
        var stubKey = $"{key} stub";
        var executableSpec = BuildExecutableStubSpec(doc.Document, spec);
        var hostingPlan = ResolveStubHostingPlan(doc.Document, spec);
        var stubResult = spec.Profile == ParamDrivenConnectorProfile.Rectangular
            ? ConstrainedExtrusionFactory.CreateRectangle(doc.Document, executableSpec.RectangularStub!, logs, stubKey, hostingPlan.SketchPlaneOverride)
            : ConstrainedExtrusionFactory.CreateCircle(
                doc.Document,
                executableSpec.RoundStub!,
                logs,
                stubKey,
                hostingPlan.SketchPlaneOverride);
        if (!stubResult.Created || stubResult.Extrusion == null || stubResult.TerminalFace?.Reference == null) {
            logs.Add(new LogEntry(key).Error("Failed to create connector stub geometry."));
            return;
        }

        ConnectorElement? connector = null;
        try {
            connector = CreateConnectorElement(doc.Document, spec, stubResult.TerminalFace);
        } catch (Exception ex) {
            logs.Add(new LogEntry(key).Error(ex));
            return;
        }

        if (connector == null) {
            logs.Add(new LogEntry(key).Error("Connector creation returned null."));
            return;
        }

        ApplyStubIntrinsicAssociations(doc, stubResult.Extrusion, spec, logs, key);
        ApplyDomainConfiguration(connector, spec, logs, key);
        ApplyConnectorIntrinsicAssociations(doc, connector, spec, logs, key);
        ApplyParameterBindings(doc, connector, spec, logs, key);
        doc.Document.Regenerate();
        PersistMetadata(connector, spec, logs, key);
        PersistMetadata(stubResult.Extrusion, spec, logs, key);
        logs.Add(new LogEntry(key).Success("Created hosted connector unit."));
    }

    private static CompiledParamDrivenConnectorSpec BuildExecutableStubSpec(
        Document doc,
        CompiledParamDrivenConnectorSpec spec
    ) {
        var resolvedDepth = ResolveCurrentDepth(doc, spec.AuthoredSpec.Host.Depth.Parameter);
        if (spec.Profile == ParamDrivenConnectorProfile.Rectangular && spec.RectangularStub != null) {
            return new CompiledParamDrivenConnectorSpec {
                Name = spec.Name,
                StubSolidName = spec.StubSolidName,
                Domain = spec.Domain,
                Profile = spec.Profile,
                HostPlaneName = spec.HostPlaneName,
                HostFacePlaneName = spec.HostFacePlaneName,
                RectangularStub = new ConstrainedRectangleExtrusionSpec {
                    Name = spec.RectangularStub.Name,
                    IsSolid = spec.RectangularStub.IsSolid,
                    StartOffset = spec.RectangularStub.StartOffset,
                    EndOffset = resolvedDepth,
                    SketchPlaneName = spec.RectangularStub.SketchPlaneName,
                    PairAPlane1 = spec.RectangularStub.PairAPlane1,
                    PairAPlane2 = spec.RectangularStub.PairAPlane2,
                    PairAParameter = spec.RectangularStub.PairAParameter,
                    PairBPlane1 = spec.RectangularStub.PairBPlane1,
                    PairBPlane2 = spec.RectangularStub.PairBPlane2,
                    PairBParameter = spec.RectangularStub.PairBParameter,
                    HeightPlaneBottom = spec.RectangularStub.HeightPlaneBottom,
                    HeightPlaneTop = spec.RectangularStub.HeightPlaneTop,
                    HeightParameter = spec.RectangularStub.HeightParameter
                },
                Bindings = spec.Bindings,
                Config = spec.Config,
                AuthoredSpec = spec.AuthoredSpec
            };
        }

        if (spec.RoundStub == null)
            return spec;

        return new CompiledParamDrivenConnectorSpec {
            Name = spec.Name,
            StubSolidName = spec.StubSolidName,
            Domain = spec.Domain,
            Profile = spec.Profile,
            HostPlaneName = spec.HostPlaneName,
            HostFacePlaneName = spec.HostFacePlaneName,
            RoundStub = new ConstrainedCircleExtrusionSpec {
                Name = spec.RoundStub.Name,
                IsSolid = spec.RoundStub.IsSolid,
                StartOffset = spec.RoundStub.StartOffset,
                EndOffset = resolvedDepth,
                SketchPlaneName = spec.RoundStub.SketchPlaneName,
                CenterLeftRightPlane = spec.RoundStub.CenterLeftRightPlane,
                CenterFrontBackPlane = spec.RoundStub.CenterFrontBackPlane,
                DiameterParameter = spec.RoundStub.DiameterParameter,
                HeightPlaneBottom = spec.RoundStub.HeightPlaneBottom,
                HeightPlaneTop = spec.RoundStub.HeightPlaneTop,
                HeightParameter = spec.RoundStub.HeightParameter
            },
            Bindings = spec.Bindings,
            Config = spec.Config,
            AuthoredSpec = spec.AuthoredSpec
        };
    }

    private static double ResolveCurrentDepth(Document doc, string parameterName) {
        if (string.IsNullOrWhiteSpace(parameterName))
            return DefaultStubDepth;

        var parameter = doc.FamilyManager.get_Parameter(parameterName);
        var currentType = doc.FamilyManager.CurrentType;
        var currentValue = parameter != null && currentType != null && currentType.HasValue(parameter)
            ? currentType.AsDouble(parameter) ?? 0.0
            : 0.0;

        var magnitude = Math.Abs(currentValue);
        return magnitude > 1e-6 ? magnitude : DefaultStubDepth;
    }

    private static ConnectorStubHostingPlan ResolveStubHostingPlan(Document doc, CompiledParamDrivenConnectorSpec spec) {
        if (ResolveStubDepthDirection(spec) != ConnectorStubDepthDirection.NegativeAlongHostNormal)
            return ConnectorStubHostingPlan.Default;

        var hostPlane = ResolveHostPlane(doc, spec.HostPlaneName);
        if (hostPlane == null)
            return ConnectorStubHostingPlan.Default;

        var flippedPlane = Plane.CreateByNormalAndOrigin(
            hostPlane.Normal.Negate(),
            hostPlane.Origin);
        return new ConnectorStubHostingPlan(SketchPlane.Create(doc, flippedPlane));
    }

    private static ConnectorStubDepthDirection ResolveStubDepthDirection(CompiledParamDrivenConnectorSpec spec) =>
        spec.AuthoredSpec.Host.Depth.Direction == OffsetDirection.Negative
            ? ConnectorStubDepthDirection.NegativeAlongHostNormal
            : ConnectorStubDepthDirection.PositiveAlongHostNormal;

    private static Plane? ResolveHostPlane(Document doc, string planeName) {
        if (string.IsNullOrWhiteSpace(planeName))
            return null;

        var referencePlane = new FilteredElementCollector(doc)
            .OfClass(typeof(ReferencePlane))
            .Cast<ReferencePlane>()
            .FirstOrDefault(plane => string.Equals(plane.Name, planeName, StringComparison.OrdinalIgnoreCase));
        if (referencePlane != null)
            return Plane.CreateByNormalAndOrigin(
                referencePlane.Normal.Normalize(),
                (referencePlane.BubbleEnd + referencePlane.FreeEnd) * 0.5);

        return new FilteredElementCollector(doc)
            .OfClass(typeof(SketchPlane))
            .Cast<SketchPlane>()
            .FirstOrDefault(plane => string.Equals(plane.Name, planeName, StringComparison.OrdinalIgnoreCase))
            ?.GetPlane();
    }

    private static ConnectorElement CreateConnectorElement(
        Document doc,
        CompiledParamDrivenConnectorSpec spec,
        PlanarFace hostFace
    ) {
        var edge = hostFace.EdgeLoops
            .Cast<EdgeArray>()
            .SelectMany(loop => loop.Cast<Edge>())
            .FirstOrDefault();

        return spec.Domain switch {
            ParamDrivenConnectorDomain.Duct => edge == null
                ? ConnectorElement.CreateDuctConnector(
                    doc,
                    spec.Config.Duct!.SystemType,
                    ToConnectorProfileType(spec.Profile),
                    hostFace.Reference)
                : ConnectorElement.CreateDuctConnector(
                    doc,
                    spec.Config.Duct!.SystemType,
                    ToConnectorProfileType(spec.Profile),
                    hostFace.Reference,
                    edge),
            ParamDrivenConnectorDomain.Pipe => edge == null
                ? ConnectorElement.CreatePipeConnector(doc, spec.Config.Pipe!.SystemType, hostFace.Reference)
                : ConnectorElement.CreatePipeConnector(doc, spec.Config.Pipe!.SystemType, hostFace.Reference, edge),
            ParamDrivenConnectorDomain.Electrical => edge == null
                ? ConnectorElement.CreateElectricalConnector(doc, spec.Config.Electrical!.SystemType, hostFace.Reference)
                : ConnectorElement.CreateElectricalConnector(doc, spec.Config.Electrical!.SystemType, hostFace.Reference, edge),
            _ => throw new InvalidOperationException($"Unsupported connector domain '{spec.Domain}'.")
        };
    }

    private static ConnectorProfileType ToConnectorProfileType(ParamDrivenConnectorProfile profile) =>
        profile switch {
            ParamDrivenConnectorProfile.Round => ConnectorProfileType.Round,
            ParamDrivenConnectorProfile.Rectangular => ConnectorProfileType.Rectangular,
            _ => throw new InvalidOperationException($"Unsupported connector profile '{profile}'.")
        };

    private static void ApplyDomainConfiguration(
        ConnectorElement connector,
        CompiledParamDrivenConnectorSpec spec,
        List<LogEntry> logs,
        string key
    ) {
        try {
            if (spec.Domain != ParamDrivenConnectorDomain.Duct || spec.Config.Duct == null)
                return;

            _ = connector.get_Parameter(BuiltInParameter.RBS_DUCT_FLOW_CONFIGURATION_PARAM)
                ?.Set((int)spec.Config.Duct.FlowConfiguration);
            _ = connector.get_Parameter(BuiltInParameter.RBS_DUCT_FLOW_DIRECTION_PARAM)
                ?.Set((int)spec.Config.Duct.FlowDirection);
            _ = connector.get_Parameter(BuiltInParameter.RBS_DUCT_FITTING_LOSS_METHOD_PARAM)
                ?.Set((int)spec.Config.Duct.LossMethod);
            logs.Add(new LogEntry(key).Success("Applied duct connector configuration."));
        } catch (Exception ex) {
            logs.Add(new LogEntry(key).Error($"Created connector, but failed domain configuration: {ex.Message}"));
        }
    }

    private static void ApplyParameterBindings(
        FamilyDocument doc,
        ConnectorElement connector,
        CompiledParamDrivenConnectorSpec spec,
        List<LogEntry> logs,
        string key
    ) {
        if (spec.Bindings.Parameters.Count == 0)
            return;

        var bindingsByTarget = spec.Bindings.Parameters
            .Where(binding => !string.IsNullOrWhiteSpace(binding.SourceParameter))
            .ToDictionary(binding => binding.Target, binding => binding.SourceParameter.Trim());

        foreach (Parameter connectorParam in connector.Parameters) {
            if (UnassociableConnectorParameters.Contains(connectorParam.Definition.Name))
                continue;

            try {
                var target = TryMapTarget(connectorParam.Definition.Cast<InternalDefinition>().BuiltInParameter);
                if (target == null || !bindingsByTarget.TryGetValue(target.Value, out var sourceParameterName))
                    continue;

                AssociateElementParameter(doc, connectorParam, sourceParameterName, key, target.Value.ToString(), logs);
            } catch (Exception ex) {
                logs.Add(new LogEntry(key).Error($"Failed connector binding for '{connectorParam.Definition.Name}': {ex.Message}"));
            }
        }
    }

    private static void ApplyStubIntrinsicAssociations(
        FamilyDocument doc,
        Extrusion extrusion,
        CompiledParamDrivenConnectorSpec spec,
        List<LogEntry> logs,
        string key
    ) {
        _ = AssociateBuiltInParameter(
            doc,
            extrusion.get_Parameter(BuiltInParameter.EXTRUSION_END_PARAM),
            spec.AuthoredSpec.Host.Depth.Parameter,
            key,
            "stub depth",
            logs,
            required: true);
    }

    private static void ApplyConnectorIntrinsicAssociations(
        FamilyDocument doc,
        ConnectorElement connector,
        CompiledParamDrivenConnectorSpec spec,
        List<LogEntry> logs,
        string key
    ) {
        if (spec.Domain == ParamDrivenConnectorDomain.Electrical)
            return;

        if (spec.Profile == ParamDrivenConnectorProfile.Round && spec.RoundStub != null) {
            _ = AssociateBuiltInParameter(
                doc,
                connector.get_Parameter(BuiltInParameter.CONNECTOR_DIAMETER),
                spec.RoundStub.DiameterParameter,
                key,
                "connector diameter",
                logs,
                required: true);
            return;
        }

        if (spec.RectangularStub == null)
            return;

        _ = AssociateBuiltInParameter(
            doc,
            connector.get_Parameter(BuiltInParameter.CONNECTOR_WIDTH),
            spec.RectangularStub.PairBParameter,
            key,
            "connector width",
            logs,
            required: true);
        _ = AssociateBuiltInParameter(
            doc,
            connector.get_Parameter(BuiltInParameter.CONNECTOR_HEIGHT),
            spec.RectangularStub.PairAParameter,
            key,
            "connector height",
            logs,
            required: true);
    }

    private static bool AssociateBuiltInParameter(
        FamilyDocument doc,
        Parameter? targetParam,
        string sourceParameterName,
        string key,
        string targetLabel,
        List<LogEntry> logs,
        bool required
    ) {
        if (targetParam == null) {
            if (required)
                logs.Add(new LogEntry(key).Error($"The {targetLabel} built-in parameter was not found."));
            return false;
        }

        return AssociateElementParameter(doc, targetParam, sourceParameterName, key, targetLabel, logs);
    }

    private static bool AssociateElementParameter(
        FamilyDocument doc,
        Parameter targetParam,
        string sourceParameterName,
        string key,
        string targetLabel,
        List<LogEntry> logs
    ) {
        if (string.IsNullOrWhiteSpace(sourceParameterName)) {
            logs.Add(new LogEntry(key).Error($"No source parameter was configured for {targetLabel}."));
            return false;
        }

        var sourceParam = doc.FamilyManager.Parameters
            .OfType<FamilyParameter>()
            .FirstOrDefault(param => string.Equals(param.Definition.Name, sourceParameterName, StringComparison.Ordinal));
        if (sourceParam == null) {
            logs.Add(new LogEntry(key).Error($"Binding source parameter '{sourceParameterName}' was not found for {targetLabel}."));
            return false;
        }

        var existing = doc.FamilyManager.GetAssociatedFamilyParameter(targetParam);
        if (existing?.Id == sourceParam.Id) {
            logs.Add(new LogEntry(key).Success($"Confirmed {targetLabel} is associated to '{sourceParameterName}'."));
            return true;
        }

        if (existing != null)
            doc.FamilyManager.AssociateElementParameterToFamilyParameter(targetParam, null);

        if (targetParam.Definition.GetDataType() != sourceParam.Definition.GetDataType()) {
            logs.Add(new LogEntry(key).Error(
                $"Could not associate {targetLabel} to '{sourceParameterName}' because the data types differ."));
            return false;
        }

        doc.FamilyManager.AssociateElementParameterToFamilyParameter(targetParam, sourceParam);
        logs.Add(new LogEntry(key).Success($"Associated {targetLabel} to '{sourceParameterName}'."));
        return true;
    }

    private static ConnectorParameterKey? TryMapTarget(BuiltInParameter parameter) =>
        parameter switch {
            BuiltInParameter.RBS_ELEC_VOLTAGE => ConnectorParameterKey.Voltage,
            BuiltInParameter.RBS_ELEC_NUMBER_OF_POLES => ConnectorParameterKey.NumberOfPoles,
            BuiltInParameter.RBS_ELEC_APPARENT_LOAD => ConnectorParameterKey.ApparentPower,
            _ => null
        };

    private static void PersistMetadata(
        Element element,
        CompiledParamDrivenConnectorSpec spec,
        List<LogEntry> logs,
        string key
    ) {
        try {
            var schema = GetOrCreateSchema();
            var metadata = new StoredParamDrivenConnectorMetadata {
                StubSolidName = spec.StubSolidName,
                Spec = spec.AuthoredSpec
            };
            var entity = new Entity(schema);
            entity.Set("Version", 1);
            entity.Set("JsonData", JsonConvert.SerializeObject(metadata, JsonSettings));
            element.SetEntity(entity);
            logs.Add(new LogEntry(key).Success("Persisted connector metadata for roundtrip."));
        } catch (Exception ex) {
            logs.Add(new LogEntry(key).Error($"Created connector, but failed metadata persistence: {ex.Message}"));
        }
    }

    private static Schema GetOrCreateSchema() {
        var schema = Schema.Lookup(SchemaGuid);
        if (schema != null)
            return schema;

        var builder = new SchemaBuilder(SchemaGuid);
        _ = builder.SetSchemaName(SchemaName);
        _ = builder.SetReadAccessLevel(AccessLevel.Public);
        _ = builder.SetWriteAccessLevel(AccessLevel.Public);
        _ = builder.AddSimpleField("Version", typeof(int));
        _ = builder.AddSimpleField("JsonData", typeof(string));
        return builder.Finish();
    }

    private enum ConnectorStubDepthDirection {
        PositiveAlongHostNormal,
        NegativeAlongHostNormal
    }

    private readonly record struct ConnectorStubHostingPlan(SketchPlane? SketchPlaneOverride) {
        public static ConnectorStubHostingPlan Default => new(null);
    }
}
