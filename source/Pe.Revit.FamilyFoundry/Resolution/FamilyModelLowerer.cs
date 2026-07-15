using Newtonsoft.Json.Linq;
using Pe.Revit.FamilyFoundry.DesiredState;
using Pe.Revit.FamilyFoundry.Profiles;
using Pe.Revit.FamilyFoundry.Operations;
using Pe.Shared.RevitData.Families;
using System.Globalization;

namespace Pe.Revit.FamilyFoundry.Resolution;

public sealed record FamilyModelLoweringResult(
    FFManagerProfile? Profile,
    IReadOnlyList<string> FamilyTypeNames,
    IReadOnlyList<FamilyModelDiagnostic> Diagnostics
);

/// <summary>
///     Adapts the portable Family Model to the existing Family Foundry execution seam. The old profile is a
///     compiled detail here, not a second authored language.
/// </summary>
public static class FamilyModelLowerer {
    public static FamilyModelLoweringResult Lower(FamilyModel model) {
        var diagnostics = FamilyModelValidator.Validate(model);
        if (diagnostics.Count != 0)
            return new FamilyModelLoweringResult(null, [], diagnostics);

        var profile = new FFManagerProfile {
            FamilyParameters = model.FamilyParameters.Select(pair => new DesiredFamilyParameterDeclaration {
                Name = pair.Key,
                DataType = pair.Value.DataType,
                Tooltip = pair.Value.Tooltip,
                PropertiesGroup = pair.Value.PropertiesGroup,
                IsInstance = pair.Value.IsInstance,
                Value = HasTypeOverrides(model, pair.Key) ? null : pair.Value.Value,
                Formula = pair.Value.Formula
            }).ToList(),
            SharedParameters = model.SharedParameters.Select(pair => new DesiredSharedParameterDeclaration {
                Name = pair.Key,
                PropertiesGroup = pair.Value.PropertiesGroup,
                IsInstance = pair.Value.IsInstance,
                Value = HasTypeOverrides(model, pair.Key) ? null : pair.Value.Value,
                Formula = pair.Value.Formula,
                SourceNames = pair.Value.MappedFrom.ToList()
            }).ToList(),
            PerTypeAssignmentsTable = LowerTypeAssignments(model),
            ParamDrivenSolids = LowerParamDrivenSolids(model),
            AddRoomDingler = new AddRoomDinglerSettings {
                Enabled = model.RoomCalculationPoint?.Enabled == true
            }
        };

        // Empty types are real authored state. Keep their names beside the lowered profile instead of inventing a
        // fake parameter assignment merely because the legacy CreateFamilyTypes operation discovers types by columns.
        return new FamilyModelLoweringResult(profile, model.Types.Keys.ToList(), []);
    }

    private static List<DesiredPerTypeAssignmentRow> LowerTypeAssignments(FamilyModel model) {
        var valuesByParameter = new Dictionary<string, IDictionary<string, JToken>>(StringComparer.Ordinal);
        var parameters = model.FamilyParameters
            .Select(pair => new KeyValuePair<string, FamilyModelParameter>(pair.Key, pair.Value))
            .Concat(model.SharedParameters.Select(pair =>
                new KeyValuePair<string, FamilyModelParameter>(pair.Key, pair.Value)))
            .ToDictionary(pair => pair.Key, pair => pair.Value, StringComparer.Ordinal);

        foreach (var parameter in parameters.Where(pair => HasTypeOverrides(model, pair.Key))) {
            var values = new Dictionary<string, JToken>(StringComparer.Ordinal);
            foreach (var type in model.Types) {
                if (type.Value.TryGetValue(parameter.Key, out var overrideValue))
                    values[type.Key] = JToken.FromObject(overrideValue);
                else if (parameter.Value.Value != null)
                    values[type.Key] = JToken.FromObject(parameter.Value.Value);
            }

            valuesByParameter[parameter.Key] = values;
        }

        return model.FamilyParameters.Keys
            .Concat(model.SharedParameters.Keys)
            .Where(valuesByParameter.ContainsKey)
            .Select(parameterName => new DesiredPerTypeAssignmentRow {
                Parameter = parameterName,
                ValuesByType = valuesByParameter[parameterName]
            })
            .ToList();
    }

    private static bool HasTypeOverrides(FamilyModel model, string parameterName) =>
        model.Types.Values.Any(values => values.ContainsKey(parameterName));

    private static AuthoredParamDrivenSolidsSettings LowerParamDrivenSolids(FamilyModel model) {
        var prisms = new List<AuthoredPrismSpec>();
        var cylinders = new List<AuthoredCylinderSpec>();

        foreach (var pair in model.Solids) {
            var slug = pair.Key;
            var solid = pair.Value;
            if (solid.Kind is FamilySolidKind.Prism or FamilySolidKind.VoidPrism) {
                prisms.Add(new AuthoredPrismSpec {
                    // The slug, not Label, drives generated Revit plane names. That is the only observable identity
                    // capture can recover without prohibited hidden metadata.
                    Name = slug,
                    IsSolid = solid.Kind == FamilySolidKind.Prism,
                    On = "@Bottom",
                    Length = SymmetricSpan("@CenterLR", NormalizeLengthDriver(solid.Width!),
                        $"{slug}.left", $"{slug}.right"),
                    Width = SymmetricSpan("@CenterFB", NormalizeLengthDriver(solid.Depth!),
                        $"{slug}.back", $"{slug}.front"),
                    Height = PositiveHeight(slug, NormalizeLengthDriver(solid.Height!))
                });
                continue;
            }

            cylinders.Add(new AuthoredCylinderSpec {
                Name = slug,
                IsSolid = solid.Kind == FamilySolidKind.Cylinder,
                On = "@Bottom",
                Center = ["@CenterLR", "@CenterFB"],
                Diameter = new AuthoredMeasureSpec { By = NormalizeLengthDriver(solid.Diameter!) },
                Height = PositiveHeight(slug, NormalizeLengthDriver(solid.Height!))
            });
        }

        return new AuthoredParamDrivenSolidsSettings {
            Frame = ParamDrivenFamilyFrameKind.NonHosted,
            Planes = model.Planes.ToDictionary(
                pair => pair.Key,
                pair => new AuthoredPlaneSpec {
                    From = ResolvePlaneReference(pair.Value.From),
                    By = NormalizeLengthDriver(pair.Value.By),
                    Dir = pair.Value.Direction == FamilyModelOffsetDirection.Out ? "out" : "in"
                },
                StringComparer.Ordinal),
            Prisms = prisms,
            Cylinders = cylinders,
            Connectors = LowerConnectors(model)
        };
    }

    private static List<AuthoredConnectorSpec> LowerConnectors(FamilyModel model) => model.Connectors
        .Select(pair => {
            var slug = pair.Key;
            var connector = pair.Value;
            _ = PortableFamilyReference.TryParse(connector.Frame, out var frameReference);
            var frame = model.Frames[frameReference.Target];
            var origin = frame.Origin.Select(ResolvePlaneReference).ToList();
            var bindings = connector.ParameterBindings.Select(binding => {
                _ = Enum.TryParse<ConnectorParameterKey>(binding.Key, out var target);
                _ = PortableFamilyReference.TryParse(binding.Value, out var source);
                return new ConnectorBindingSpec { Target = target, SourceParameter = source.Target };
            }).ToList();

            return new AuthoredConnectorSpec {
                // Logical connector slugs are written into observable connector/stub names so capture can recover
                // identity without IDs or Family Foundry metadata. Label remains display-only.
                Name = slug,
                FrameNormal = frame.Normal,
                FrameUp = frame.Up,
                Domain = connector.Domain switch {
                    FamilyConnectorDomain.Duct => ParamDrivenConnectorDomain.Duct,
                    FamilyConnectorDomain.Pipe => ParamDrivenConnectorDomain.Pipe,
                    FamilyConnectorDomain.Electrical => ParamDrivenConnectorDomain.Electrical,
                    _ => throw new ArgumentOutOfRangeException()
                },
                Face = origin[0],
                Depth = new AuthoredDepthSpec {
                    By = NormalizeLengthDriver(connector.Stub.Depth),
                    Dir = connector.Stub.Direction == FamilyModelOffsetDirection.Out ? "out" : "in"
                },
                IsSolid = connector.Stub.IsSolid ?? true,
                Round = connector.Shape == FamilyConnectorShape.Round
                    ? new AuthoredRoundConnectorGeometrySpec {
                        Center = origin.Skip(1).ToList(),
                        Diameter = new AuthoredMeasureSpec { By = NormalizeLengthDriver(connector.Diameter!) }
                    }
                    : null,
                Rect = connector.Shape == FamilyConnectorShape.Rectangular
                    ? new AuthoredRectConnectorGeometrySpec {
                        Center = origin.Skip(1).ToList(),
                        Width = new AuthoredCenterMeasureSpec {
                            About = origin[1], By = NormalizeLengthDriver(connector.Width!)
                        },
                        Length = new AuthoredCenterMeasureSpec {
                            About = origin[2], By = NormalizeLengthDriver(connector.Height!)
                        }
                    }
                    : null,
                Bindings = new ConnectorBindingsSpec { Parameters = bindings },
                Config = new AuthoredConnectorConfigSpec {
                    SystemType = connector.SystemType,
                    FlowDirection = connector.FlowDirection ?? DefaultFlowDirection(connector.Domain),
                    FlowConfiguration = connector.FlowConfiguration ?? "Preset",
                    LossMethod = connector.LossMethod ?? "NotDefined"
                }
            };
        })
        .ToList();

    private static string DefaultFlowDirection(FamilyConnectorDomain domain) => domain switch {
        FamilyConnectorDomain.Duct => "Out",
        FamilyConnectorDomain.Pipe => "Bidirectional",
        FamilyConnectorDomain.Electrical => string.Empty,
        _ => throw new ArgumentOutOfRangeException(nameof(domain), domain, null)
    };

    private static string ResolvePlaneReference(string referenceText) {
        _ = PortableFamilyReference.TryParse(referenceText, out var reference);
        if (reference.Kind == PortableFamilyReferenceKind.Plane) {
            if (!reference.Target.StartsWith("family.", StringComparison.Ordinal))
                return $"plane:{reference.Target}";

            return reference.Target["family.".Length..] switch {
                "CenterLR" => "@CenterLR",
                "CenterFB" => "@CenterFB",
                "Bottom" => "@Bottom",
                "Top" => "@Top",
                "Left" => "@Left",
                "Right" => "@Right",
                "Front" => "@Front",
                "Back" => "@Back",
                var member => throw new InvalidOperationException($"Unknown family plane '{member}'.")
            };
        }

        return reference.Member switch {
            "Bottom" => "@Bottom",
            "Top" => $"plane:{reference.Target}.top",
            "Left" => $"plane:{reference.Target}.left",
            "Right" => $"plane:{reference.Target}.right",
            "Front" => $"plane:{reference.Target}.front",
            "Back" => $"plane:{reference.Target}.back",
            _ => throw new InvalidOperationException($"Solid face '{referenceText}' is not planar in v1.")
        };
    }

    private static PlanePairOrInlineSpanSpec SymmetricSpan(
        string about,
        string by,
        string negative,
        string positive
    ) => new() {
        InlineSpan = new AuthoredSpanSpec {
            About = about,
            By = by,
            Negative = negative,
            Positive = positive
        }
    };

    private static PlaneRefOrInlinePlaneSpec PositiveHeight(string slug, string by) => new() {
        InlinePlane = new AuthoredNamedPlaneSpec {
            Name = $"{slug}.top",
            From = "@Bottom",
            By = by,
            Dir = "out"
        }
    };

    private static string NormalizeLengthDriver(string driver) {
        if (PortableFamilyReference.TryParse(driver, out _))
            return driver;

        _ = PortableScalar.TryParse(driver, out var scalar);
        var inches = scalar.Unit switch {
            "in" => scalar.Value,
            "ft" => scalar.Value * 12.0,
            "mm" => scalar.Value / 25.4,
            "cm" => scalar.Value / 2.54,
            "m" => scalar.Value / 0.0254,
            _ => throw new InvalidOperationException($"Unsupported portable length unit '{scalar.Unit}'.")
        };
        return $"{Math.Round(inches, 12).ToString("0.############", CultureInfo.InvariantCulture)}in";
    }
}
