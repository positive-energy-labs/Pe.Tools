using Autodesk.Revit.DB.Architecture;
using Pe.Revit.DocumentData.Parameters;
using Pe.Revit.FamilyFoundry.Apply;
using Pe.Revit.FamilyFoundry.Helpers;
using Pe.Shared.RevitData.Families;

namespace Pe.Revit.FamilyFoundry.Capture;

/// <summary>
///     Projects observable family-document state back to the portable authored language. It deliberately accepts
///     only a Document: the original profile and compiler plan must be unavailable at this boundary.
/// </summary>
public static class FamilyModelCaptureExtensions {
    public static FamilyModel CaptureFamilyModel(this Document document) {
        if (document == null)
            throw new ArgumentNullException(nameof(document));
        if (!document.IsFamilyDocument)
            throw new InvalidOperationException("Expected a family document.");

        var snapshot = document.CaptureFamilySnapshot();
        var placement = FamilyModelBuilder.GetPlacement(document.OwnerFamily.FamilyPlacementType);
        var category = document.OwnerFamily.FamilyCategory?.Name ?? string.Empty;
        var unmodeled = new List<FamilyModelUnmodeledFact>();
        var template = InferTemplate(category, placement, unmodeled);
        var types = document.FamilyManager.Types
            .Cast<FamilyType>()
            .OrderBy(type => type.Name, StringComparer.Ordinal)
            .ToDictionary(
                type => type.Name,
                _ => new Dictionary<string, string>(StringComparer.Ordinal),
                StringComparer.Ordinal);
        var familyParameters = new Dictionary<string, FamilyModelFamilyParameter>(StringComparer.Ordinal);
        var sharedParameters = new Dictionary<string, FamilyModelSharedParameter>(StringComparer.Ordinal);

        foreach (var parameter in snapshot.Parameters?.Data?.Where(item => !item.IsBuiltIn) ?? []) {
            var values = ProjectAssignments(parameter, types);
            if (parameter.IsShared) {
                sharedParameters[parameter.Name] = new FamilyModelSharedParameter {
                    PropertiesGroup = ProjectPropertiesGroup(parameter),
                    IsInstance = parameter.IsInstance,
                    Value = values.UniformValue,
                    Formula = parameter.Formula
                };
            } else {
                familyParameters[parameter.Name] = new FamilyModelFamilyParameter {
                    DataType = ProjectDataType(parameter),
                    PropertiesGroup = ProjectPropertiesGroup(parameter),
                    IsInstance = parameter.IsInstance,
                    Tooltip = parameter.Tooltip,
                    Value = values.UniformValue,
                    Formula = parameter.Formula
                };
            }
        }

        var solids = ProjectSolids(snapshot.AuthoredParamDrivenSolids, unmodeled);
        var planes = ProjectPlanes(snapshot.AuthoredParamDrivenSolids, solids, unmodeled);
        var frames = new Dictionary<string, FamilyModelFrame>(StringComparer.Ordinal);
        var connectors = ProjectConnectors(document, snapshot.AuthoredParamDrivenSolids, solids, frames,
            unmodeled);
        var roomCalculationPoint = ProjectRoomCalculationPoint(document, placement, unmodeled);
        AddUnmodeledObservableState(document, snapshot, unmodeled);
        return new FamilyModel {
            Family = new FamilyModelHeader {
                Name = document.OwnerFamily.Name,
                Category = category,
                Template = template,
                Placement = placement
            },
            FamilyParameters = familyParameters,
            SharedParameters = sharedParameters,
            Types = types,
            Planes = planes,
            Frames = frames,
            Solids = solids,
            Connectors = connectors,
            RoomCalculationPoint = roomCalculationPoint,
            Unmodeled = unmodeled
        };
    }

    private static Dictionary<string, FamilyModelPlane> ProjectPlanes(
        AuthoredParamDrivenSolidsSettings? authored,
        IReadOnlyDictionary<string, FamilyModelSolid> solids,
        ICollection<FamilyModelUnmodeledFact> unmodeled
    ) {
        var result = new Dictionary<string, FamilyModelPlane>(StringComparer.Ordinal);
        if (authored == null)
            return result;

        foreach (var pair in authored.Planes) {
            if (!TryProjectPlaneReference(pair.Value.From, solids, preferSolidFace: false, out var from)) {
                AddUnmodeledConstituent(unmodeled, "plane-reference-not-portable", pair.Key, pair.Value.From);
                continue;
            }

            result[pair.Key] = new FamilyModelPlane {
                From = from,
                By = pair.Value.By,
                Direction = string.Equals(pair.Value.Dir, "in", StringComparison.OrdinalIgnoreCase)
                    ? FamilyModelOffsetDirection.In
                    : FamilyModelOffsetDirection.Out
            };
        }

        return result;
    }

    private static Dictionary<string, FamilyModelConnector> ProjectConnectors(
        Document document,
        AuthoredParamDrivenSolidsSettings? authored,
        IReadOnlyDictionary<string, FamilyModelSolid> solids,
        IDictionary<string, FamilyModelFrame> frames,
        ICollection<FamilyModelUnmodeledFact> unmodeled
    ) {
        var result = new Dictionary<string, FamilyModelConnector>(StringComparer.Ordinal);
        if (authored == null)
            return result;

        foreach (var connector in authored.Connectors) {
            // Revit connector elements expose generic names ("Pipe Connector", "Pipe Connector 2") rather than
            // the authored key. Normalize that observable ordering deterministically; do not smuggle the old key.
            var slug = ToLogicalSlug(connector.Name);
            var geometry = (Round: connector.Round, Rect: connector.Rect);
            var center = geometry.Round?.Center ?? geometry.Rect?.Center;
            if (string.IsNullOrWhiteSpace(slug) || center?.Count != 2 ||
                !TryProjectPlaneReference(connector.Face, solids, preferSolidFace: true, out var face) ||
                !TryProjectPlaneReference(center[0], solids, preferSolidFace: false, out var center1) ||
                !TryProjectPlaneReference(center[1], solids, preferSolidFace: false, out var center2)) {
                AddUnmodeledConstituent(unmodeled, "connector-frame-not-portable", slug, connector.Face);
                continue;
            }

            var normal = connector.FrameNormal ?? InferAxis(document, connector.Face);
            var up = connector.FrameUp ?? (normal.EndsWith("Z", StringComparison.Ordinal) ? "+Y" : "+Z");
            frames[slug] = new FamilyModelFrame {
                Origin = [face, center1, center2],
                Normal = normal,
                Up = up
            };

            result[slug] = new FamilyModelConnector {
                Domain = connector.Domain switch {
                    ParamDrivenConnectorDomain.Duct => FamilyConnectorDomain.Duct,
                    ParamDrivenConnectorDomain.Pipe => FamilyConnectorDomain.Pipe,
                    ParamDrivenConnectorDomain.Electrical => FamilyConnectorDomain.Electrical,
                    _ => throw new ArgumentOutOfRangeException()
                },
                Frame = $"frame:{slug}",
                Shape = geometry.Round != null ? FamilyConnectorShape.Round : FamilyConnectorShape.Rectangular,
                Diameter = geometry.Round?.Diameter.By,
                Width = geometry.Rect?.Width.By,
                Height = geometry.Rect?.Length.By,
                Stub = new FamilyConnectorStub {
                    Depth = connector.Depth.By,
                    Direction = string.Equals(connector.Depth.Dir, "in", StringComparison.OrdinalIgnoreCase)
                        ? FamilyModelOffsetDirection.In
                        : FamilyModelOffsetDirection.Out,
                    IsSolid = connector.IsSolid ? null : false
                },
                SystemType = connector.Config.SystemType,
                FlowDirection = string.IsNullOrWhiteSpace(connector.Config.FlowDirection)
                    ? null
                    : connector.Config.FlowDirection,
                FlowConfiguration = connector.Domain == ParamDrivenConnectorDomain.Duct
                    ? connector.Config.FlowConfiguration
                    : null,
                LossMethod = connector.Domain == ParamDrivenConnectorDomain.Duct
                    ? connector.Config.LossMethod
                    : null,
                ParameterBindings = connector.Bindings.Parameters.ToDictionary(
                    binding => binding.Target.ToString(),
                    binding => $"param:{binding.SourceParameter}",
                    StringComparer.Ordinal)
            };
        }

        return result;
    }

    private static string ToLogicalSlug(string value) {
        var characters = value.Trim()
            .Select(character => char.IsLetterOrDigit(character) ? char.ToLowerInvariant(character) : '-')
            .ToArray();
        var collapsed = string.Join("-", new string(characters)
            .Split(['-'], StringSplitOptions.RemoveEmptyEntries));
        return collapsed;
    }

    private static bool TryProjectPlaneReference(
        string authoredReference,
        IReadOnlyDictionary<string, FamilyModelSolid> solids,
        bool preferSolidFace,
        out string portableReference
    ) {
        portableReference = string.Empty;
        var reference = authoredReference.Trim();
        var builtIn = reference switch {
            "@CenterLR" => "plane:family.CenterLR",
            "@CenterFB" => "plane:family.CenterFB",
            "@Bottom" => "plane:family.Bottom",
            "@Top" => "plane:family.Top",
            "@Left" => "plane:family.Left",
            "@Right" => "plane:family.Right",
            "@Front" => "plane:family.Front",
            "@Back" => "plane:family.Back",
            _ => null
        };
        if (builtIn != null) {
            if (preferSolidFace && reference == "@Bottom" && solids.Count == 1)
                portableReference = $"face:{solids.Keys.Single()}.Bottom";
            else
                portableReference = builtIn;
            return true;
        }

        if (!reference.StartsWith("plane:", StringComparison.Ordinal))
            return false;

        var planeName = reference["plane:".Length..];
        if (preferSolidFace) {
            foreach (var solid in solids.Keys) {
                foreach (var face in new[] { "Top", "Left", "Right", "Front", "Back" }) {
                    if (!string.Equals(planeName, $"{solid}.{face.ToLowerInvariant()}", StringComparison.Ordinal))
                        continue;

                    portableReference = $"face:{solid}.{face}";
                    return true;
                }
            }
        }

        portableReference = $"plane:{planeName}";
        return true;
    }

    private static string InferAxis(Document document, string authoredPlaneReference) {
        if (authoredPlaneReference == "@Bottom")
            return "+Z";

        var planeName = authoredPlaneReference.StartsWith("plane:", StringComparison.Ordinal)
            ? authoredPlaneReference["plane:".Length..]
            : authoredPlaneReference.TrimStart('@');
        var plane = new FilteredElementCollector(document)
            .OfClass(typeof(ReferencePlane))
            .Cast<ReferencePlane>()
            .FirstOrDefault(item => string.Equals(item.Name, planeName, StringComparison.Ordinal));
        if (plane == null)
            return "+Z";

        var normal = plane.Normal.Normalize();
        var components = new[] {
            (Value: normal.X, Axis: "X"),
            (Value: normal.Y, Axis: "Y"),
            (Value: normal.Z, Axis: "Z")
        };
        var dominant = components.MaxBy(item => Math.Abs(item.Value));
        return $"{(dominant.Value < 0 ? "-" : "+")}{dominant.Axis}";
    }

    private static void AddUnmodeledConstituent(
        ICollection<FamilyModelUnmodeledFact> unmodeled,
        string reason,
        string slug,
        string observedReference
    ) => unmodeled.Add(new FamilyModelUnmodeledFact {
        Reason = reason,
        Path = "$.unmodeled",
        Facts = new Dictionary<string, string>(StringComparer.Ordinal) {
            ["slug"] = slug,
            ["observedReference"] = observedReference
        }
    });

    private static FamilyModelRoomCalculationPoint? ProjectRoomCalculationPoint(
        Document document,
        FamilyModelPlacement placement,
        ICollection<FamilyModelUnmodeledFact> unmodeled
    ) {
        if (!document.OwnerFamily.ShowSpatialElementCalculationPoint)
            return null;

        var direction = placement == FamilyModelPlacement.Unhosted ? XYZ.BasisZ : new XYZ(0, -1, 0);
        var expected = direction;
        var singlePoints = new FilteredElementCollector(document)
            .OfClass(typeof(SpatialElementCalculationPoint))
            .Cast<SpatialElementCalculationPoint>()
            .ToList();
        var fromToPoints = new FilteredElementCollector(document)
            .OfClass(typeof(SpatialElementFromToCalculationPoints))
            .Cast<SpatialElementFromToCalculationPoints>()
            .ToList();
        var isPeConvention = singlePoints.Count + fromToPoints.Count > 0 &&
                             singlePoints.All(point => point.Position.IsAlmostEqualTo(expected, 1e-6)) &&
                             fromToPoints.All(point =>
                                 point.FromPosition.IsAlmostEqualTo(expected.Negate(), 1e-6) &&
                                 point.ToPosition.IsAlmostEqualTo(expected, 1e-6));
        if (!isPeConvention) {
            unmodeled.Add(new FamilyModelUnmodeledFact {
                Reason = "non-default-room-calculation-point",
                Path = "$.roomCalculationPoint",
                Facts = new Dictionary<string, string>(StringComparer.Ordinal) {
                    ["placement"] = placement.ToString(),
                    ["singlePoints"] = singlePoints.Count.ToString(),
                    ["fromToPoints"] = fromToPoints.Count.ToString()
                }
            });
        }

        return new FamilyModelRoomCalculationPoint { Enabled = true };
    }

    private static void AddUnmodeledObservableState(
        Document document,
        FamilySnapshot snapshot,
        ICollection<FamilyModelUnmodeledFact> unmodeled
    ) {
        if (snapshot.LookupTables?.Data is { Count: > 0 } lookupTables) {
            unmodeled.Add(new FamilyModelUnmodeledFact {
                Reason = "lookup-tables-not-yet-modeled",
                Path = "$.unmodeled",
                Facts = new Dictionary<string, string>(StringComparer.Ordinal) {
                    ["count"] = lookupTables.Count.ToString()
                }
            });
        }

        var authored = snapshot.AuthoredParamDrivenSolids;
        if (authored == null)
            return;

        var observedExtrusions = new FilteredElementCollector(document)
            .OfClass(typeof(Extrusion))
            .GetElementCount();
        var recognizedConnectorStubs = RawConnectorUnitInference.MatchOwnedStubs(document)
            .Values
            .Select(match => match.Extrusion.Id)
            .Distinct()
            .Count();
        var recognizedExtrusions = authored.Prisms.Count + authored.Cylinders.Count + recognizedConnectorStubs;
        if (observedExtrusions == recognizedExtrusions)
            return;

        // The legacy solid collector is intentionally best-effort. Count the raw observable forms as a second
        // honesty check so an unsupported extrusion cannot disappear merely because decompilation skipped it.
        unmodeled.Add(new FamilyModelUnmodeledFact {
            Reason = "extrusion-capture-count-mismatch",
            Path = "$.solids",
            Facts = new Dictionary<string, string>(StringComparer.Ordinal) {
                ["observed"] = observedExtrusions.ToString(),
                ["recognized"] = recognizedExtrusions.ToString(),
                ["connectorStubs"] = recognizedConnectorStubs.ToString()
            }
        });
    }

    private static string InferTemplate(
        string category,
        FamilyModelPlacement placement,
        ICollection<FamilyModelUnmodeledFact> unmodeled
    ) {
        // Revit does not retain the source .rft path in an RFA. Capture therefore recognizes only proven PE
        // template conventions from observable category + placement; it never writes recovery metadata.
        if (placement == FamilyModelPlacement.Unhosted &&
            string.Equals(category, "Generic Models", StringComparison.OrdinalIgnoreCase))
            return "Generic Model";

        unmodeled.Add(new FamilyModelUnmodeledFact {
            Reason = "template-convention-unknown",
            Path = "$.family.template",
            Facts = new Dictionary<string, string>(StringComparer.Ordinal) {
                ["category"] = category,
                ["placement"] = placement.ToString()
            }
        });
        return "Unknown";
    }

    private static ProjectedAssignment ProjectAssignments(
        ParameterSnapshot parameter,
        IDictionary<string, Dictionary<string, string>> types
    ) {
        if (!string.IsNullOrWhiteSpace(parameter.Formula))
            return new ProjectedAssignment(null);

        var presentValues = types.Keys
            .Select(typeName => parameter.ValuesPerType.TryGetValue(typeName, out var value) ? value : null)
            .Where(value => value != null)
            .Select(value => value!)
            .ToList();
        if (presentValues.Count == types.Count &&
            presentValues.Distinct(StringComparer.Ordinal).Take(2).Count() == 1)
            return new ProjectedAssignment(presentValues[0]);

        foreach (var typeName in types.Keys) {
            if (parameter.ValuesPerType.TryGetValue(typeName, out var value) && value != null)
                types[typeName][parameter.Name] = value;
        }

        return new ProjectedAssignment(null);
    }

    private static Dictionary<string, FamilyModelSolid> ProjectSolids(
        AuthoredParamDrivenSolidsSettings? authored,
        ICollection<FamilyModelUnmodeledFact> unmodeled
    ) {
        var result = new Dictionary<string, FamilyModelSolid>(StringComparer.Ordinal);
        if (authored == null)
            return result;

        foreach (var prism in authored.Prisms) {
            if (!TryProjectPrism(prism, out var slug, out var solid)) {
                AddUnmodeledSolid(unmodeled, prism.Name, "prism-outside-family-frame-subset");
                continue;
            }

            AddSolid(result, unmodeled, slug, solid);
        }

        foreach (var cylinder in authored.Cylinders) {
            if (!TryProjectCylinder(cylinder, out var slug, out var solid)) {
                AddUnmodeledSolid(unmodeled, cylinder.Name, "cylinder-outside-family-frame-subset");
                continue;
            }

            AddSolid(result, unmodeled, slug, solid);
        }

        if (authored.Spans.Count > 0) {
            unmodeled.Add(new FamilyModelUnmodeledFact {
                Reason = "param-driven-constituents-not-yet-modeled",
                Path = "$.solids",
                Facts = new Dictionary<string, string>(StringComparer.Ordinal) {
                    ["spans"] = authored.Spans.Count.ToString()
                }
            });
        }

        return result;
    }

    private static bool TryProjectPrism(
        AuthoredPrismSpec prism,
        out string slug,
        out FamilyModelSolid solid
    ) {
        slug = TryInferSlug(prism.Height.InlinePlane?.Name, ".top")
               ?? TryInferSlug(prism.Length.InlineSpan?.Negative, ".left")
               ?? string.Empty;
        var length = prism.Length.InlineSpan;
        var width = prism.Width.InlineSpan;
        var height = prism.Height.InlinePlane;
        if (string.IsNullOrWhiteSpace(slug) ||
            !string.Equals(prism.On, "@Bottom", StringComparison.Ordinal) ||
            length == null || width == null || height == null ||
            !string.Equals(length.About, "@CenterLR", StringComparison.Ordinal) ||
            !string.Equals(width.About, "@CenterFB", StringComparison.Ordinal) ||
            !string.Equals(height.From, "@Bottom", StringComparison.Ordinal) ||
            !string.Equals(height.Dir, "out", StringComparison.OrdinalIgnoreCase) ||
            !HasExpectedSpanNames(length, slug, ".left", ".right") ||
            !HasExpectedSpanNames(width, slug, ".back", ".front") ||
            !string.Equals(height.Name, $"{slug}.top", StringComparison.Ordinal)) {
            solid = new FamilyModelSolid();
            return false;
        }

        solid = new FamilyModelSolid {
            Kind = prism.IsSolid ? FamilySolidKind.Prism : FamilySolidKind.VoidPrism,
            Frame = "frame:family",
            Width = length.By,
            Depth = width.By,
            Height = height.By
        };
        return true;
    }

    private static bool TryProjectCylinder(
        AuthoredCylinderSpec cylinder,
        out string slug,
        out FamilyModelSolid solid
    ) {
        slug = TryInferSlug(cylinder.Height.InlinePlane?.Name, ".top") ?? string.Empty;
        var height = cylinder.Height.InlinePlane;
        if (string.IsNullOrWhiteSpace(slug) ||
            !string.Equals(cylinder.On, "@Bottom", StringComparison.Ordinal) ||
            cylinder.Center.Count != 2 ||
            !cylinder.Center.Contains("@CenterLR", StringComparer.Ordinal) ||
            !cylinder.Center.Contains("@CenterFB", StringComparer.Ordinal) ||
            height == null ||
            !string.Equals(height.Name, $"{slug}.top", StringComparison.Ordinal) ||
            !string.Equals(height.From, "@Bottom", StringComparison.Ordinal) ||
            !string.Equals(height.Dir, "out", StringComparison.OrdinalIgnoreCase)) {
            solid = new FamilyModelSolid();
            return false;
        }

        solid = new FamilyModelSolid {
            Kind = cylinder.IsSolid ? FamilySolidKind.Cylinder : FamilySolidKind.VoidCylinder,
            Frame = "frame:family",
            Diameter = cylinder.Diameter.By,
            Height = height.By
        };
        return true;
    }

    private static bool HasExpectedSpanNames(
        AuthoredSpanSpec span,
        string slug,
        string negativeSuffix,
        string positiveSuffix
    ) =>
        string.Equals(span.Negative, slug + negativeSuffix, StringComparison.Ordinal) &&
        string.Equals(span.Positive, slug + positiveSuffix, StringComparison.Ordinal);

    private static string? TryInferSlug(string? name, string suffix) =>
        !string.IsNullOrWhiteSpace(name) && name.EndsWith(suffix, StringComparison.Ordinal)
            ? name[..^suffix.Length]
            : null;

    private static void AddSolid(
        IDictionary<string, FamilyModelSolid> solids,
        ICollection<FamilyModelUnmodeledFact> unmodeled,
        string slug,
        FamilyModelSolid solid
    ) {
        if (solids.TryAdd(slug, solid))
            return;

        AddUnmodeledSolid(unmodeled, slug, "duplicate-observable-solid-identity");
    }

    private static void AddUnmodeledSolid(
        ICollection<FamilyModelUnmodeledFact> unmodeled,
        string name,
        string reason
    ) => unmodeled.Add(new FamilyModelUnmodeledFact {
        Reason = reason,
        Path = "$.solids",
        Facts = new Dictionary<string, string>(StringComparer.Ordinal) { ["observedName"] = name }
    });

    private static string? ProjectDataType(ParameterSnapshot parameter) =>
        !string.IsNullOrWhiteSpace(parameter.DataTypeLabel)
            ? parameter.DataTypeLabel
            : string.IsNullOrWhiteSpace(parameter.DataTypeId)
                ? null
                : RevitLabelCatalog.GetLabelForSpec(parameter.DataType);

    private static string? ProjectPropertiesGroup(ParameterSnapshot parameter) =>
        !string.IsNullOrWhiteSpace(parameter.GroupTypeLabel)
            ? parameter.GroupTypeLabel
            : string.IsNullOrWhiteSpace(parameter.GroupTypeId)
                ? null
                : RevitLabelCatalog.GetLabelForPropertyGroup(parameter.PropertiesGroup);

    private sealed record ProjectedAssignment(string? UniformValue);
}
