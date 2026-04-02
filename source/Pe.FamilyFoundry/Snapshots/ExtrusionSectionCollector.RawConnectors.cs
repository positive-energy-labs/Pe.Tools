using Autodesk.Revit.DB.Electrical;
using Autodesk.Revit.DB.Mechanical;
using Autodesk.Revit.DB.Plumbing;
using Pe.FamilyFoundry.Helpers;
using Serilog;

namespace Pe.FamilyFoundry.Snapshots;

public partial class ExtrusionSectionCollector {
    private const double ConnectorPlaneTolerance = 1e-3;

    private static void AddRawSemanticConnectors(
        Document doc,
        ParamDrivenSolidsSnapshot semanticSnapshot,
        SemanticPlaneRegistry planeRegistry
    ) {
        var referencePlanes = new FilteredElementCollector(doc)
            .OfClass(typeof(ReferencePlane))
            .Cast<ReferencePlane>()
            .Where(plane => !string.IsNullOrWhiteSpace(plane.Name))
            .ToList();
        var stubMatches = RawConnectorUnitInference.MatchOwnedStubs(doc);
        var connectorNames = semanticSnapshot.Connectors
            .Where(spec => !string.IsNullOrWhiteSpace(spec.Name))
            .Select(spec => spec.Name.Trim())
            .ToHashSet(StringComparer.OrdinalIgnoreCase);

        foreach (var connector in new FilteredElementCollector(doc)
                     .OfClass(typeof(ConnectorElement))
                     .Cast<ConnectorElement>()) {
            stubMatches.TryGetValue(connector.Id, out var stubMatch);
            var semantic = TryBuildSemanticRawConnector(doc, connector, stubMatch, planeRegistry, referencePlanes, connectorNames);
            if (semantic == null)
                continue;

            semanticSnapshot.Connectors.Add(semantic);
            if (!string.IsNullOrWhiteSpace(semantic.Name))
                _ = connectorNames.Add(semantic.Name.Trim());
        }
    }

    private static ParamDrivenConnectorSpec? TryBuildSemanticRawConnector(
        Document doc,
        ConnectorElement connector,
        RawConnectorStubMatch? stubMatch,
        SemanticPlaneRegistry planeRegistry,
        IReadOnlyList<ReferencePlane> referencePlanes,
        ISet<string> connectorNames
    ) {
        if (!TryMapConnectorDomain(connector.Domain, out var domain)) {
            Log.Debug(
                "[ExtrusionSectionCollector] Skipping raw connector {ConnectorName} ({ConnectorId}) because domain {Domain} is unsupported.",
                connector.Name,
                connector.Id.Value(),
                connector.Domain);
            return null;
        }

        var coordinateSystem = connector.CoordinateSystem;
        if (coordinateSystem == null || !RawConnectorUnitInference.TryGetAxis(coordinateSystem.BasisZ.Normalize(), out var faceAxis)) {
            Log.Debug(
                "[ExtrusionSectionCollector] Skipping raw connector {ConnectorName} ({ConnectorId}) because the coordinate system/face axis could not be resolved.",
                connector.Name,
                connector.Id.Value());
            return null;
        }

        var centerAxes = RawConnectorUnitInference.GetPerpendicularAxes(faceAxis);
        if (centerAxes.Length != 2) {
            Log.Debug(
                "[ExtrusionSectionCollector] Skipping raw connector {ConnectorName} ({ConnectorId}) because only {AxisCount} center axes were found.",
                connector.Name,
                connector.Id.Value(),
                centerAxes.Length);
            return null;
        }

        var name = CreateUniqueConnectorName(GetSemanticConnectorBaseName(connector, stubMatch, domain), connectorNames);
        var facePoint = stubMatch == null || !TryResolveSemanticStubFacePoint(connector, stubMatch, faceAxis, out var resolvedFacePoint)
            ? connector.Origin
            : resolvedFacePoint;
        var faceTarget = ResolveExactConnectorPlaneTarget(facePoint, faceAxis, false, referencePlanes, planeRegistry);
        if (IsEmptyAnchor(faceTarget) &&
            TryResolveStubSketchPlaneTarget(stubMatch, planeRegistry, out var sketchPlaneTarget)) {
            faceTarget = sketchPlaneTarget;
        }
        var centerTarget1 = ResolveExactConnectorPlaneTarget(connector.Origin, centerAxes[0], true, referencePlanes, planeRegistry);
        var centerTarget2 = ResolveExactConnectorPlaneTarget(connector.Origin, centerAxes[1], true, referencePlanes, planeRegistry);
        if (IsEmptyAnchor(faceTarget) || IsEmptyAnchor(centerTarget1) || IsEmptyAnchor(centerTarget2)) {
            Log.Debug(
                "[ExtrusionSectionCollector] Skipping raw connector {ConnectorName} ({ConnectorId}) because plane matching failed. Face: {HasFace}, Center1: {HasCenter1}, Center2: {HasCenter2}, Origin: {Origin}.",
                connector.Name,
                connector.Id.Value(),
                !IsEmptyAnchor(faceTarget),
                !IsEmptyAnchor(centerTarget1),
                !IsEmptyAnchor(centerTarget2),
                connector.Origin);
            return null;
        }

        var depthDirection = GetAxisCoordinate(coordinateSystem.BasisZ.Normalize(), faceAxis) < 0.0
            ? OffsetDirection.Negative
            : OffsetDirection.Positive;
        var depthParameterName = stubMatch?.Extrusion == null
            ? string.Empty
            : GetAssociatedFamilyParameterName(doc, stubMatch.Extrusion, BuiltInParameter.EXTRUSION_END_PARAM);

        if (connector.Shape == ConnectorProfileType.Round)
            return TryBuildSemanticRoundConnector(doc, connector, stubMatch, domain, name, faceTarget, centerTarget1, centerTarget2, depthDirection, depthParameterName);

        if (connector.Shape != ConnectorProfileType.Rectangular ||
            !TryGetConnectorRectangleParameters(doc, connector, out var widthParameterName, out var lengthParameterName)) {
            Log.Debug(
                "[ExtrusionSectionCollector] Skipping raw rectangular connector {ConnectorName} ({ConnectorId}) because width/height parameter associations were unavailable.",
                connector.Name,
                connector.Id.Value());
            return null;
        }

        var widthTarget = centerTarget1;
        var lengthTarget = centerTarget2;
        if (RawConnectorUnitInference.TryConnectorWidthUsesFirstAxis(connector, centerAxes[0], centerAxes[1], out var widthUsesCenter1Axis) &&
            !widthUsesCenter1Axis) {
            widthTarget = centerTarget2;
            lengthTarget = centerTarget1;
        }

        return new ParamDrivenConnectorSpec {
            Name = name,
            Domain = domain,
            Placement = new ConnectorPlacementSpec {
                Face = faceTarget,
                Depth = new AxisConstraintSpec {
                    Mode = AxisConstraintMode.Offset,
                    Parameter = depthParameterName,
                    Anchor = faceTarget,
                    Direction = depthDirection,
                    PlaneNameBase = $"{name} Face",
                    Strength = RpStrength.StrongRef,
                    Inference = new InferenceInfo { Status = InferenceStatus.Exact }
                }
            },
            Geometry = new ConnectorStubGeometrySpec {
                IsSolid = stubMatch?.Extrusion.IsSolid ?? true,
                Rectangular = new RectangularConnectorGeometrySpec {
                    Width = new AxisConstraintSpec {
                        Mode = AxisConstraintMode.Mirror,
                        Parameter = widthParameterName,
                        CenterAnchor = widthTarget,
                        PlaneNameBase = $"{name} Width",
                        Strength = RpStrength.StrongRef,
                        Inference = new InferenceInfo { Status = InferenceStatus.Exact }
                    },
                    Length = new AxisConstraintSpec {
                        Mode = AxisConstraintMode.Mirror,
                        Parameter = lengthParameterName,
                        CenterAnchor = lengthTarget,
                        PlaneNameBase = $"{name} Length",
                        Strength = RpStrength.StrongRef,
                        Inference = new InferenceInfo { Status = InferenceStatus.Exact }
                    }
                }
            },
            Config = BuildSemanticConnectorConfig(connector, domain),
            Inference = new InferenceInfo { Status = InferenceStatus.Exact }
        };
    }

    private static ParamDrivenConnectorSpec? TryBuildSemanticRoundConnector(
        Document doc,
        ConnectorElement connector,
        RawConnectorStubMatch? stubMatch,
        ParamDrivenConnectorDomain domain,
        string name,
        PlaneTargetSpec faceTarget,
        PlaneTargetSpec centerTarget1,
        PlaneTargetSpec centerTarget2,
        OffsetDirection depthDirection,
        string depthParameterName
    ) {
        _ = TryGetConnectorDiameterParameter(doc, connector, out var diameterParameterName);
        var inference = string.IsNullOrWhiteSpace(diameterParameterName)
            ? new InferenceInfo {
                Status = InferenceStatus.Inferred,
                Warnings = ["Round connector diameter association was unavailable during snapshot collection."]
            }
            : new InferenceInfo { Status = InferenceStatus.Exact };

        return new ParamDrivenConnectorSpec {
            Name = name,
            Domain = domain,
            Placement = new ConnectorPlacementSpec {
                Face = faceTarget,
                Depth = new AxisConstraintSpec {
                    Mode = AxisConstraintMode.Offset,
                    Parameter = depthParameterName,
                    Anchor = faceTarget,
                    Direction = depthDirection,
                    PlaneNameBase = $"{name} Face",
                    Strength = RpStrength.StrongRef,
                    Inference = new InferenceInfo { Status = InferenceStatus.Exact }
                }
            },
            Geometry = new ConnectorStubGeometrySpec {
                IsSolid = stubMatch?.Extrusion.IsSolid ?? true,
                Round = new RoundConnectorGeometrySpec {
                    Center = new PlaneIntersectionSpec {
                        Plane1 = centerTarget1,
                        Plane2 = centerTarget2
                    },
                    Diameter = new AxisConstraintSpec {
                        Mode = AxisConstraintMode.Mirror,
                        Parameter = diameterParameterName,
                        CenterAnchor = centerTarget1,
                        PlaneNameBase = $"{name} Diameter",
                        Strength = RpStrength.StrongRef,
                        Inference = inference
                    }
                }
            },
            Config = BuildSemanticConnectorConfig(connector, domain),
            Inference = inference
        };
    }

    private static string GetSemanticConnectorBaseName(
        ConnectorElement connector,
        RawConnectorStubMatch? stubMatch,
        ParamDrivenConnectorDomain domain
    ) {
        if (!string.IsNullOrWhiteSpace(connector.Name) && !IsLowValueConnectorName(connector.Name))
            return connector.Name.Trim();

        var stubName = stubMatch?.Extrusion.Name?.Trim();
        if (!string.IsNullOrWhiteSpace(stubName) &&
            stubName.EndsWith(" Stub", StringComparison.OrdinalIgnoreCase)) {
            return stubName[..^" Stub".Length].Trim();
        }

        return domain switch {
            ParamDrivenConnectorDomain.Duct => "Duct Connector",
            ParamDrivenConnectorDomain.Pipe => "Pipe Connector",
            ParamDrivenConnectorDomain.Electrical => "Electrical Connector",
            _ => "Connector"
        };
    }

    private static bool IsLowValueConnectorName(string connectorName) {
        var normalized = connectorName?.Trim() ?? string.Empty;
        return string.IsNullOrWhiteSpace(normalized) ||
               normalized.Equals("Other", StringComparison.OrdinalIgnoreCase) ||
               normalized.Equals("Connector", StringComparison.OrdinalIgnoreCase) ||
               normalized.Equals("Pipe Connector", StringComparison.OrdinalIgnoreCase) ||
               normalized.Equals("Duct Connector", StringComparison.OrdinalIgnoreCase) ||
               normalized.Equals("Electrical Connector", StringComparison.OrdinalIgnoreCase);
    }

    private static string CreateUniqueConnectorName(string preferredName, ISet<string> existingNames) {
        var baseName = string.IsNullOrWhiteSpace(preferredName)
            ? "Connector"
            : preferredName.Trim();
        if (!existingNames.Contains(baseName))
            return baseName;

        for (var suffix = 2; suffix < 1000; suffix++) {
            var candidate = $"{baseName} {suffix}";
            if (!existingNames.Contains(candidate))
                return candidate;
        }

        return baseName;
    }

    private static PlaneTargetSpec ResolveExactConnectorPlaneTarget(
        XYZ point,
        DominantAxis axis,
        bool preferCenterPlanes,
        IReadOnlyList<ReferencePlane> referencePlanes,
        SemanticPlaneRegistry planeRegistry
    ) {
        var match = referencePlanes
            .Where(plane => RawConnectorUnitInference.TryGetAxis(plane.Normal, out var planeAxis) &&
                            planeAxis == axis &&
                            Math.Abs(SignedDistanceToPlaneAlongNormal(point, plane.BubbleEnd, plane.Normal.Normalize())) <= ConnectorPlaneTolerance)
            .Select(plane => new {
                Plane = plane,
                Target = planeRegistry.BuildPlaneTarget(plane.Name),
                Rank = RankConnectorPlaneName(plane.Name, preferCenterPlanes)
            })
            .Where(candidate => !IsEmptyAnchor(candidate.Target))
            .OrderBy(candidate => candidate.Rank)
            .ThenBy(candidate => candidate.Plane.Name, StringComparer.OrdinalIgnoreCase)
            .FirstOrDefault();

        return match?.Target ?? new PlaneTargetSpec();
    }

    private static bool TryResolveStubSketchPlaneTarget(
        RawConnectorStubMatch? stubMatch,
        SemanticPlaneRegistry planeRegistry,
        out PlaneTargetSpec target
    ) {
        target = new PlaneTargetSpec();
        var sketchPlaneName = stubMatch?.Extrusion.Sketch?.SketchPlane?.Name?.Trim();
        if (string.IsNullOrWhiteSpace(sketchPlaneName) || IsLowValueSketchPlaneName(sketchPlaneName))
            return false;

        target = planeRegistry.BuildPlaneTarget(sketchPlaneName);
        return !IsEmptyAnchor(target);
    }

    private static bool IsLowValueSketchPlaneName(string sketchPlaneName) =>
        sketchPlaneName.Equals("Reference Plane", StringComparison.OrdinalIgnoreCase) ||
        sketchPlaneName.Equals("Ref. Level", StringComparison.OrdinalIgnoreCase) ||
        sketchPlaneName.Equals("Reference Level", StringComparison.OrdinalIgnoreCase) ||
        sketchPlaneName.Equals("Level", StringComparison.OrdinalIgnoreCase);

    private static int RankConnectorPlaneName(string planeName, bool preferCenterPlanes) {
        var isCenterLike = planeName.Contains("Center", StringComparison.OrdinalIgnoreCase) ||
                           planeName.Contains("Elevation", StringComparison.OrdinalIgnoreCase);
        if (preferCenterPlanes)
            return isCenterLike ? 0 : 1;

        return isCenterLike ? 1 : 0;
    }

    private static bool TryResolveSemanticStubFacePoint(
        ConnectorElement connector,
        RawConnectorStubMatch stubMatch,
        DominantAxis faceAxis,
        out XYZ facePoint
    ) {
        facePoint = connector.Origin;
        var boundingBox = stubMatch.Extrusion.get_BoundingBox(null);
        if (boundingBox == null)
            return false;

        var minCoord = GetAxisCoordinate(boundingBox.Min, faceAxis);
        var maxCoord = GetAxisCoordinate(boundingBox.Max, faceAxis);
        var terminalCoord = GetAxisCoordinate(connector.Origin, faceAxis);
        var terminalUsesMin = Math.Abs(terminalCoord - minCoord) <= Math.Abs(terminalCoord - maxCoord);
        var baseCoord = terminalUsesMin ? maxCoord : minCoord;
        facePoint = ReplaceAxisCoordinate(connector.Origin, faceAxis, baseCoord);
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

    private static string GetAssociatedFamilyParameterName(
        Document doc,
        Element element,
        BuiltInParameter builtInParameter
    ) {
        var parameter = element.get_Parameter(builtInParameter);
        return parameter != null &&
               doc.IsFamilyDocument &&
               doc.FamilyManager.GetAssociatedFamilyParameter(parameter)?.Definition?.Name is { Length: > 0 } familyParameterName
            ? familyParameterName
            : string.Empty;
    }

    private static bool TryGetConnectorDiameterParameter(
        Document doc,
        ConnectorElement connector,
        out string diameterParameterName
    ) {
        diameterParameterName = GetAssociatedFamilyParameterName(doc, connector, BuiltInParameter.CONNECTOR_DIAMETER);
        if (!string.IsNullOrWhiteSpace(diameterParameterName))
            return true;

        diameterParameterName = GetAssociatedFamilyParameterName(doc, connector, BuiltInParameter.CONNECTOR_RADIUS);
        return !string.IsNullOrWhiteSpace(diameterParameterName);
    }

    private static bool TryGetConnectorRectangleParameters(
        Document doc,
        ConnectorElement connector,
        out string widthParameterName,
        out string lengthParameterName
    ) {
        widthParameterName = GetAssociatedFamilyParameterName(doc, connector, BuiltInParameter.CONNECTOR_WIDTH);
        lengthParameterName = GetAssociatedFamilyParameterName(doc, connector, BuiltInParameter.CONNECTOR_HEIGHT);
        return !string.IsNullOrWhiteSpace(widthParameterName) &&
               !string.IsNullOrWhiteSpace(lengthParameterName);
    }

    private static bool TryMapConnectorDomain(Domain domain, out ParamDrivenConnectorDomain result) {
        result = domain switch {
            Domain.DomainHvac => ParamDrivenConnectorDomain.Duct,
            Domain.DomainPiping => ParamDrivenConnectorDomain.Pipe,
            Domain.DomainElectrical => ParamDrivenConnectorDomain.Electrical,
            _ => default
        };

        return domain is Domain.DomainHvac or Domain.DomainPiping or Domain.DomainElectrical;
    }

    private static ConnectorDomainConfigSpec BuildSemanticConnectorConfig(
        ConnectorElement connector,
        ParamDrivenConnectorDomain domain
    ) {
        if (domain == ParamDrivenConnectorDomain.Duct) {
            return new ConnectorDomainConfigSpec {
                Duct = new DuctConnectorConfigSpec {
                    SystemType = (DuctSystemType)(int)connector.SystemClassification,
                    FlowConfiguration = (DuctFlowConfigurationType)(connector.get_Parameter(BuiltInParameter.RBS_DUCT_FLOW_CONFIGURATION_PARAM)?.AsInteger()
                                                                     ?? (int)DuctFlowConfigurationType.Preset),
                    FlowDirection = (FlowDirectionType)(connector.get_Parameter(BuiltInParameter.RBS_DUCT_FLOW_DIRECTION_PARAM)?.AsInteger()
                                                          ?? (int)FlowDirectionType.Bidirectional),
                    LossMethod = (DuctLossMethodType)(connector.get_Parameter(BuiltInParameter.RBS_DUCT_FITTING_LOSS_METHOD_PARAM)?.AsInteger()
                                                       ?? (int)DuctLossMethodType.NotDefined)
                }
            };
        }

        if (domain == ParamDrivenConnectorDomain.Pipe) {
            return new ConnectorDomainConfigSpec {
                Pipe = new PipeConnectorConfigSpec {
                    SystemType = (PipeSystemType)(int)connector.SystemClassification,
                    FlowDirection = (FlowDirectionType)(connector.get_Parameter(BuiltInParameter.RBS_PIPE_FLOW_DIRECTION_PARAM)?.AsInteger()
                                                          ?? (int)FlowDirectionType.Bidirectional)
                }
            };
        }

        return new ConnectorDomainConfigSpec {
            Electrical = new ElectricalConnectorConfigSpec {
                SystemType = ElectricalSystemType.PowerBalanced
            }
        };
    }
}
