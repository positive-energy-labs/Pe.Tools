using Pe.Shared.RevitData.Families;

namespace Pe.Shared.Tests;

[TestFixture]
public sealed class FamilyModelContractTests {
    private const string MinimalBoxJson = """
        {
          "family": {
            "name": "FF Minimal Box",
            "category": "Generic Models",
            "template": "Generic Model",
            "placement": "Unhosted"
          },
          "familyParameters": {
            "Width": { "dataType": "Length (Common)", "value": "12in" },
            "Depth": { "dataType": "Length (Common)", "value": "8in" },
            "Height": { "dataType": "Length (Common)", "value": "6in" }
          },
          "types": {
            "Default": {}
          },
          "solids": {
            "body": {
              "kind": "Prism",
              "frame": "frame:family",
              "width": "param:Width",
              "depth": "param:Depth",
              "height": "param:Height"
            }
          }
        }
        """;

    [Test]
    public void Minimal_box_is_a_valid_strict_hand_authored_contract() {
        var result = FamilyModelJson.Parse(MinimalBoxJson);

        Assert.That(result.Diagnostics, Is.Empty,
            string.Join(Environment.NewLine, result.Diagnostics.Select(item => item.Message)));
        Assert.That(result.Value, Is.Not.Null);
        Assert.That(result.Value!.Family.Name, Is.EqualTo("FF Minimal Box"));
        Assert.That(result.Value.FamilyParameters.Keys,
            Is.EqualTo(new[] { "Width", "Depth", "Height" }));
        Assert.That(result.Value.Solids["body"].Kind, Is.EqualTo(FamilySolidKind.Prism));
    }

    [Test]
    public void Formula_parameter_cannot_be_overridden_by_a_family_type() {
        var result = FamilyModelJson.Parse(
            MinimalBoxJson
                .Replace("\"Height\": { \"dataType\": \"Length (Common)\", \"value\": \"6in\" }",
                    "\"Height\": { \"dataType\": \"Length (Common)\", \"formula\": \"Width / 2\" }")
                .Replace("\"Default\": {}", "\"Default\": { \"Height\": \"5in\" }"));

        Assert.That(result.Diagnostics.Select(item => item.Code),
            Does.Contain(FamilyModelDiagnosticCodes.FormulaTypeOverride));
    }

    [TestCase("1/2in", PortableScalarKind.Length, 0.5)]
    [TestCase("-2.25ft", PortableScalarKind.Length, -2.25)]
    [TestCase("0deg", PortableScalarKind.Angle, 0.0)]
    public void Portable_scalars_parse_without_Revit_formatting(
        string text,
        PortableScalarKind expectedKind,
        double expectedValue
    ) {
        var parsed = PortableScalar.TryParse(text, out var scalar);

        Assert.That(parsed, Is.True);
        Assert.That(scalar.Kind, Is.EqualTo(expectedKind));
        Assert.That(scalar.Value, Is.EqualTo(expectedValue).Within(0.000001));
    }

    [Test]
    public void References_preserve_exact_parameter_names_and_split_named_faces() {
        Assert.That(PortableFamilyReference.TryParse("param:_conn size", out var parameter), Is.True);
        Assert.That(parameter.Kind, Is.EqualTo(PortableFamilyReferenceKind.Parameter));
        Assert.That(parameter.Target, Is.EqualTo("_conn size"));

        Assert.That(PortableFamilyReference.TryParse("face:body.Front", out var face), Is.True);
        Assert.That(face.Kind, Is.EqualTo(PortableFamilyReferenceKind.Face));
        Assert.That(face.Target, Is.EqualTo("body"));
        Assert.That(face.Member, Is.EqualTo("Front"));
    }

    [Test]
    public void Unknown_fields_fail_at_the_authored_boundary() {
        var result = FamilyModelJson.Parse(
            MinimalBoxJson.Replace("\"placement\": \"Unhosted\"", "\"placement\": \"Unhosted\", \"mystery\": true"));

        Assert.That(result.Value, Is.Null);
        Assert.That(result.Diagnostics.Select(item => item.Code),
            Does.Contain(FamilyModelDiagnosticCodes.InvalidJson));
    }

    [Test]
    public void Observable_unmodeled_state_is_an_honest_non_executable_contract() {
        var result = FamilyModelJson.Parse(MinimalBoxJson.Replace(
            "\"solids\": {",
            "\"unmodeled\": [{ \"reason\": \"unsupported-array\", \"path\": \"$.arrays\" }], \"solids\": {"));

        Assert.That(result.Value, Is.Not.Null);
        Assert.That(result.Diagnostics.Select(item => item.Code),
            Does.Contain(FamilyModelDiagnosticCodes.UnmodeledState));
    }

    [Test]
    public void Disabled_room_calculation_point_is_omission_not_another_mode() {
        var model = FamilyModelJson.Parse(MinimalBoxJson).Value!;
        var invalid = new FamilyModel {
            Family = model.Family,
            FamilyParameters = model.FamilyParameters,
            Types = model.Types,
            Solids = model.Solids,
            RoomCalculationPoint = new FamilyModelRoomCalculationPoint { Enabled = false }
        };

        Assert.That(FamilyModelValidator.Validate(invalid).Select(item => item.Code),
            Does.Contain(FamilyModelDiagnosticCodes.InvalidRoomCalculationPoint));
    }
}
