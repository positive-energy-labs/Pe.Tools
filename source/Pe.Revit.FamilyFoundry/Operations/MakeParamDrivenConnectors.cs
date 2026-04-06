using Autodesk.Revit.DB;
using Autodesk.Revit.DB.Electrical;
using Autodesk.Revit.DB.Mechanical;
using Autodesk.Revit.DB.Plumbing;
using Pe.Revit.Extensions.FamDocument;
using Pe.Revit.FamilyFoundry.Resolution;
using Pe.Revit.FamilyFoundry.Helpers;
using Pe.Revit.FamilyFoundry.OperationSettings;
using Pe.Revit.FamilyFoundry.Snapshots;
using Serilog;
using System.Globalization;

namespace Pe.Revit.FamilyFoundry.Operations;

public sealed class MakeParamDrivenConnectors(MakeParamDrivenConnectorsSettings settings)
    : DocOperation<MakeParamDrivenConnectorsSettings>(settings) {
    private const double DefaultStubDepth = 0.5 / 12.0;
    private static readonly HashSet<string> UnassociableConnectorParameters = [
        "Category", "System Type", "Power Factor State", "Design Option", "Family Name", "Type Name"
    ];

    public override string Description => "Create authored ParamDrivenSolids connectors with stub geometry";

    public override OperationLog Execute(
        FamilyDocument doc,
        FamilyProcessingContext processingContext,
        OperationContext groupContext
    ) {
        var logs = new List<LogEntry>();
        var flippedHostPlanes = new HashSet<string>(StringComparer.Ordinal);
        logs.AddRange(FamilyTypeDrivenValueGuard.ValidateLengthDrivenParameters(
            doc,
            CollectLengthDrivenParameterNames(this.Settings),
            this.Name));
        if (logs.Any(entry => entry.Status == LogStatus.Error))
            return new OperationLog(this.Name, logs);

        foreach (var connector in this.Settings.Connectors)
            CreateConnectorUnit(doc, connector, logs, flippedHostPlanes);

        return new OperationLog(this.Name, logs);
    }

    private static void CreateConnectorUnit(
        FamilyDocument doc,
        CompiledParamDrivenConnectorSpec spec,
        List<LogEntry> logs,
        ISet<string> flippedHostPlanes
    ) {
        var key = $"Connector: {spec.Name}";
        var stubKey = $"{key} stub";
        var executableSpec = BuildExecutableStubSpec(doc.Document, spec);
        var sketchPlaneOverride = CreateStubSketchPlaneOverride(
            doc.Document,
            executableSpec,
            logs,
            stubKey,
            flippedHostPlanes);
        if (executableSpec.DepthDirection == OffsetDirection.Negative && sketchPlaneOverride == null) {
            logs.Add(new LogEntry(key).Error("Failed to resolve a connector sketch plane override for inward connector stub creation."));
            return;
        }

        var stubResult = spec.Profile == ParamDrivenConnectorProfile.Rectangular
            ? ConstrainedExtrusionFactory.CreateRectangle(doc.Document, executableSpec.RectangularStub!, logs, stubKey, sketchPlaneOverride)
            : ConstrainedExtrusionFactory.CreateCircle(
                doc.Document,
                executableSpec.RoundStub!,
                logs,
                stubKey,
                sketchPlaneOverride);
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
        logs.Add(new LogEntry(key).Success("Created hosted connector unit."));
    }

    private static CompiledParamDrivenConnectorSpec BuildExecutableStubSpec(
        Document doc,
        CompiledParamDrivenConnectorSpec spec
    ) {
        static bool TryResolveEncodedHostOffset(
            Document sourceDoc,
            CompiledParamDrivenConnectorSpec sourceSpec,
            out double hostOffset
        ) {
            hostOffset = 0.0;
            if (string.IsNullOrWhiteSpace(sourceSpec.HostFacePlaneName) ||
                !sourceSpec.HostFacePlaneName.StartsWith("__OFFSET__|", StringComparison.Ordinal)) {
                return false;
            }

            var parts = sourceSpec.HostFacePlaneName.Split('|', 4);
            if (parts.Length != 4)
                return false;

            var offsetSign = parts[2] == "-" ? -1.0 : 1.0;
            if (parts[3].StartsWith("P:", StringComparison.Ordinal)) {
                var parameterName = parts[3][2..].Trim();
                if (string.IsNullOrWhiteSpace(parameterName) ||
                    !LengthDriverSpec.FromLegacyParameter(parameterName).TryResolveCurrentValue(sourceDoc, out hostOffset)) {
                    return false;
                }

                hostOffset = offsetSign * Math.Abs(hostOffset);
                return true;
            }

            if (!parts[3].StartsWith("L:", StringComparison.Ordinal))
                return false;

            var rawLiteral = parts[3][2..].Trim();
            if (!double.TryParse(rawLiteral, NumberStyles.Float, CultureInfo.InvariantCulture, out var literalOffset))
                return false;

            hostOffset = offsetSign * Math.Abs(literalOffset);
            return true;
        }

        var resolvedDepth = ResolveCurrentDepth(doc, spec.DepthDriver);
        var hasEncodedHostOffset = TryResolveEncodedHostOffset(doc, spec, out var hostOffset);
        var (startOffset, endOffset) = ResolveStubOffsets(spec.DepthDirection, hasEncodedHostOffset, hostOffset, resolvedDepth);
        if (spec.Profile == ParamDrivenConnectorProfile.Rectangular && spec.RectangularStub != null) {
            return new CompiledParamDrivenConnectorSpec {
                Name = spec.Name,
                StubSolidName = spec.StubSolidName,
                Domain = spec.Domain,
                Profile = spec.Profile,
                HostPlaneName = spec.HostPlaneName,
                HostFacePlaneName = spec.HostFacePlaneName,
                DepthDirection = spec.DepthDirection,
                DepthDriver = spec.DepthDriver,
                RectangularStub = new ConstrainedRectangleExtrusionSpec {
                    Name = spec.RectangularStub.Name,
                    IsSolid = spec.RectangularStub.IsSolid,
                    StartOffset = startOffset,
                    EndOffset = endOffset,
                    HeightControlMode = spec.RectangularStub.HeightControlMode,
                    SketchPlaneName = spec.RectangularStub.SketchPlaneName,
                    PairAPlane1 = spec.RectangularStub.PairAPlane1,
                    PairAPlane2 = spec.RectangularStub.PairAPlane2,
                    PairAParameter = spec.RectangularStub.PairAParameter,
                    PairADriver = spec.RectangularStub.PairADriver,
                    PairBPlane1 = spec.RectangularStub.PairBPlane1,
                    PairBPlane2 = spec.RectangularStub.PairBPlane2,
                    PairBParameter = spec.RectangularStub.PairBParameter,
                    PairBDriver = spec.RectangularStub.PairBDriver,
                    HeightPlaneBottom = spec.RectangularStub.HeightPlaneBottom,
                    HeightPlaneTop = spec.RectangularStub.HeightPlaneTop,
                    HeightParameter = spec.RectangularStub.HeightParameter,
                    HeightDriver = spec.RectangularStub.HeightDriver
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
            DepthDirection = spec.DepthDirection,
            DepthDriver = spec.DepthDriver,
            RoundStub = new ConstrainedCircleExtrusionSpec {
                Name = spec.RoundStub.Name,
                IsSolid = spec.RoundStub.IsSolid,
                StartOffset = startOffset,
                EndOffset = endOffset,
                HeightControlMode = spec.RoundStub.HeightControlMode,
                SketchPlaneName = spec.RoundStub.SketchPlaneName,
                CenterPlane1 = spec.RoundStub.CenterPlane1,
                CenterPlane2 = spec.RoundStub.CenterPlane2,
                DiameterParameter = spec.RoundStub.DiameterParameter,
                DiameterDriver = spec.RoundStub.DiameterDriver,
                HeightPlaneBottom = spec.RoundStub.HeightPlaneBottom,
                HeightPlaneTop = spec.RoundStub.HeightPlaneTop,
                HeightParameter = spec.RoundStub.HeightParameter,
                HeightDriver = spec.RoundStub.HeightDriver
            },
            Bindings = spec.Bindings,
            Config = spec.Config,
            AuthoredSpec = spec.AuthoredSpec
        };
    }

    private static (double StartOffset, double EndOffset) ResolveStubOffsets(
        OffsetDirection depthDirection,
        bool hasEncodedHostOffset,
        double hostOffset,
        double resolvedDepth
    ) => (0.0, resolvedDepth);

    private static IReadOnlyList<string> CollectLengthDrivenParameterNames(
        MakeParamDrivenConnectorsSettings settings
    ) => settings.Connectors
        .SelectMany(spec => GetLengthDrivenParameterNames(spec))
        .Where(name => !string.IsNullOrWhiteSpace(name))
        .Select(name => name.Trim())
        .Distinct(StringComparer.Ordinal)
        .OrderBy(name => name, StringComparer.OrdinalIgnoreCase)
        .ToList();

    private static IEnumerable<string?> GetLengthDrivenParameterNames(
        CompiledParamDrivenConnectorSpec spec
    ) {
        yield return spec.DepthDriver.TryGetParameterName();

        if (spec.Profile == ParamDrivenConnectorProfile.Round) {
            yield return spec.RoundStub?.DiameterDriver.TryGetParameterName() ?? spec.RoundStub?.DiameterParameter;
            yield break;
        }

        yield return spec.RectangularStub?.PairADriver.TryGetParameterName() ?? spec.RectangularStub?.PairAParameter;
        yield return spec.RectangularStub?.PairBDriver.TryGetParameterName() ?? spec.RectangularStub?.PairBParameter;
        yield return spec.RectangularStub?.HeightDriver.TryGetParameterName() ?? spec.RectangularStub?.HeightParameter;
    }

    private static double ResolveCurrentDepth(Document doc, LengthDriverSpec driver) {
        if (!driver.TryResolveCurrentValue(doc, out var currentValue))
            return DefaultStubDepth;

        var magnitude = Math.Abs(currentValue);
        return magnitude > 1e-6 ? magnitude : DefaultStubDepth;
    }

    private static SketchPlane? CreateStubSketchPlaneOverride(
        Document doc,
        CompiledParamDrivenConnectorSpec spec,
        List<LogEntry> logs,
        string key,
        ISet<string> flippedHostPlanes
    ) {
        _ = flippedHostPlanes;

        var requiresFlippedNormal = spec.DepthDirection == OffsetDirection.Negative;
        var hostOffset = 0.0;
        var hasEncodedHostOffset = !string.IsNullOrWhiteSpace(spec.HostFacePlaneName) &&
                                   spec.HostFacePlaneName.StartsWith("__OFFSET__|", StringComparison.Ordinal);
        if (hasEncodedHostOffset) {
            var parts = spec.HostFacePlaneName.Split('|', 4);
            if (parts.Length != 4) {
                logs.Add(new LogEntry(key).Error($"Connector host face payload '{spec.HostFacePlaneName}' is invalid."));
                return null;
            }

            var existingFacePlaneSketch = TryResolveHostFaceSketchPlane(doc, parts[1].Trim(), requiresFlippedNormal);
            if (existingFacePlaneSketch != null) {
                logs.Add(new LogEntry(key).Success(
                    $"Resolved connector sketch plane directly from host face '{parts[1].Trim()}' with flippedNormal={requiresFlippedNormal}."));
                return existingFacePlaneSketch;
            }

            var offsetSign = parts[2] == "-" ? -1.0 : 1.0;
            if (parts[3].StartsWith("P:", StringComparison.Ordinal)) {
                var parameterName = parts[3][2..].Trim();
                if (string.IsNullOrWhiteSpace(parameterName) ||
                    !LengthDriverSpec.FromLegacyParameter(parameterName).TryResolveCurrentValue(doc, out var parameterOffset)) {
                    logs.Add(new LogEntry(key).Error(
                        $"Failed to resolve connector host offset parameter '{parameterName}'."));
                    return null;
                }

                hostOffset = offsetSign * Math.Abs(parameterOffset);
            } else if (parts[3].StartsWith("L:", StringComparison.Ordinal)) {
                var rawLiteral = parts[3][2..].Trim();
                if (!double.TryParse(rawLiteral, NumberStyles.Float, CultureInfo.InvariantCulture, out var literalOffset)) {
                    logs.Add(new LogEntry(key).Error(
                        $"Failed to parse connector host offset literal '{rawLiteral}'."));
                    return null;
                }

                hostOffset = offsetSign * Math.Abs(literalOffset);
            } else {
                logs.Add(new LogEntry(key).Error($"Connector host face payload '{spec.HostFacePlaneName}' is invalid."));
                return null;
            }
        }

        if (!requiresFlippedNormal && !hasEncodedHostOffset)
            return null;

        var sketchPlaneName = spec.RectangularStub?.SketchPlaneName ?? spec.RoundStub?.SketchPlaneName;
        if (string.IsNullOrWhiteSpace(sketchPlaneName)) {
            logs.Add(new LogEntry(key).Error("Connector stub did not define a sketch plane name."));
            return null;
        }

        if (!hasEncodedHostOffset) {
            var directionalSketchPlane = ConstrainedExtrusionFactory.ResolveDirectionalSketchPlane(
                doc,
                sketchPlaneName,
                requiresFlippedNormal);
            if (directionalSketchPlane == null)
                logs.Add(new LogEntry(key).Error($"Failed to resolve directional connector sketch plane '{sketchPlaneName}'."));

            return directionalSketchPlane;
        }

        var referencePlane = new FilteredElementCollector(doc)
            .OfClass(typeof(ReferencePlane))
            .Cast<ReferencePlane>()
            .FirstOrDefault(plane => string.Equals(plane.Name, sketchPlaneName, StringComparison.Ordinal));
        var basePlane = referencePlane != null
            ? Plane.CreateByNormalAndOrigin(referencePlane.Normal.Normalize(), (referencePlane.BubbleEnd + referencePlane.FreeEnd) * 0.5)
            : new FilteredElementCollector(doc)
                .OfClass(typeof(SketchPlane))
                .Cast<SketchPlane>()
                .Where(plane => string.Equals(plane.Name, sketchPlaneName, StringComparison.Ordinal))
                .Select(plane => plane.GetPlane())
                .FirstOrDefault();
        if (basePlane == null) {
            logs.Add(new LogEntry(key).Error($"Failed to resolve sketch plane geometry for '{sketchPlaneName}'."));
            return null;
        }

        var baseNormal = basePlane.Normal.Normalize();
        var planeOrigin = basePlane.Origin + (baseNormal * hostOffset);
        var planeNormal = requiresFlippedNormal
            ? new XYZ(-baseNormal.X, -baseNormal.Y, -baseNormal.Z)
            : baseNormal;

        SketchPlane? sketchPlane;
        try {
            sketchPlane = SketchPlane.Create(doc, Plane.CreateByNormalAndOrigin(planeNormal, planeOrigin));
        } catch (Exception ex) {
            logs.Add(new LogEntry(key).Error($"Failed to create connector sketch plane override: {ex.Message}"));
            return null;
        }

        logs.Add(new LogEntry(key).Success(
            $"Resolved connector sketch plane override '{sketchPlaneName}' with offset {hostOffset.ToString("G6", CultureInfo.InvariantCulture)} and flippedNormal={requiresFlippedNormal}."));
        return sketchPlane;
    }

    private static SketchPlane? TryResolveHostFaceSketchPlane(
        Document doc,
        string requestedPlaneName,
        bool flipNormal
    ) {
        if (string.IsNullOrWhiteSpace(requestedPlaneName))
            return null;

        var referencePlane = new FilteredElementCollector(doc)
            .OfClass(typeof(ReferencePlane))
            .Cast<ReferencePlane>()
            .FirstOrDefault(plane => string.Equals(plane.Name, requestedPlaneName, StringComparison.Ordinal));
        if (referencePlane != null) {
            if (!flipNormal) {
                try {
                    return SketchPlane.Create(doc, referencePlane.Id);
                } catch {
                    return null;
                }
            }

            var origin = (referencePlane.BubbleEnd + referencePlane.FreeEnd) * 0.5;
            var normal = referencePlane.Normal.Normalize();
            var flipped = new XYZ(-normal.X, -normal.Y, -normal.Z);
            try {
                return SketchPlane.Create(doc, Plane.CreateByNormalAndOrigin(flipped, origin));
            } catch {
                return null;
            }
        }

        var baseSketchPlane = new FilteredElementCollector(doc)
            .OfClass(typeof(SketchPlane))
            .Cast<SketchPlane>()
            .FirstOrDefault(plane => string.Equals(plane.Name, requestedPlaneName, StringComparison.Ordinal));
        if (baseSketchPlane == null)
            return null;

        if (!flipNormal)
            return baseSketchPlane;

        var basePlane = baseSketchPlane.GetPlane();
        var normalVector = basePlane.Normal.Normalize();
        var flippedNormal = new XYZ(-normalVector.X, -normalVector.Y, -normalVector.Z);
        try {
            return SketchPlane.Create(doc, Plane.CreateByNormalAndOrigin(flippedNormal, basePlane.Origin));
        } catch {
            return null;
        }
    }

    private static ConnectorElement CreateConnectorElement(
        Document doc,
        CompiledParamDrivenConnectorSpec spec,
        PlanarFace hostFace
    ) {
        if (spec.Domain == ParamDrivenConnectorDomain.Duct &&
            spec.Profile == ParamDrivenConnectorProfile.Rectangular) {
            return CreateBestRectangularDuctConnector(doc, spec, hostFace);
        }

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

    private static ConnectorElement CreateBestRectangularDuctConnector(
        Document doc,
        CompiledParamDrivenConnectorSpec spec,
        PlanarFace hostFace
    ) {
        var candidateEdges = hostFace.EdgeLoops
            .Cast<EdgeArray>()
            .SelectMany(loop => loop.Cast<Edge>())
            .ToList();

        var connector = ConnectorElement.CreateDuctConnector(
            doc,
            spec.Config.Duct!.SystemType,
            ConnectorProfileType.Rectangular,
            hostFace.Reference);

        if (TryGetExpectedRectangularConnectorSize(doc, spec, out var expectedWidth, out var expectedHeight)) {
            PrimeRectangularConnectorCandidate(connector, expectedWidth, expectedHeight);
            doc.Regenerate();
        }

        if (!AlignRectangularConnectorFrame(doc, connector, spec, hostFace.FaceNormal)) {
            var firstEdge = candidateEdges.FirstOrDefault();
            if (firstEdge != null) {
                connector.ChangeHostReference(hostFace.Reference, firstEdge);
                doc.Regenerate();
                _ = AlignRectangularConnectorFrame(doc, connector, spec, hostFace.FaceNormal);
            }
        }

        Log.Debug(
            "[MakeParamDrivenConnectors] Rectangular connector {ConnectorName} created with Width={Width}, Height={Height}, BasisX={BasisX}, BasisY={BasisY}, BasisZ={BasisZ}.",
            spec.Name,
            connector.get_Parameter(BuiltInParameter.CONNECTOR_WIDTH)?.AsDouble(),
            connector.get_Parameter(BuiltInParameter.CONNECTOR_HEIGHT)?.AsDouble(),
            connector.CoordinateSystem?.BasisX,
            connector.CoordinateSystem?.BasisY,
            connector.CoordinateSystem?.BasisZ);

        return connector;
    }

    private static void PrimeRectangularConnectorCandidate(
        ConnectorElement connector,
        double expectedWidth,
        double expectedHeight
    ) {
        _ = connector.get_Parameter(BuiltInParameter.CONNECTOR_WIDTH)?.Set(Math.Abs(expectedWidth));
        _ = connector.get_Parameter(BuiltInParameter.CONNECTOR_HEIGHT)?.Set(Math.Abs(expectedHeight));
    }

    private static bool TryGetExpectedRectangularConnectorSize(
        Document doc,
        CompiledParamDrivenConnectorSpec spec,
        out double width,
        out double height
    ) {
        width = 0.0;
        height = 0.0;
        if (spec.RectangularStub == null)
            return false;

        if (!spec.RectangularStub.PairADriver.TryResolveCurrentValue(doc, out width) &&
            !LengthDriverSpec.FromLegacyParameter(spec.RectangularStub.PairAParameter).TryResolveCurrentValue(doc, out width)) {
            return false;
        }

        if (!spec.RectangularStub.PairBDriver.TryResolveCurrentValue(doc, out height) &&
            !LengthDriverSpec.FromLegacyParameter(spec.RectangularStub.PairBParameter).TryResolveCurrentValue(doc, out height)) {
            return false;
        }

        width = Math.Abs(width);
        height = Math.Abs(height);
        return width > 1e-6 && height > 1e-6;
    }

    private static bool AlignRectangularConnectorFrame(
        Document doc,
        ConnectorElement connector,
        CompiledParamDrivenConnectorSpec spec,
        XYZ hostFaceNormal
    ) {
        if (spec.RectangularStub == null)
            return false;

        var expectedFaceNormal = NormalizeOrThrow(hostFaceNormal);
        if (!RawConnectorUnitInference.TryResolveRectangularConnectorFrame(
                doc,
                spec.RectangularStub.PairAPlane1,
                spec.RectangularStub.PairAPlane2,
                spec.RectangularStub.PairBPlane1,
                spec.RectangularStub.PairBPlane2,
                expectedFaceNormal,
                out var expectedWidthAxis,
                out var expectedLengthAxis)) {
            return false;
        }

        if (!RawConnectorUnitInference.TryGetRectangularConnectorAxes(connector, out var actualWidthAxis, out var actualLengthAxis, out var actualFaceNormal))
            return false;

        if (actualFaceNormal.DotProduct(expectedFaceNormal) < 0.0) {
            connector.FlipDirection();
            doc.Regenerate();
            if (!RawConnectorUnitInference.TryGetRectangularConnectorAxes(connector, out actualWidthAxis, out actualLengthAxis, out actualFaceNormal))
                return false;
        }

        var rotationAxis = NormalizeOrThrow(actualFaceNormal);
        var rotationAngle = Enumerable.Range(0, 4)
            .Select(index => index * (Math.PI / 2.0))
            .OrderBy(angle => ScoreRectangularConnectorFrame(
                actualWidthAxis,
                actualLengthAxis,
                rotationAxis,
                angle,
                expectedWidthAxis,
                expectedLengthAxis))
            .First();
        if (Math.Abs(rotationAngle) <= 1e-9)
            return true;

        ElementTransformUtils.RotateElement(
            doc,
            connector.Id,
            Line.CreateBound(connector.Origin, connector.Origin + rotationAxis),
            rotationAngle);
        doc.Regenerate();
        return true;
    }

    private static double ScoreRectangularConnectorFrame(
        XYZ actualWidthAxis,
        XYZ actualLengthAxis,
        XYZ rotationAxis,
        double angle,
        XYZ expectedWidthAxis,
        XYZ expectedLengthAxis
    ) {
        var rotation = Transform.CreateRotationAtPoint(rotationAxis, angle, XYZ.Zero);
        var rotatedWidth = NormalizeOrThrow(rotation.OfVector(actualWidthAxis));
        var rotatedLength = NormalizeOrThrow(rotation.OfVector(actualLengthAxis));
        return RawConnectorUnitInference.ComputeSignedVectorMisalignment(rotatedWidth, expectedWidthAxis) +
               RawConnectorUnitInference.ComputeSignedVectorMisalignment(rotatedLength, expectedLengthAxis);
    }

    private static XYZ NormalizeOrThrow(XYZ vector) {
        if (vector.GetLength() <= 1e-9)
            throw new InvalidOperationException("Expected a non-zero vector.");

        return vector.Normalize();
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
            if (spec.Domain == ParamDrivenConnectorDomain.Duct && spec.Config.Duct != null) {
                _ = connector.get_Parameter(BuiltInParameter.RBS_DUCT_FLOW_CONFIGURATION_PARAM)
                    ?.Set((int)spec.Config.Duct.FlowConfiguration);
                _ = connector.get_Parameter(BuiltInParameter.RBS_DUCT_FLOW_DIRECTION_PARAM)
                    ?.Set((int)spec.Config.Duct.FlowDirection);
                _ = connector.get_Parameter(BuiltInParameter.RBS_DUCT_FITTING_LOSS_METHOD_PARAM)
                    ?.Set((int)spec.Config.Duct.LossMethod);
                logs.Add(new LogEntry(key).Success("Applied duct connector configuration."));
                return;
            }

            if (spec.Domain != ParamDrivenConnectorDomain.Pipe || spec.Config.Pipe == null)
                return;

            _ = connector.get_Parameter(BuiltInParameter.RBS_PIPE_FLOW_DIRECTION_PARAM)
                ?.Set((int)spec.Config.Pipe.FlowDirection);
            logs.Add(new LogEntry(key).Success("Applied pipe connector configuration."));
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
        var depthParameterName = spec.DepthDriver.TryGetParameterName();
        if (string.IsNullOrWhiteSpace(depthParameterName))
            return;

        _ = AssociateBuiltInParameter(
            doc,
            extrusion.get_Parameter(BuiltInParameter.EXTRUSION_END_PARAM),
            depthParameterName,
            key,
            "stub end offset",
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
            var diameterParameterName = spec.RoundStub.DiameterDriver.TryGetParameterName() ?? spec.RoundStub.DiameterParameter;
            if (string.IsNullOrWhiteSpace(diameterParameterName))
                return;

            _ = AssociateBuiltInParameter(
                doc,
                connector.get_Parameter(BuiltInParameter.CONNECTOR_DIAMETER),
                diameterParameterName,
                key,
                "connector diameter",
                logs,
                required: true);
            return;
        }

        if (spec.RectangularStub == null)
            return;

        var widthParameterName = spec.RectangularStub.PairADriver.TryGetParameterName() ?? spec.RectangularStub.PairAParameter;
        var heightParameterName = spec.RectangularStub.PairBDriver.TryGetParameterName() ?? spec.RectangularStub.PairBParameter;

        if (!string.IsNullOrWhiteSpace(widthParameterName)) {
            _ = AssociateBuiltInParameter(
                doc,
                connector.get_Parameter(BuiltInParameter.CONNECTOR_WIDTH),
                widthParameterName,
                key,
                "connector width",
                logs,
                required: true);
        }

        if (!string.IsNullOrWhiteSpace(heightParameterName)) {
            _ = AssociateBuiltInParameter(
                doc,
                connector.get_Parameter(BuiltInParameter.CONNECTOR_HEIGHT),
                heightParameterName,
                key,
                "connector height",
                logs,
                required: true);
        }
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

}
