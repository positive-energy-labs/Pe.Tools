using Newtonsoft.Json.Linq;
using Pe.Revit.FamilyFoundry.DesiredState;
using Pe.Revit.FamilyFoundry.Profiles;
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
                Value = pair.Value.Value,
                Formula = pair.Value.Formula
            }).ToList(),
            SharedParameters = model.SharedParameters.Select(pair => new DesiredSharedParameterDeclaration {
                Name = pair.Key,
                PropertiesGroup = pair.Value.PropertiesGroup,
                IsInstance = pair.Value.IsInstance,
                Value = pair.Value.Value,
                Formula = pair.Value.Formula,
                SourceNames = pair.Value.MappedFrom.ToList()
            }).ToList(),
            PerTypeAssignmentsTable = LowerTypeAssignments(model),
            ParamDrivenSolids = LowerSolids(model.Solids)
        };

        // Empty types are real authored state. Keep their names beside the lowered profile instead of inventing a
        // fake parameter assignment merely because the legacy CreateFamilyTypes operation discovers types by columns.
        return new FamilyModelLoweringResult(profile, model.Types.Keys.ToList(), []);
    }

    private static List<DesiredPerTypeAssignmentRow> LowerTypeAssignments(FamilyModel model) {
        var valuesByParameter = new Dictionary<string, IDictionary<string, JToken>>(StringComparer.Ordinal);
        foreach (var type in model.Types) {
            foreach (var assignment in type.Value) {
                if (!valuesByParameter.TryGetValue(assignment.Key, out var values)) {
                    values = new Dictionary<string, JToken>(StringComparer.Ordinal);
                    valuesByParameter.Add(assignment.Key, values);
                }

                values.Add(type.Key, JToken.FromObject(assignment.Value));
            }
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

    private static AuthoredParamDrivenSolidsSettings LowerSolids(
        IReadOnlyDictionary<string, FamilyModelSolid> solids
    ) {
        var prisms = new List<AuthoredPrismSpec>();
        var cylinders = new List<AuthoredCylinderSpec>();

        foreach (var pair in solids) {
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
            Prisms = prisms,
            Cylinders = cylinders
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
