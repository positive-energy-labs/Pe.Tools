using Autodesk.Revit.DB.Electrical;
using Autodesk.Revit.DB.Mechanical;
using Autodesk.Revit.DB.Plumbing;
using Pe.Revit.FamilyFoundry.Helpers;

namespace Pe.Revit.FamilyFoundry.Snapshots;

public partial class ExtrusionSectionCollector {
    private const double ConnectorPlaneTolerance = 1e-3;

    private static void AddInferredRawConnectors(Document doc, AuthoredParamDrivenSolidsSettings authored) {
        if (doc == null || !doc.IsFamilyDocument)
            return;

        var anchors = ResolveCanonicalAnchors(doc);
        if (anchors.Count < 3)
            return;

        var connectorNames = authored.Connectors
            .Where(spec => !string.IsNullOrWhiteSpace(spec.Name))
            .Select(spec => spec.Name.Trim())
            .ToHashSet(StringComparer.OrdinalIgnoreCase);
        var planeNames = CollectPublishedPlaneNames(authored);
        var stubMatches = RawConnectorUnitInference.MatchOwnedStubs(doc);
        var referencePlanes = new FilteredElementCollector(doc)
            .OfClass(typeof(ReferencePlane))
            .Cast<ReferencePlane>()
            .Where(plane => !string.IsNullOrWhiteSpace(plane.Name))
            .ToList();
        var rawConnectors = new FilteredElementCollector(doc)
            .OfClass(typeof(ConnectorElement))
            .Cast<ConnectorElement>()
            .ToList();
        if (rawConnectors.Count == 0 || authored.Connectors.Count >= rawConnectors.Count)
            return;

        foreach (var rawConnector in rawConnectors) {
            stubMatches.TryGetValue(rawConnector.Id, out var stubMatch);
            var inferred = TryInferRawConnector(doc, rawConnector, stubMatch, referencePlanes, anchors, authored.Planes, planeNames, connectorNames);
            if (inferred == null)
                continue;

            if (authored.Connectors.Any(existing => AreEquivalentConnectors(existing, inferred)))
                continue;

            authored.Connectors.Add(inferred);
        }
    }

    private static bool AreEquivalentConnectors(AuthoredConnectorSpec left, AuthoredConnectorSpec right) {
        if (left.Domain != right.Domain ||
            !string.Equals(left.Face, right.Face, StringComparison.Ordinal) ||
            !string.Equals(left.Depth.By, right.Depth.By, StringComparison.Ordinal) ||
            !string.Equals(left.Depth.Dir, right.Depth.Dir, StringComparison.OrdinalIgnoreCase)) {
            return false;
        }

        if (left.Round != null && right.Round != null) {
            return HaveSamePlaneRefs(left.Round.Center, right.Round.Center) &&
                   string.Equals(left.Round.Diameter.By, right.Round.Diameter.By, StringComparison.Ordinal);
        }

        if (left.Rect != null && right.Rect != null) {
            return HaveSamePlaneRefs(left.Rect.Center, right.Rect.Center) &&
                   string.Equals(left.Rect.Width.About, right.Rect.Width.About, StringComparison.Ordinal) &&
                   string.Equals(left.Rect.Width.By, right.Rect.Width.By, StringComparison.Ordinal) &&
                   string.Equals(left.Rect.Length.About, right.Rect.Length.About, StringComparison.Ordinal) &&
                   string.Equals(left.Rect.Length.By, right.Rect.Length.By, StringComparison.Ordinal);
        }

        return left.Round == null && right.Round == null && left.Rect == null && right.Rect == null;
    }

    private static bool HaveSamePlaneRefs(IReadOnlyList<string> left, IReadOnlyList<string> right) =>
        left.Count == right.Count &&
        left.OrderBy(value => value, StringComparer.Ordinal).SequenceEqual(
            right.OrderBy(value => value, StringComparer.Ordinal),
            StringComparer.Ordinal);

    private static AuthoredConnectorSpec? TryInferRawConnector(
        Document doc,
        ConnectorElement connector,
        RawConnectorStubMatch? stubMatch,
        IReadOnlyList<ReferencePlane> referencePlanes,
        IReadOnlyDictionary<DominantAxis, CanonicalAnchorPlane> anchors,
        IDictionary<string, AuthoredPlaneSpec> planes,
        ISet<string> planeNames,
        ISet<string> connectorNames
    ) {
        if (!TryMapDomain(connector.Domain, out var domain))
            return null;

        var coordinateSystem = connector.CoordinateSystem;
        if (coordinateSystem == null)
            return null;

        var normal = coordinateSystem.BasisZ.Normalize();
        if (!RawConnectorUnitInference.TryGetAxis(normal, out var faceAxis))
            return null;

        var centerAxes = RawConnectorUnitInference.GetPerpendicularAxes(faceAxis);
        if (!anchors.ContainsKey(faceAxis) ||
            !anchors.ContainsKey(centerAxes[0]) ||
            !anchors.ContainsKey(centerAxes[1])) {
            return null;
        }

        var hostNormal = anchors[faceAxis].Plane.Normal.Normalize();
        var name = CreateUniqueName(GetBaseConnectorName(connector, domain), connectorNames);
        var facePoint = connector.Origin;
        var depthBy = DefaultInferredConnectorDepth;
        var depthDir = normal.DotProduct(hostNormal) >= 0.0 ? "out" : "in";
        if (stubMatch != null &&
            TryResolveStubPlacement(doc, connector, stubMatch, anchors[faceAxis].Plane, faceAxis, out var resolvedFacePoint, out var resolvedDepthBy, out var resolvedDepthDir)) {
            facePoint = resolvedFacePoint;
            depthBy = resolvedDepthBy;
            depthDir = resolvedDepthDir;
        }

        var faceRef = ResolvePointPlaneRef($"{name} Face", facePoint, faceAxis, false, referencePlanes, anchors, planes, planeNames);
        var center1Ref = ResolvePointPlaneRef($"{name} Center 1", connector.Origin, centerAxes[0], true, referencePlanes, anchors, planes, planeNames);
        var center2Ref = ResolvePointPlaneRef($"{name} Center 2", connector.Origin, centerAxes[1], true, referencePlanes, anchors, planes, planeNames);
        if (string.IsNullOrWhiteSpace(faceRef) ||
            string.IsNullOrWhiteSpace(center1Ref) ||
            string.IsNullOrWhiteSpace(center2Ref)) {
            return null;
        }

        var config = BuildConfig(connector, domain);

        if (connector.Shape == ConnectorProfileType.Round) {
            if (!TryGetRoundDiameter(connector, out var diameter))
                return null;

            return new AuthoredConnectorSpec {
                Name = name,
                Domain = domain,
                Face = faceRef,
                Depth = new AuthoredDepthSpec { By = depthBy, Dir = depthDir },
                Round = new AuthoredRoundConnectorGeometrySpec {
                    Center = [center1Ref, center2Ref],
                    Diameter = new AuthoredMeasureSpec {
                        By = GetAssociatedOrLiteralMeasure(doc, connector, BuiltInParameter.CONNECTOR_DIAMETER, diameter)
                    }
                },
                Config = config
            };
        }

        if (connector.Shape != ConnectorProfileType.Rectangular)
            return null;

        var widthParameter = connector.get_Parameter(BuiltInParameter.CONNECTOR_WIDTH);
        var lengthParameter = connector.get_Parameter(BuiltInParameter.CONNECTOR_HEIGHT);
        var hasWidthBinding = widthParameter != null &&
                              doc.IsFamilyDocument &&
                              doc.FamilyManager.GetAssociatedFamilyParameter(widthParameter) != null;
        var hasLengthBinding = lengthParameter != null &&
                               doc.IsFamilyDocument &&
                               doc.FamilyManager.GetAssociatedFamilyParameter(lengthParameter) != null;
        if (!TryGetRectangularSize(connector, out var width, out var length)) {
            if (!hasWidthBinding || !hasLengthBinding)
                return null;

            width = stubMatch?.PrimaryExtent ?? 1.0;
            length = stubMatch?.SecondaryExtent ?? 1.0;
        }

        var widthAboutRef = center1Ref;
        var lengthAboutRef = center2Ref;
        if (RawConnectorUnitInference.TryConnectorWidthUsesFirstAxis(connector, centerAxes[0], centerAxes[1], out var widthUsesCenter1Axis) &&
            !widthUsesCenter1Axis) {
            widthAboutRef = center2Ref;
            lengthAboutRef = center1Ref;
        }

        return new AuthoredConnectorSpec {
            Name = name,
            Domain = domain,
            Face = faceRef,
            Depth = new AuthoredDepthSpec { By = depthBy, Dir = depthDir },
            Rect = new AuthoredRectConnectorGeometrySpec {
                Center = [center1Ref, center2Ref],
                Width = new AuthoredCenterMeasureSpec {
                    About = widthAboutRef,
                    By = GetAssociatedOrLiteralMeasure(doc, connector, BuiltInParameter.CONNECTOR_WIDTH, width)
                },
                Length = new AuthoredCenterMeasureSpec {
                    About = lengthAboutRef,
                    By = GetAssociatedOrLiteralMeasure(doc, connector, BuiltInParameter.CONNECTOR_HEIGHT, length)
                }
            },
            Config = config
        };
    }

    private static string GetAssociatedOrLiteralMeasure(
        Document doc,
        Element element,
        BuiltInParameter builtInParameter,
        double literalValue
    ) {
        var parameter = element.get_Parameter(builtInParameter);
        if (parameter != null &&
            doc.IsFamilyDocument &&
            doc.FamilyManager.GetAssociatedFamilyParameter(parameter)?.Definition?.Name is { Length: > 0 } familyParameterName) {
            return ToAuthoredLength(familyParameterName);
        }

        return ToAuthoredLiteral(literalValue);
    }

    private static AuthoredConnectorConfigSpec BuildConfig(
        ConnectorElement connector,
        ParamDrivenConnectorDomain domain
    ) {
        if (domain == ParamDrivenConnectorDomain.Duct) {
            return new AuthoredConnectorConfigSpec {
                SystemType = connector.SystemClassification.ToString(),
                FlowConfiguration = ((DuctFlowConfigurationType)(connector.get_Parameter(BuiltInParameter.RBS_DUCT_FLOW_CONFIGURATION_PARAM)?.AsInteger()
                                                                     ?? (int)DuctFlowConfigurationType.Preset)).ToString(),
                FlowDirection = ((FlowDirectionType)(connector.get_Parameter(BuiltInParameter.RBS_DUCT_FLOW_DIRECTION_PARAM)?.AsInteger()
                                                          ?? (int)FlowDirectionType.Bidirectional)).ToString(),
                LossMethod = ((DuctLossMethodType)(connector.get_Parameter(BuiltInParameter.RBS_DUCT_FITTING_LOSS_METHOD_PARAM)?.AsInteger()
                                                       ?? (int)DuctLossMethodType.NotDefined)).ToString()
            };
        }

        if (domain == ParamDrivenConnectorDomain.Pipe) {
            return new AuthoredConnectorConfigSpec {
                SystemType = connector.SystemClassification.ToString(),
                FlowDirection = ((FlowDirectionType)(connector.get_Parameter(BuiltInParameter.RBS_PIPE_FLOW_DIRECTION_PARAM)?.AsInteger()
                                                          ?? (int)FlowDirectionType.Bidirectional)).ToString()
            };
        }

        return new AuthoredConnectorConfigSpec {
            SystemType = ElectricalSystemType.PowerBalanced.ToString()
        };
    }

    private static string GetBaseConnectorName(ConnectorElement connector, ParamDrivenConnectorDomain domain) {
        var rawName = connector.Name?.Trim();
        if (!string.IsNullOrWhiteSpace(rawName))
            return rawName;

        return domain switch {
            ParamDrivenConnectorDomain.Duct => "Duct Connector",
            ParamDrivenConnectorDomain.Pipe => "Pipe Connector",
            ParamDrivenConnectorDomain.Electrical => "Electrical Connector",
            _ => "Connector"
        };
    }

    private static string ResolvePointPlaneRef(
        string preferredName,
        XYZ point,
        DominantAxis axis,
        bool preferCenterPlanes,
        IReadOnlyList<ReferencePlane> referencePlanes,
        IReadOnlyDictionary<DominantAxis, CanonicalAnchorPlane> anchors,
        IDictionary<string, AuthoredPlaneSpec> planes,
        ISet<string> planeNames
    ) {
        if (!anchors.TryGetValue(axis, out var anchor))
            return string.Empty;

        var exactMatch = referencePlanes
            .Where(plane => RawConnectorUnitInference.TryGetAxis(plane.Normal, out var planeAxis) &&
                            planeAxis == axis &&
                            Math.Abs(SignedDistanceToPlaneAlongNormal(point, plane.BubbleEnd, plane.Normal.Normalize())) <= ConnectorPlaneTolerance)
            .OrderBy(plane => RankConnectorPlaneName(plane.Name, preferCenterPlanes))
            .ThenBy(plane => plane.Name, StringComparer.OrdinalIgnoreCase)
            .FirstOrDefault();
        if (exactMatch != null) {
            if (TryResolvePublishedPlaneRef(exactMatch.Name, planeNames, out var publishedRef))
                return publishedRef;

            var exactName = IsLowValuePlaneName(exactMatch.Name) ? preferredName : exactMatch.Name.Trim();
            return GetOrCreateAuthoredPlaneRef(exactName, point, anchor, planes, planeNames);
        }

        return GetOrCreateAuthoredPlaneRef(preferredName, point, anchor, planes, planeNames);
    }

    private static bool TryResolvePublishedPlaneRef(
        string? planeName,
        ISet<string> planeNames,
        out string planeRef
    ) {
        planeRef = string.Empty;
        var normalized = planeName?.Trim();
        if (string.IsNullOrWhiteSpace(normalized))
            return false;

        if (BuiltInPlaneRefs.TryGetValue(normalized, out planeRef))
            return true;

        if (!planeNames.Contains(normalized))
            return false;

        planeRef = $"plane:{normalized}";
        return true;
    }

    private static string GetOrCreateAuthoredPlaneRef(
        string preferredName,
        XYZ point,
        CanonicalAnchorPlane anchor,
        IDictionary<string, AuthoredPlaneSpec> planes,
        ISet<string> planeNames
    ) {
        var signedDistance = SignedDistanceToPlane(point, anchor.Plane);
        if (Math.Abs(signedDistance) <= AuthoredOffsetTolerance)
            return anchor.AuthoredRef;

        var name = CreateUniqueName(preferredName, planeNames);
        planes[name] = new AuthoredPlaneSpec {
            From = anchor.AuthoredRef,
            By = ToAuthoredLiteral(Math.Abs(signedDistance)),
            Dir = signedDistance >= 0.0 ? "out" : "in"
        };
        return $"plane:{name}";
    }

    private static bool TryMapDomain(Domain domain, out ParamDrivenConnectorDomain result) {
        result = domain switch {
            Domain.DomainHvac => ParamDrivenConnectorDomain.Duct,
            Domain.DomainPiping => ParamDrivenConnectorDomain.Pipe,
            Domain.DomainElectrical => ParamDrivenConnectorDomain.Electrical,
            _ => default
        };

        return domain is Domain.DomainHvac or Domain.DomainPiping or Domain.DomainElectrical;
    }

    private static bool TryGetRoundDiameter(ConnectorElement connector, out double diameter) {
        diameter = connector.get_Parameter(BuiltInParameter.CONNECTOR_DIAMETER)?.AsDouble() ?? 0.0;
        if (diameter > AuthoredOffsetTolerance)
            return true;

        var radius = connector.get_Parameter(BuiltInParameter.CONNECTOR_RADIUS)?.AsDouble() ?? 0.0;
        if (radius <= AuthoredOffsetTolerance)
            return false;

        diameter = radius * 2.0;
        return true;
    }

    private static bool TryGetRectangularSize(
        ConnectorElement connector,
        out double width,
        out double length
    ) {
        width = connector.get_Parameter(BuiltInParameter.CONNECTOR_WIDTH)?.AsDouble() ?? 0.0;
        length = connector.get_Parameter(BuiltInParameter.CONNECTOR_HEIGHT)?.AsDouble() ?? 0.0;
        return width > AuthoredOffsetTolerance && length > AuthoredOffsetTolerance;
    }

    private static bool TryResolveStubPlacement(
        Document doc,
        ConnectorElement connector,
        RawConnectorStubMatch stubMatch,
        ReferencePlane anchorPlane,
        DominantAxis faceAxis,
        out XYZ facePoint,
        out string depthBy,
        out string depthDir
    ) {
        facePoint = connector.Origin;
        depthBy = DefaultInferredConnectorDepth;
        depthDir = "out";

        var boundingBox = stubMatch.Extrusion.get_BoundingBox(null);
        if (boundingBox == null)
            return false;

        var minCoord = GetAxisCoordinate(boundingBox.Min, faceAxis);
        var maxCoord = GetAxisCoordinate(boundingBox.Max, faceAxis);
        var terminalCoord = GetAxisCoordinate(connector.Origin, faceAxis);
        var terminalUsesMin = Math.Abs(terminalCoord - minCoord) <= Math.Abs(terminalCoord - maxCoord);
        var baseCoord = terminalUsesMin ? maxCoord : minCoord;
        var resolvedTerminalCoord = terminalUsesMin ? minCoord : maxCoord;
        var depthMagnitude = Math.Abs(maxCoord - minCoord);
        if (depthMagnitude <= AuthoredOffsetTolerance)
            return false;

        facePoint = ReplaceAxisCoordinate(connector.Origin, faceAxis, baseCoord);
        var baseSigned = SignedDistanceToPlane(facePoint, anchorPlane);
        var terminalSigned = SignedDistanceToPlane(ReplaceAxisCoordinate(connector.Origin, faceAxis, resolvedTerminalCoord), anchorPlane);
        depthDir = terminalSigned >= baseSigned ? "out" : "in";
        depthBy = Math.Abs(baseSigned) <= AuthoredOffsetTolerance
            ? GetAssociatedOrLiteralMeasure(doc, stubMatch.Extrusion, BuiltInParameter.EXTRUSION_END_PARAM, depthMagnitude)
            : ToAuthoredLiteral(depthMagnitude);
        return true;
    }

    private static XYZ ReplaceAxisCoordinate(XYZ point, DominantAxis axis, double value) =>
        axis switch {
            DominantAxis.X => new XYZ(value, point.Y, point.Z),
            DominantAxis.Y => new XYZ(point.X, value, point.Z),
            DominantAxis.Z => new XYZ(point.X, point.Y, value),
            _ => point
        };

    private static double GetAxisCoordinate(XYZ point, DominantAxis axis) =>
        axis switch {
            DominantAxis.X => point.X,
            DominantAxis.Y => point.Y,
            DominantAxis.Z => point.Z,
            _ => 0.0
        };

    private static IReadOnlyDictionary<DominantAxis, CanonicalAnchorPlane> ResolveCanonicalAnchors(Document doc) {
        var referencePlanes = new FilteredElementCollector(doc)
            .OfClass(typeof(ReferencePlane))
            .Cast<ReferencePlane>()
            .Where(plane => !string.IsNullOrWhiteSpace(plane.Name))
            .ToList();
        var anchors = new Dictionary<DominantAxis, CanonicalAnchorPlane>();

        var centerLr = ResolveNamedReferencePlane(referencePlanes, ["Center (Left/Right)", "CenterLR"]);
        if (centerLr != null)
            anchors[DominantAxis.X] = new CanonicalAnchorPlane("@CenterLR", centerLr);

        var centerFb = ResolveNamedReferencePlane(referencePlanes, ["Center (Front/Back)", "CenterFB"]);
        if (centerFb != null)
            anchors[DominantAxis.Y] = new CanonicalAnchorPlane("@CenterFB", centerFb);

        var bottom = ResolveNamedReferencePlane(referencePlanes, [
            "Reference Plane",
            "Ref. Level",
            "Reference Level",
            "Level",
            "Lower Ref. Level",
            "Lower Reference Level"
        ]);
        if (bottom != null)
            anchors[DominantAxis.Z] = new CanonicalAnchorPlane("@Bottom", bottom);

        return anchors;
    }

    private static ReferencePlane? ResolveNamedReferencePlane(
        IReadOnlyList<ReferencePlane> planes,
        IReadOnlyList<string> candidateNames
    ) {
        foreach (var candidateName in candidateNames) {
            var match = planes.FirstOrDefault(plane =>
                string.Equals(plane.Name, candidateName, StringComparison.OrdinalIgnoreCase));
            if (match != null)
                return match;
        }

        return null;
    }

    private static int RankConnectorPlaneName(string planeName, bool preferCenterPlanes) {
        var isCenterLike = planeName.Contains("Center", StringComparison.OrdinalIgnoreCase) ||
                           planeName.Contains("Elevation", StringComparison.OrdinalIgnoreCase);
        if (preferCenterPlanes)
            return isCenterLike ? 0 : 1;

        return isCenterLike ? 1 : 0;
    }

    private static string CreateUniqueName(string preferredName, ISet<string> existingNames) {
        var trimmed = string.IsNullOrWhiteSpace(preferredName) ? "Connector" : preferredName.Trim();
        if (existingNames.Add(trimmed))
            return trimmed;

        for (var suffix = 2; suffix < 1000; suffix++) {
            var candidate = $"{trimmed} {suffix}";
            if (existingNames.Add(candidate))
                return candidate;
        }

        return trimmed;
    }

    private static double SignedDistanceToPlane(XYZ point, ReferencePlane plane) =>
        (point - plane.BubbleEnd).DotProduct(plane.Normal.Normalize());

    private sealed record CanonicalAnchorPlane(string AuthoredRef, ReferencePlane Plane);
}
