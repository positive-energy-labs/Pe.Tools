using Autodesk.Revit.DB;
using Autodesk.Revit.DB.Electrical;
using Autodesk.Revit.DB.Mechanical;
using Autodesk.Revit.DB.Plumbing;
using Newtonsoft.Json;
using Newtonsoft.Json.Converters;
using Pe.FamilyFoundry;
using Pe.FamilyFoundry.Helpers;
using System.Globalization;

namespace Pe.FamilyFoundry.Snapshots;

public partial class ExtrusionSectionCollector {
    private const double AuthoredOffsetTolerance = 1e-6;
    private const string DefaultInferredConnectorDepth = "0.5in";
    private static readonly IReadOnlyDictionary<string, string> BuiltInPlaneRefs =
        new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase) {
            ["Left"] = "@Left",
            ["Right"] = "@Right",
            ["Front"] = "@Front",
            ["Back"] = "@Back",
            ["Top"] = "@Top",
            ["Reference Plane"] = "@Bottom",
            ["Ref. Level"] = "@Bottom",
            ["Center (Left/Right)"] = "@CenterLR",
            ["Center (Front/Back)"] = "@CenterFB"
        };

    private static AuthoredParamDrivenSolidsSettings BuildAuthoredSolids(
        ParamDrivenSolidsSnapshot semanticSnapshot,
        ExtrusionSnapshot legacy
    ) {
        var legacyRectangles = legacy.Rectangles
            .GroupBy(spec => spec.Name, StringComparer.Ordinal)
            .ToDictionary(group => group.Key, group => group.First(), StringComparer.Ordinal);
        var legacyCircles = legacy.Circles
            .GroupBy(spec => spec.Name, StringComparer.Ordinal)
            .ToDictionary(group => group.Key, group => group.First(), StringComparer.Ordinal);

        return new AuthoredParamDrivenSolidsSettings {
            Frame = semanticSnapshot.Frame,
            Planes = semanticSnapshot.SemanticPlanes
                .Select(TryBuildTopLevelPlane)
                .Where(entry => entry != null)
                .ToDictionary(
                    entry => entry!.Value.Key,
                    entry => entry!.Value.Value,
                    StringComparer.Ordinal),
            Prisms = semanticSnapshot.Rectangles
                .Select(rectangle => ToAuthoredPrism(
                    rectangle,
                    legacyRectangles.TryGetValue(rectangle.Name, out var legacyRectangle) ? legacyRectangle : null))
                .ToList(),
            Cylinders = semanticSnapshot.Cylinders
                .Select(cylinder => ToAuthoredCylinder(
                    cylinder,
                    legacyCircles.TryGetValue(cylinder.Name, out var legacyCircle) ? legacyCircle : null))
                .ToList(),
            Connectors = semanticSnapshot.Connectors.Select(ToAuthoredConnector).ToList()
        };
    }

    private static AuthoredPrismSpec ToAuthoredPrism(
        ParamDrivenRectangleSpec legacy,
        ConstrainedRectangleExtrusionSpec? extrusion
    ) => new() {
        Name = legacy.Name,
        IsSolid = legacy.IsSolid,
        On = ToAuthoredPlaneRef(legacy.Sketch),
        Width = ToAuthoredSpanSpec(legacy.Name, "Width", legacy.Width),
        Length = ToAuthoredSpanSpec(legacy.Name, "Length", legacy.Length),
        Height = ToAuthoredPlaneSpec(legacy.Name, "Height", legacy.Height, legacy.Sketch, extrusion)
    };

    private static AuthoredCylinderSpec ToAuthoredCylinder(
        ParamDrivenCylinderSpec legacy,
        ConstrainedCircleExtrusionSpec? extrusion
    ) => new() {
        Name = legacy.Name,
        IsSolid = legacy.IsSolid,
        On = ToAuthoredPlaneRef(legacy.Sketch),
        Center = [
            ToAuthoredPlaneRef(legacy.Center.Plane1),
            ToAuthoredPlaneRef(legacy.Center.Plane2)
        ],
        Diameter = new AuthoredMeasureSpec {
            By = ToAuthoredLength(legacy.Diameter.Parameter)
        },
        Height = ToAuthoredPlaneSpec(legacy.Name, "Height", legacy.Height, legacy.Sketch, extrusion)
    };

    private static AuthoredConnectorSpec ToAuthoredConnector(ParamDrivenConnectorSpec legacy) => new() {
        Name = legacy.Name,
        Domain = legacy.Domain,
        Face = ToAuthoredPlaneRef(legacy.Placement.Face),
        Depth = new AuthoredDepthSpec {
            By = ToAuthoredDepth(legacy.Placement.Depth.Parameter),
            Dir = legacy.Placement.Depth.Direction == OffsetDirection.Negative ? "in" : "out"
        },
        IsSolid = legacy.Geometry.IsSolid,
        Rect = legacy.Geometry.Rectangular == null
            ? null
            : new AuthoredRectConnectorGeometrySpec {
                Center = [
                    ToAuthoredPlaneRef(legacy.Geometry.Rectangular.Width.CenterAnchor),
                    ToAuthoredPlaneRef(legacy.Geometry.Rectangular.Length.CenterAnchor)
                ],
                Width = new AuthoredCenterMeasureSpec {
                    About = ToAuthoredPlaneRef(legacy.Geometry.Rectangular.Width.CenterAnchor),
                    By = ToAuthoredLength(legacy.Geometry.Rectangular.Width.Parameter)
                },
                Length = new AuthoredCenterMeasureSpec {
                    About = ToAuthoredPlaneRef(legacy.Geometry.Rectangular.Length.CenterAnchor),
                    By = ToAuthoredLength(legacy.Geometry.Rectangular.Length.Parameter)
                }
            },
        Round = legacy.Geometry.Round == null
            ? null
            : new AuthoredRoundConnectorGeometrySpec {
                Center = [
                    ToAuthoredPlaneRef(legacy.Geometry.Round.Center.Plane1),
                    ToAuthoredPlaneRef(legacy.Geometry.Round.Center.Plane2)
                ],
                Diameter = new AuthoredMeasureSpec {
                    By = ToAuthoredLength(legacy.Geometry.Round.Diameter.Parameter)
                }
            },
        Config = FlattenConfig(legacy.Config)
    };

    private static PlanePairOrInlineSpanSpec ToAuthoredSpanSpec(
        string ownerName,
        string axisName,
        AxisConstraintSpec axis
    ) => new() {
        InlineSpan = new AuthoredSpanSpec {
            About = ToAuthoredPlaneRef(axis.CenterAnchor),
            By = ToAuthoredLength(axis.Parameter),
            Negative = axisName == "Width" ? $"{ownerName} Back" : $"{ownerName} Left",
            Positive = axisName == "Width" ? $"{ownerName} Front" : $"{ownerName} Right"
        }
    };

    private static PlaneRefOrInlinePlaneSpec ToAuthoredPlaneSpec(
        string ownerName,
        string axisName,
        AxisConstraintSpec axis,
        PlaneTargetSpec sketch,
        ConstrainedRectangleExtrusionSpec? extrusion
    ) {
        var exact = TryBuildExactPlane(ownerName, axisName, axis);
        if (exact != null)
            return exact;

        var fallback = TryBuildLiteralHeightFallback(ownerName, axisName, sketch, extrusion?.StartOffset, extrusion?.EndOffset);
        if (fallback != null)
            return fallback;

        return BuildBestEffortNamedPlane(ownerName, axisName, axis, sketch);
    }

    private static PlaneRefOrInlinePlaneSpec ToAuthoredPlaneSpec(
        string ownerName,
        string axisName,
        AxisConstraintSpec axis,
        PlaneTargetSpec sketch,
        ConstrainedCircleExtrusionSpec? extrusion
    ) {
        var exact = TryBuildExactPlane(ownerName, axisName, axis);
        if (exact != null)
            return exact;

        var fallback = TryBuildLiteralHeightFallback(ownerName, axisName, sketch, extrusion?.StartOffset, extrusion?.EndOffset);
        if (fallback != null)
            return fallback;

        return BuildBestEffortNamedPlane(ownerName, axisName, axis, sketch);
    }

    private static PlaneRefOrInlinePlaneSpec? TryBuildExactPlane(
        string ownerName,
        string axisName,
        AxisConstraintSpec axis
    ) {
        if (axis.Mode != AxisConstraintMode.Offset || IsEmpty(axis.Anchor) || string.IsNullOrWhiteSpace(axis.Parameter))
            return null;

        var from = ToAuthoredPlaneRef(axis.Anchor);
        var by = ToAuthoredLength(axis.Parameter);
        if (!IsValidAuthoredPlaneRef(from) || string.IsNullOrWhiteSpace(by))
            return null;

        return new PlaneRefOrInlinePlaneSpec {
            InlinePlane = new AuthoredNamedPlaneSpec {
                Name = axisName == "Height" ? $"{ownerName} Top" : $"{ownerName} {axisName}",
                From = from,
                By = by,
                Dir = ToAuthoredDirection(axis.Direction)
            }
        };
    }

    private static PlaneRefOrInlinePlaneSpec BuildBestEffortNamedPlane(
        string ownerName,
        string axisName,
        AxisConstraintSpec axis,
        PlaneTargetSpec sketch
    ) {
        var fallbackFrom = ToAuthoredPlaneRef(sketch);
        var exactFrom = ToAuthoredPlaneRef(axis.Anchor);
        var by = ToAuthoredLength(axis.Parameter);
        var chosenFrom = IsValidAuthoredPlaneRef(exactFrom) ? exactFrom : fallbackFrom;
        var chosenBy = string.IsNullOrWhiteSpace(by) ? "0ft" : by;

        return new PlaneRefOrInlinePlaneSpec {
            InlinePlane = new AuthoredNamedPlaneSpec {
                Name = axisName == "Height" ? $"{ownerName} Top" : $"{ownerName} {axisName}",
                From = chosenFrom,
                By = chosenBy,
                Dir = ToAuthoredDirection(axis.Direction)
            }
        };
    }

    private static KeyValuePair<string, AuthoredPlaneSpec>? TryBuildTopLevelPlane(SemanticPlaneSpec spec) {
        if (string.IsNullOrWhiteSpace(spec.Name) ||
            spec.Constraint.Mode != AxisConstraintMode.Offset ||
            IsEmpty(spec.Constraint.Anchor) ||
            string.IsNullOrWhiteSpace(spec.Constraint.Parameter))
            return null;

        var name = spec.Name.Trim();
        var authored = new AuthoredPlaneSpec {
            From = ToAuthoredPlaneRef(spec.Constraint.Anchor),
            By = ToAuthoredLength(spec.Constraint.Parameter),
            Dir = ToAuthoredDirection(spec.Constraint.Direction)
        };

        if (!IsValidAuthoredPlaneRef(authored.From) || string.IsNullOrWhiteSpace(authored.By))
            return null;

        return new KeyValuePair<string, AuthoredPlaneSpec>(name, authored);
    }

    private static PlaneRefOrInlinePlaneSpec? TryBuildLiteralHeightFallback(
        string ownerName,
        string axisName,
        PlaneTargetSpec sketch,
        double? startOffset,
        double? endOffset
    ) {
        if (axisName != "Height" || startOffset == null || endOffset == null)
            return null;

        if (Math.Abs(startOffset.Value) > AuthoredOffsetTolerance)
            return null;

        var height = Math.Abs(endOffset.Value - startOffset.Value);
        if (height <= AuthoredOffsetTolerance)
            return null;

        return new PlaneRefOrInlinePlaneSpec {
            EndOffset = new AuthoredEndOffsetPlaneSpec {
                By = ToAuthoredLiteral(height),
                Dir = endOffset.Value >= startOffset.Value ? "out" : "in"
            }
        };
    }

    private static string ToAuthoredPlaneRef(PlaneTargetSpec target) {
        if (target.Frame != null) {
            return target.Frame.Plane switch {
                ParamDrivenFramePlane.Left => "@Left",
                ParamDrivenFramePlane.Right => "@Right",
                ParamDrivenFramePlane.Front => "@Front",
                ParamDrivenFramePlane.Back => "@Back",
                ParamDrivenFramePlane.Top => "@Top",
                ParamDrivenFramePlane.Bottom => "@Bottom",
                ParamDrivenFramePlane.CenterLR => "@CenterLR",
                ParamDrivenFramePlane.CenterFB => "@CenterFB",
                _ => "@Bottom"
            };
        }

        if (target.Semantic != null)
            return $"plane:{target.Semantic.Name.Trim()}";

        if (target.Derived != null) {
            return target.Derived.Plane switch {
                ParamDrivenDerivedPlaneKind.CenterLR => "@CenterLR",
                ParamDrivenDerivedPlaneKind.CenterFB => "@CenterFB",
                ParamDrivenDerivedPlaneKind.Bottom => "@Bottom",
                _ => $"plane:{target.Derived.Solid.Trim()} {target.Derived.Plane}"
            };
        }

        return string.Empty;
    }

    private static string ToAuthoredPlaneRef(string planeName) =>
        BuiltInPlaneRefs.TryGetValue(planeName?.Trim() ?? string.Empty, out var builtInRef)
            ? builtInRef
            : $"plane:{planeName?.Trim()}";

    private static string ToAuthoredDirection(OffsetDirection direction) =>
        direction == OffsetDirection.Negative ? "in" : "out";

    private static string ToAuthoredLength(string? parameterName) =>
        string.IsNullOrWhiteSpace(parameterName)
            ? string.Empty
            : $"param:{parameterName.Trim()}";

    private static string ToAuthoredDepth(string? parameterName) =>
        string.IsNullOrWhiteSpace(parameterName)
            ? DefaultInferredConnectorDepth
            : ToAuthoredLength(parameterName);

    private static string ToAuthoredLiteral(double internalFeet) =>
        $"{internalFeet.ToString("0.###############", CultureInfo.InvariantCulture)}ft";

    private static bool IsValidAuthoredPlaneRef(string? authoredRef) {
        var normalized = authoredRef?.Trim();
        if (string.IsNullOrWhiteSpace(normalized))
            return false;

        if (normalized.StartsWith("@", StringComparison.Ordinal))
            return normalized.Length > 1;

        if (!normalized.StartsWith("plane:", StringComparison.OrdinalIgnoreCase))
            return false;

        return !string.IsNullOrWhiteSpace(normalized["plane:".Length..].Trim());
    }

    private static bool IsEmpty(PlaneTargetSpec target) =>
        target == null || (target.Frame == null && target.Semantic == null && target.Derived == null);

    private static AuthoredConnectorConfigSpec FlattenConfig(ConnectorDomainConfigSpec config) {
        if (config.Duct != null) {
            return new AuthoredConnectorConfigSpec {
                SystemType = config.Duct.SystemType.ToString(),
                FlowConfiguration = config.Duct.FlowConfiguration.ToString(),
                FlowDirection = config.Duct.FlowDirection.ToString(),
                LossMethod = config.Duct.LossMethod.ToString()
            };
        }

        if (config.Pipe != null) {
            return new AuthoredConnectorConfigSpec {
                SystemType = config.Pipe.SystemType.ToString(),
                FlowDirection = config.Pipe.FlowDirection.ToString()
            };
        }

        return new AuthoredConnectorConfigSpec {
            SystemType = config.Electrical?.SystemType.ToString() ?? string.Empty
        };
    }

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
        var planeNames = authored.Planes.Keys
            .Where(name => !string.IsNullOrWhiteSpace(name))
            .Select(name => name.Trim())
            .ToHashSet(StringComparer.OrdinalIgnoreCase);
        var stubMatches = RawConnectorUnitInference.MatchOwnedStubs(doc);
        var rawConnectors = new FilteredElementCollector(doc)
            .OfClass(typeof(ConnectorElement))
            .Cast<ConnectorElement>()
            .ToList();
        if (rawConnectors.Count == 0 || authored.Connectors.Count >= rawConnectors.Count)
            return;

        foreach (var rawConnector in rawConnectors) {
            stubMatches.TryGetValue(rawConnector.Id, out var stubMatch);
            var inferred = TryInferRawConnector(doc, rawConnector, stubMatch, anchors, authored.Planes, planeNames, connectorNames);
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
            !anchors.ContainsKey(centerAxes[1]))
            return null;

        var hostNormal = anchors[faceAxis].Plane.Normal.Normalize();
        var name = CreateUniqueName(GetBaseConnectorName(connector, domain), connectorNames);
        var connectorOrigin = connector.Origin;
        var facePoint = connectorOrigin;
        var depthBy = DefaultInferredConnectorDepth;
        var depthDir = normal.DotProduct(hostNormal) >= 0.0 ? "out" : "in";
        if (stubMatch != null &&
            TryResolveStubPlacement(doc, connector, stubMatch, anchors[faceAxis].Plane, faceAxis, out var resolvedFacePoint, out var resolvedDepthBy, out var resolvedDepthDir)) {
            facePoint = resolvedFacePoint;
            depthBy = resolvedDepthBy;
            depthDir = resolvedDepthDir;
        }

        var faceRef = ResolvePointPlaneRef($"{name} Face", facePoint, faceAxis, anchors, planes, planeNames);
        var center1Ref = ResolvePointPlaneRef($"{name} Center 1", connector.Origin, centerAxes[0], anchors, planes, planeNames);
        var center2Ref = ResolvePointPlaneRef($"{name} Center 2", connector.Origin, centerAxes[1], anchors, planes, planeNames);
        if (string.IsNullOrWhiteSpace(faceRef) ||
            string.IsNullOrWhiteSpace(center1Ref) ||
            string.IsNullOrWhiteSpace(center2Ref))
            return null;

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
                    Diameter = new AuthoredMeasureSpec { By = GetAssociatedOrLiteralMeasure(doc, connector, BuiltInParameter.CONNECTOR_DIAMETER, diameter) }
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
        IReadOnlyDictionary<DominantAxis, CanonicalAnchorPlane> anchors,
        IDictionary<string, AuthoredPlaneSpec> planes,
        ISet<string> planeNames
    ) {
        if (!anchors.TryGetValue(axis, out var anchor))
            return string.Empty;

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

    private sealed class ParamDrivenSolidsSnapshot {
        public SnapshotSource Source { get; set; }
        public ParamDrivenFamilyFrameKind Frame { get; set; } = ParamDrivenFamilyFrameKind.NonHosted;
        public List<SemanticPlaneSpec> SemanticPlanes { get; set; } = [];
        public List<ParamDrivenRectangleSpec> Rectangles { get; set; } = [];
        public List<ParamDrivenCylinderSpec> Cylinders { get; set; } = [];
        public List<ParamDrivenConnectorSpec> Connectors { get; set; } = [];
    }

    private abstract class ParamDrivenSolidSpec {
        public string Name { get; init; } = string.Empty;
        public bool IsSolid { get; init; } = true;
        public PlaneTargetSpec Sketch { get; init; } = new();
        public InferenceInfo? Inference { get; init; }
    }

    private sealed class ParamDrivenRectangleSpec : ParamDrivenSolidSpec {
        public AxisConstraintSpec Width { get; init; } = new();
        public AxisConstraintSpec Length { get; init; } = new();
        public AxisConstraintSpec Height { get; init; } = new();
        public List<LocalSemanticPlaneSpec> Offsets { get; init; } = [];
    }

    private sealed class ParamDrivenCylinderSpec : ParamDrivenSolidSpec {
        public PlaneIntersectionSpec Center { get; init; } = new();
        public AxisConstraintSpec Diameter { get; init; } = new();
        public AxisConstraintSpec Height { get; init; } = new();
        public List<LocalSemanticPlaneSpec> Offsets { get; init; } = [];
    }

    private sealed class ParamDrivenConnectorSpec {
        public string Name { get; init; } = string.Empty;

        [JsonConverter(typeof(StringEnumConverter))]
        public ParamDrivenConnectorDomain Domain { get; init; }

        public ConnectorPlacementSpec Placement { get; init; } = new();
        public ConnectorStubGeometrySpec Geometry { get; init; } = new();
        public ConnectorDomainConfigSpec Config { get; init; } = new();
        public InferenceInfo? Inference { get; init; }
    }

    private sealed class ConnectorPlacementSpec {
        public PlaneTargetSpec Face { get; init; } = new();
        public AxisConstraintSpec Depth { get; init; } = new();
    }

    private sealed class ConnectorStubGeometrySpec {
        public bool IsSolid { get; init; } = true;
        public RectangularConnectorGeometrySpec? Rectangular { get; init; }
        public RoundConnectorGeometrySpec? Round { get; init; }
    }

    private sealed class RectangularConnectorGeometrySpec {
        public AxisConstraintSpec Width { get; init; } = new();
        public AxisConstraintSpec Length { get; init; } = new();
    }

    private sealed class RoundConnectorGeometrySpec {
        public PlaneIntersectionSpec Center { get; init; } = new();
        public AxisConstraintSpec Diameter { get; init; } = new();
    }

    private sealed class PlaneTargetSpec {
        public FramePlaneTargetSpec? Frame { get; init; }
        public DerivedPlaneTargetSpec? Derived { get; init; }
        public SemanticPlaneTargetSpec? Semantic { get; init; }
    }

    private sealed class PlaneIntersectionSpec {
        public PlaneTargetSpec Plane1 { get; init; } = new();
        public PlaneTargetSpec Plane2 { get; init; } = new();
    }

    private sealed class AxisConstraintSpec {
        [JsonConverter(typeof(StringEnumConverter))]
        public AxisConstraintMode Mode { get; init; }

        public string Parameter { get; init; } = string.Empty;
        public PlaneTargetSpec CenterAnchor { get; init; } = new();
        public PlaneTargetSpec Anchor { get; init; } = new();

        [JsonConverter(typeof(StringEnumConverter))]
        public OffsetDirection Direction { get; init; } = OffsetDirection.Positive;

        public string PlaneNameBase { get; init; } = string.Empty;

        [JsonConverter(typeof(StringEnumConverter))]
        public RpStrength Strength { get; init; } = RpStrength.NotARef;

        public InferenceInfo? Inference { get; init; }
    }

    private sealed class SemanticPlaneSpec {
        public string Name { get; init; } = string.Empty;
        public AxisConstraintSpec Constraint { get; init; } = new();
    }

    private sealed class LocalSemanticPlaneSpec {
        public string Name { get; init; } = string.Empty;
        public AxisConstraintSpec Constraint { get; init; } = new();
    }

    private sealed class SemanticPlaneTargetSpec {
        public string Name { get; init; } = string.Empty;
    }

    private sealed class FramePlaneTargetSpec {
        [JsonConverter(typeof(StringEnumConverter))]
        public ParamDrivenFramePlane Plane { get; init; }
    }

    [JsonConverter(typeof(StringEnumConverter))]
    private enum ParamDrivenFramePlane {
        Left,
        Right,
        Front,
        Back,
        Top,
        Bottom,
        CenterLR,
        CenterFB,
        CenterTB
    }

    private sealed class DerivedPlaneTargetSpec {
        public string Solid { get; init; } = string.Empty;

        [JsonConverter(typeof(StringEnumConverter))]
        public ParamDrivenDerivedPlaneKind Plane { get; init; }
    }

    [JsonConverter(typeof(StringEnumConverter))]
    private enum ParamDrivenDerivedPlaneKind {
        Left,
        Right,
        Front,
        Back,
        Top,
        Bottom,
        CenterLR,
        CenterFB
    }

    private sealed class InferenceInfo {
        [JsonConverter(typeof(StringEnumConverter))]
        public InferenceStatus Status { get; init; } = InferenceStatus.Exact;

        public List<string> Warnings { get; init; } = [];
    }

    [JsonConverter(typeof(StringEnumConverter))]
    private enum AxisConstraintMode {
        Mirror,
        Offset
    }

    [JsonConverter(typeof(StringEnumConverter))]
    private enum InferenceStatus {
        Exact,
        Inferred,
        Ambiguous
    }
}
