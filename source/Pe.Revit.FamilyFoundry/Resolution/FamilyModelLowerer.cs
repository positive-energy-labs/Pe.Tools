using Newtonsoft.Json.Linq;
using Pe.Revit.FamilyFoundry.DesiredState;
using Pe.Revit.FamilyFoundry.Profiles;
using Pe.Revit.FamilyFoundry.LookupTables;
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
    private const string BuiltInFamilyFrame = "frame:family";

    /// <summary>The room-calculation-point offset is a literal by contract, so no parameter table applies.</summary>
    private static readonly Dictionary<string, double> EmptyParameterValues = new(StringComparer.Ordinal);

    public static FamilyModelLoweringResult Lower(FamilyModel model) {
        var diagnostics = FamilyModelValidator.Validate(model);
        if (diagnostics.Count != 0)
            return new FamilyModelLoweringResult(null, [], diagnostics);

        var refusals = RefuseWhatTheLegacyPlanCannotExpress(model);
        if (refusals.Count != 0)
            return new FamilyModelLoweringResult(null, [], refusals);

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
                // SourceNames are plain string names today; keep this boundary structured so source
                // references can later carry optional metadata (for example, data type) without breaking the authored model.
                SourceNames = pair.Value.MappedFrom.ToList()
            }).ToList(),
            PerTypeAssignmentsTable = LowerTypeAssignments(model),
            ParamDrivenSolids = LowerParamDrivenSolids(model),
            SetLookupTables = LowerLookupTables(model, out var lookupTableDiagnostics),
            AddRoomDingler = new AddRoomDinglerSettings {
                Enabled = model.RoomCalculationPoint?.Enabled == true,
                // The offset is an element position, so it is resolved to feet once, here — the one length
                // law in FamilyModelEvaluatorConventions, not a second unit table.
                OffsetFeet = model.RoomCalculationPoint?.Offset is { } offset
                    ? FamilyModelEvaluatorConventions.ResolveLengthFeet(offset, EmptyParameterValues)
                    : 1.0
            }
        };

        if (lookupTableDiagnostics.Count != 0)
            return new FamilyModelLoweringResult(null, [], lookupTableDiagnostics);

        // Empty types are real authored state. Keep their names beside the lowered profile instead of inventing a
        // fake parameter assignment merely because the legacy CreateFamilyTypes operation discovers types by columns.
        return new FamilyModelLoweringResult(profile, model.Types.Keys.ToList(), []);
    }

    /// <summary>
    ///     A typed refusal, never a silent approximation. The portable contract carries frame trees and the
    ///     `rotation` clause; the legacy ParamDrivenSolids plan below this seam does not.
    /// </summary>
    /// <remarks>
    ///     What the legacy plan cannot express: an extrusion sketch is authored as spans about the fixed
    ///     `@CenterLR` / `@CenterFB` anchors on `@Bottom` (<see cref="AuthoredPrismSpec" />,
    ///     <see cref="AuthoredCylinderSpec" />), so every solid is centered on the family frame and rises
    ///     along +Z; those two specs are also the whole sketch vocabulary — a rectangle or a circle, with no
    ///     list of sketch lines for an arbitrary profile; and <see cref="AuthoredConnectorSpec" /> carries
    ///     `FrameNormal` / `FrameUp` axis TOKENS, so a connector frame can only be axis-aligned. None of them
    ///     has a place to put a turned sketch plane or a polygon ring. Lifting this needs new geometry in the
    ///     plan itself — it is not a mapping problem.
    /// </remarks>
    private static List<FamilyModelDiagnostic> RefuseWhatTheLegacyPlanCannotExpress(FamilyModel model) {
        var refusals = new List<FamilyModelDiagnostic>();
        foreach (var pair in model.Solids.Where(pair => pair.Value.Frame != BuiltInFamilyFrame)) {
            refusals.Add(new FamilyModelDiagnostic(
                FamilyModelDiagnosticCodes.UnsupportedFrame,
                $"$.solids.{pair.Key}.frame",
                $"Solid '{pair.Key}' sits on '{pair.Value.Frame}'; the legacy plan anchors every extrusion " +
                "sketch on @CenterLR/@CenterFB/@Bottom and cannot place a solid on another frame."));
        }

        foreach (var pair in model.NestedFamilies.Where(pair => pair.Value.Frame != BuiltInFamilyFrame)) {
            refusals.Add(new FamilyModelDiagnostic(
                FamilyModelDiagnosticCodes.UnsupportedFrame,
                $"$.nestedFamilies.{pair.Key}.frame",
                $"Nested family '{pair.Key}' sits on '{pair.Value.Frame}'; the legacy plan places nested " +
                "instances centered on the family frame only."));
        }

        foreach (var pair in model.Solids.Where(pair =>
                     pair.Value.Kind is FamilySolidKind.ExtrudedPolygon or FamilySolidKind.VoidExtrudedPolygon)) {
            refusals.Add(new FamilyModelDiagnostic(
                FamilyModelDiagnosticCodes.UnsupportedSolidKind,
                $"$.solids.{pair.Key}.kind",
                $"Solid '{pair.Key}' is a {pair.Value.Kind}; the legacy plan authors a rectangle from two " +
                "symmetric span pairs or a circle from a centre and a diameter, and has no way to carry an " +
                "arbitrary ring of sketch lines."));
        }

        if (model.Family.Placement == FamilyModelPlacement.WallHosted && model.Solids.Count > 0) {
            refusals.Add(new FamilyModelDiagnostic(
                FamilyModelDiagnosticCodes.UnsupportedPlacementGeometry,
                "$.solids",
                $"'{model.Family.Name}' is WallHosted and authors {model.Solids.Count} solid(s); the legacy " +
                "plan centres a solid's depth on 'Center (Front/Back)', and a stock wall-based template has " +
                "no such plane — it exposes 'Center (Left/Right)', 'Back' (the wall face) and " +
                "'Reference Plane' only. Anchoring depth one-sided on the wall face is the missing piece."));
        }

        foreach (var pair in model.Frames.Where(pair => pair.Value.Rotation != null)) {
            refusals.Add(new FamilyModelDiagnostic(
                FamilyModelDiagnosticCodes.UnsupportedFrame,
                $"$.frames.{pair.Key}.rotation",
                $"Frame '{pair.Key}' is rotated about '{pair.Value.Rotation!.About}'; the legacy plan carries " +
                "axis tokens only and has no rotated sketch plane."));
        }

        return refusals;
    }

    /// <summary>
    ///     Decodes each authored CSV through the ONE codec, `LookupTableCsvCodec`, and hands the decoded
    ///     tables to the existing `SetLookupTables` operation. A CSV Revit could not read fails here, at
    ///     lowering, with the table named — not inside a Revit import error three steps later.
    /// </summary>
    /// <remarks>
    ///     The lookup-key count a formula implies is not recoverable from the CSV alone, and the portable
    ///     document does not carry it: `size_lookup(...)` formulas name their own keys, and capture infers
    ///     the count from those formulas (`LookupFormulaInspector`). Lowering therefore decodes with a key
    ///     count of zero, which changes column ROLES only, never the bytes Revit imports.
    /// </remarks>
    private static SetLookupTablesSettings LowerLookupTables(
        FamilyModel model,
        out List<FamilyModelDiagnostic> diagnostics
    ) {
        diagnostics = [];
        var tables = new List<LookupTableDefinition>();
        foreach (var pair in model.LookupTables) {
            try {
                var table = LookupTableCsvCodec.Decode(pair.Key, pair.Value.Csv);
                LookupTableValidator.Validate(table);
                tables.Add(table);
            } catch (Exception exception) when (exception is InvalidOperationException or ArgumentException) {
                diagnostics.Add(new FamilyModelDiagnostic(
                    FamilyModelDiagnosticCodes.InvalidLookupTable,
                    $"$.lookupTables.{pair.Key}.csv",
                    exception.Message));
            }
        }

        return new SetLookupTablesSettings { Tables = tables };
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
