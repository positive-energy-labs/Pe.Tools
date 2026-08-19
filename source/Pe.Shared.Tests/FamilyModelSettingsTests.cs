using Pe.Shared.RevitData.Families;

namespace Pe.Shared.Tests;

/// <summary>
///     The family-global `settings` key set and the embedded `lookupTables` section, proved without Revit:
///     which keys exist, what each value may be, and what the schema refuses outright.
/// </summary>
/// <remarks>
///     The Revit side of these keys — which parameter each one writes, and whether Revit accepts the value —
///     is proved by the roundtrip fixtures in the fresh lane. What is proved here is the authored boundary:
///     an unknown key never reaches Revit at all.
/// </remarks>
[TestFixture]
public sealed class FamilyModelSettingsTests {
    private const string SettingsJson = """
        {
          "family": {
            "name": "FF Settings Probe",
            "category": "Generic Models",
            "template": "Generic Model",
            "placement": "Unhosted"
          },
          "familyParameters": {
            "Width": { "dataType": "Length (Common)", "value": "12in" }
          },
          "types": { "Default": {} },
          "solids": {
            "body": {
              "kind": "Prism",
              "frame": "frame:family",
              "width": "param:Width",
              "depth": "param:Width",
              "height": "param:Width"
            }
          },
          "settings": {
            "alwaysVertical": false,
            "shared": true,
            "cutWithVoidsWhenLoaded": true,
            "partType": "MultiPort",
            "omniClass": "23.80.20.11.14"
          },
          "lookupTables": {
            "FF Sizes": { "csv": ",Width##length##feet\nSmall,1\nLarge,2\n" }
          },
          "roomCalculationPoint": { "enabled": true, "offset": "2ft" }
        }
        """;

    [Test]
    public void The_closed_settings_key_set_parses_into_typed_values() {
        var result = FamilyModelJson.Parse(SettingsJson);

        Assert.That(result.Diagnostics, Is.Empty,
            string.Join(Environment.NewLine, result.Diagnostics.Select(item => item.Message)));
        var settings = result.Value!.Settings!;
        Assert.That(settings.AlwaysVertical, Is.False);
        Assert.That(settings.Shared, Is.True);
        Assert.That(settings.CutWithVoidsWhenLoaded, Is.True);
        Assert.That(settings.PartType, Is.EqualTo(FamilyPartType.MultiPort));
        Assert.That(settings.OmniClass, Is.EqualTo("23.80.20.11.14"));
        Assert.That(result.Value.RoomCalculationPoint!.Offset, Is.EqualTo("2ft"));
        Assert.That(result.Value.LookupTables["FF Sizes"].Csv, Does.Contain("Width##length##feet"));
    }

    [TestCase("\"alwaysVertical\": false", "\"cutsWithVoids\": false", TestName = "unknown settings key")]
    [TestCase("\"partType\": \"MultiPort\"", "\"partType\": \"Sideways\"", TestName = "unknown part type")]
    public void The_key_set_and_the_part_type_vocabulary_are_both_closed(string authored, string replacement) {
        var result = FamilyModelJson.Parse(SettingsJson.Replace(authored, replacement));

        Assert.That(result.Value, Is.Null);
        Assert.That(result.Diagnostics.Select(item => item.Code),
            Does.Contain(FamilyModelDiagnosticCodes.InvalidJson));
    }

    [TestCase("\"23-80-20\"")]
    [TestCase("\"Air Terminals\"")]
    public void An_OmniClass_number_must_be_a_dotted_number_sequence(string replacement) {
        var result = FamilyModelJson.Parse(SettingsJson.Replace("\"23.80.20.11.14\"", replacement));

        Assert.That(result.Diagnostics.Select(item => item.Code),
            Does.Contain(FamilyModelDiagnosticCodes.InvalidSettings));
    }

    [Test]
    public void A_room_calculation_point_offset_is_a_literal_because_an_element_position_cannot_follow_a_parameter() {
        var result = FamilyModelJson.Parse(SettingsJson.Replace("\"offset\": \"2ft\"", "\"offset\": \"param:Width\""));

        Assert.That(result.Diagnostics.Select(item => item.Code),
            Does.Contain(FamilyModelDiagnosticCodes.InvalidRoomCalculationPoint));
    }

    [TestCase("\"csv\": \",Width##length##feet\\nSmall,1\\nLarge,2\\n\"", "\"csv\": \"\"")]
    [TestCase("\"csv\": \",Width##length##feet\\nSmall,1\\nLarge,2\\n\"", "\"csv\": \",Width##length##feet\\n\"")]
    public void A_lookup_table_needs_a_header_row_and_a_data_row(string authored, string replacement) {
        var result = FamilyModelJson.Parse(SettingsJson.Replace(authored, replacement));

        Assert.That(result.Diagnostics.Select(item => item.Code),
            Does.Contain(FamilyModelDiagnosticCodes.InvalidLookupTable));
    }

    /// <summary>
    ///     `WallHosted` is a first-class placement, not a reserved enum member: the authored boundary accepts
    ///     it, and the template name rides in the document as it does for every other placement. Which stock
    ///     template that name resolves to, and what Revit reports back, is proved in the fresh lane by the
    ///     wall-hosted roundtrip fixture.
    /// </summary>
    [Test]
    public void A_wall_hosted_family_is_authorable_with_its_own_template_name() {
        var result = FamilyModelJson.Parse(SettingsJson
            .Replace("\"category\": \"Generic Models\"", "\"category\": \"Plumbing Fixtures\"")
            .Replace("\"template\": \"Generic Model\"", "\"template\": \"Plumbing Fixture wall based\"")
            .Replace("\"placement\": \"Unhosted\"", "\"placement\": \"WallHosted\""));

        Assert.That(result.Diagnostics, Is.Empty,
            string.Join(Environment.NewLine, result.Diagnostics.Select(item => item.Message)));
        Assert.That(result.Value!.Family.Placement, Is.EqualTo(FamilyModelPlacement.WallHosted));
        Assert.That(result.Value.Family.Template, Is.EqualTo("Plumbing Fixture wall based"));
    }

    [Test]
    public void An_unknown_placement_is_refused_at_the_authored_boundary() {
        var result = FamilyModelJson.Parse(SettingsJson.Replace("\"placement\": \"Unhosted\"",
            "\"placement\": \"CeilingHosted\""));

        Assert.That(result.Value, Is.Null);
        Assert.That(result.Diagnostics.Select(item => item.Code),
            Does.Contain(FamilyModelDiagnosticCodes.InvalidJson));
    }

    [Test]
    public void Omitting_a_section_says_nothing_rather_than_asserting_a_Revit_default() {
        var result = FamilyModelJson.Parse(
            SettingsJson[..SettingsJson.IndexOf("  \"settings\"", StringComparison.Ordinal)].TrimEnd(' ', '\n', '\r', ',') +
            "\n}");

        Assert.That(result.Diagnostics, Is.Empty,
            string.Join(Environment.NewLine, result.Diagnostics.Select(item => item.Message)));
        Assert.That(result.Value!.Settings, Is.Null);
        Assert.That(result.Value.LookupTables, Is.Empty);
        Assert.That(result.Value.RoomCalculationPoint, Is.Null);
    }
}
