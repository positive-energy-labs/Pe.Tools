using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using Pe.Revit.FamilyFoundry;
using Pe.Revit.FamilyFoundry.Profiles;
using Pe.Revit.FamilyFoundry.Resolution;
using Pe.Revit.SettingsRuntime.Json;
using Pe.Shared.StorageRuntime.Capabilities;

namespace Pe.Revit.Tests;

[TestFixture]
public sealed class ParamDrivenSolidsJsonContractTests {
    [Test]
    public void Plane_ref_or_inline_plane_schema_accepts_flattened_inline_plane_object() =>
        AssertSchemaAndJsonRoundTrip<PlaneRefOrInlinePlaneSpec>(
            """
            {
              "Name": "Basin Top",
              "From": "@Bottom",
              "By": "param:Height",
              "Dir": "out"
            }
            """);

    [Test]
    public void Plane_ref_or_inline_plane_schema_accepts_flattened_end_offset_object() =>
        AssertSchemaAndJsonRoundTrip<PlaneRefOrInlinePlaneSpec>(
            """
            {
              "By": "param:CoverThickness",
              "Dir": "out"
            }
            """);

    [Test]
    public void Plane_pair_or_inline_span_schema_accepts_inline_span_object() =>
        AssertSchemaAndJsonRoundTrip<PlanePairOrInlineSpanSpec>(
            """
            {
              "About": "@CenterFB",
              "By": "param:Width",
              "Negative": "Back",
              "Positive": "Front"
            }
            """);

    [Test]
    public void Plane_pair_or_inline_span_schema_accepts_plane_ref_array() =>
        AssertSchemaAndJsonRoundTrip<PlanePairOrInlineSpanSpec>(
            """
            [
              "plane:Left",
              "plane:Right"
            ]
            """);

    [Test]
    public void Profile_schema_accepts_flattened_inline_cylinder_height_object() {
        var contract = SettingsJsonContract.ValidateAndRoundTrip<FFManagerProfile>(
            """
            {
              "ParamDrivenSolids": {
                "Frame": "NonHosted",
                "Planes": {},
                "Spans": [],
                "Prisms": [],
                "Cylinders": [
                  {
                    "Name": "Basin",
                    "On": "@Bottom",
                    "Center": ["@CenterLR", "@CenterFB"],
                    "Diameter": { "By": "param:Diameter" },
                    "Height": {
                      "Name": "Basin Top",
                      "From": "@Bottom",
                      "By": "param:Height",
                      "Dir": "out"
                    }
                  }
                ],
                "Connectors": []
              }
            }
            """,
            "flattened-inline-cylinder-height.json");

        var compiled = AuthoredParamDrivenSolidsCompiler.Compile(contract.Value.ParamDrivenSolids);
        Assert.That(compiled.CanExecute, Is.True,
            string.Join(Environment.NewLine, compiled.Diagnostics.Select(d => d.ToDisplayMessage())));
    }

    [Test]
    public void Profile_schema_accepts_flattened_end_offset_cylinder_height_object() {
        var contract = SettingsJsonContract.ValidateAndRoundTrip<FFManagerProfile>(
            """
            {
              "ParamDrivenSolids": {
                "Frame": "NonHosted",
                "Planes": {},
                "Spans": [],
                "Prisms": [],
                "Cylinders": [
                  {
                    "Name": "Cover",
                    "On": "@Bottom",
                    "Center": ["@CenterLR", "@CenterFB"],
                    "Diameter": { "By": "param:Diameter" },
                    "Height": {
                      "By": "param:CoverThickness",
                      "Dir": "out"
                    }
                  }
                ],
                "Connectors": []
              }
            }
            """,
            "flattened-end-offset-cylinder-height.json");

        var compiled = AuthoredParamDrivenSolidsCompiler.Compile(contract.Value.ParamDrivenSolids);
        Assert.That(compiled.CanExecute, Is.True,
            string.Join(Environment.NewLine, compiled.Diagnostics.Select(d => d.ToDisplayMessage())));
    }

    [Test]
    public void Profile_schema_accepts_flattened_inline_span_object() {
        var contract = SettingsJsonContract.ValidateAndRoundTrip<FFManagerProfile>(
            """
            {
              "ParamDrivenSolids": {
                "Frame": "NonHosted",
                "Planes": {},
                "Spans": [],
                "Prisms": [
                  {
                    "Name": "Cabinet",
                    "On": "@Bottom",
                    "Width": {
                      "About": "@CenterFB",
                      "By": "param:Width",
                      "Negative": "Cabinet Back",
                      "Positive": "Cabinet Front"
                    },
                    "Length": {
                      "About": "@CenterLR",
                      "By": "param:Length",
                      "Negative": "Cabinet Left",
                      "Positive": "Cabinet Right"
                    },
                    "Height": {
                      "Name": "Cabinet Top",
                      "From": "@Bottom",
                      "By": "param:Height",
                      "Dir": "out"
                    }
                  }
                ],
                "Cylinders": [],
                "Connectors": []
              }
            }
            """,
            "flattened-inline-span.json");

        var compiled = AuthoredParamDrivenSolidsCompiler.Compile(contract.Value.ParamDrivenSolids);
        Assert.That(compiled.CanExecute, Is.True,
            string.Join(Environment.NewLine, compiled.Diagnostics.Select(d => d.ToDisplayMessage())));
    }

    [TestCaseSource(nameof(GetProfileFixtureNames))]
    public void Profile_fixtures_validate_roundtrip_and_compile_param_driven_solids(string fixtureFileName) {
        var contract = RevitFamilyFixtureHarness.LoadProfileFixtureContract(fixtureFileName);
        var compiled = AuthoredParamDrivenSolidsCompiler.Compile(contract.Value.ParamDrivenSolids);

        Assert.That(contract.CanonicalJson, Is.Not.Empty);
        Assert.That(compiled.CanExecute, Is.True,
            string.Join(Environment.NewLine, compiled.Diagnostics.Select(d => d.ToDisplayMessage())));
    }

    [TestCase("DataType", "\"DataType\": \"Text\"")]
    [TestCase("Tooltip", "\"Tooltip\": \"Shared tooltip cannot be authored.\"")]
    [TestCase("SharedGuid", "\"SharedGuid\": \"11111111-1111-1111-1111-111111111111\"")]
    [TestCase("Identity", "\"Identity\": { \"Key\": \"shared:11111111-1111-1111-1111-111111111111\" }")]
    public void Profile_schema_rejects_shared_parameter_non_authored_fields(string fieldName, string fieldJson) {
        var json = $$"""
                   {
                     "SharedParameters": [
                       {
                         "Name": "PE_FF_TestSharedValue",
                         {{fieldJson}},
                         "Value": "shared-ok"
                       }
                     ]
                   }
                   """;

        AssertProfileValidationRejects(json, $"shared-parameter-{fieldName}.json", fieldName);
    }

    [Test]
    public void Profile_schema_accepts_family_parameter_datatype_tooltip_and_per_type_table() {
        var contract = SettingsJsonContract.ValidateAndRoundTrip<FFManagerProfile>(
            """
            {
              "FamilyParameters": [
                {
                  "Name": "Desired Width",
                  "DataType": "Length (Common)",
                  "PropertiesGroup": "Dimensions",
                  "IsInstance": false,
                  "Tooltip": "Target width authored as desired state."
                }
              ],
              "PerTypeAssignmentsTable": [
                {
                  "Parameter": "Desired Width",
                  "Small": "3' - 0\"",
                  "Large": "4' - 0\""
                }
              ]
            }
            """,
            "family-parameter-datatype-tooltip-per-type-table.json");

        Assert.That(contract.Value.FamilyParameters, Has.Count.EqualTo(1));
        Assert.That(contract.Value.FamilyParameters[0].DataType, Is.EqualTo("Length (Common)"));
        Assert.That(contract.Value.FamilyParameters[0].Tooltip, Is.EqualTo("Target width authored as desired state."));
        Assert.That(contract.Value.PerTypeAssignmentsTable, Has.Count.EqualTo(1));
        Assert.That(contract.CanonicalJson, Does.Contain("\"PerTypeAssignmentsTable\""));
    }

    [Test]
    public void Profile_schema_rejects_inline_parameter_per_type_values() {
        AssertProfileValidationRejects(
            """
            {
              "FamilyParameters": [
                {
                  "Name": "Desired Width",
                  "DataType": "Length (Common)",
                  "ValuesPerType": {
                    "Small": "3' - 0\"",
                    "Large": "4' - 0\""
                  }
                }
              ]
            }
            """,
            "inline-family-parameter-values-per-type.json",
            "ValuesPerType");
    }

    [Test]
    public void PeGrd_base_profile_validates_roundtrip_and_compiles_param_driven_spans() {
        var contract = RevitFamilyFixtureHarness.LoadProfileFixtureContract("pe-grd-base.json");
        var compiled = AuthoredParamDrivenSolidsCompiler.Compile(contract.Value.ParamDrivenSolids);

        Assert.That(contract.CanonicalJson, Is.Not.Empty);
        Assert.That(contract.Value.ParamDrivenSolids.Spans, Has.Count.EqualTo(6));
        Assert.That(compiled.CanExecute, Is.True,
            string.Join(Environment.NewLine, compiled.Diagnostics.Select(d => d.ToDisplayMessage())));
    }

    [Test]
    public void Snapshot_projected_profile_serializes_back_to_canonical_public_shape() {
        var snapshot = new FamilySnapshot {
            FamilyName = "Projected Fixture",
            AuthoredParamDrivenSolids = new AuthoredParamDrivenSolidsSettings {
                Cylinders = [
                    new AuthoredCylinderSpec {
                        Name = "Basin Body",
                        On = "@Bottom",
                        Center = ["@CenterLR", "@CenterFB"],
                        Diameter = new AuthoredMeasureSpec { By = "param:PE_G_Dim_Width1" },
                        Height = new PlaneRefOrInlinePlaneSpec {
                            InlinePlane = new AuthoredNamedPlaneSpec {
                                Name = "Basin Top", From = "@Bottom", By = "param:PE_G_Dim_Height1", Dir = "out"
                            }
                        }
                    }
                ]
            }
        };

        var profile = FamilySnapshotProfileProjector.ProjectToProfile(snapshot, "__CURRENT_FAMILY__");
        var json = RevitJsonFormatting.SerializeIndented(profile, RevitJsonFormatting.CreateRevitIndentedSettings());
        var roundTrip = SettingsJsonContract.ValidateAndRoundTrip<FFManagerProfile>(json, "projected-profile.json");
        var compiled = AuthoredParamDrivenSolidsCompiler.Compile(roundTrip.Value.ParamDrivenSolids);

        Assert.That(roundTrip.CanonicalJson, Does.Contain("\"Height\": {"));
        Assert.That(roundTrip.CanonicalJson, Does.Contain("\"Name\": \"Basin Top\""));
        Assert.That(roundTrip.CanonicalJson, Does.Not.Contain("\"InlinePlane\""));
        Assert.That(compiled.CanExecute, Is.True,
            string.Join(Environment.NewLine, compiled.Diagnostics.Select(d => d.ToDisplayMessage())));
    }

    private static IEnumerable<string> GetProfileFixtureNames() {
        var assemblyDirectory = Path.GetDirectoryName(typeof(RevitFamilyFixtureHarness).Assembly.Location)
                                ?? throw new InvalidOperationException(
                                    "Could not resolve the test assembly directory.");
        var profileDirectory = Path.Combine(assemblyDirectory, "Fixtures", "Profiles");

        return Directory.GetFiles(profileDirectory, "*.json", SearchOption.TopDirectoryOnly)
            .Select(Path.GetFileName)
            .Where(fileName => !string.IsNullOrWhiteSpace(fileName))
            .OrderBy(fileName => fileName, StringComparer.Ordinal)
            .ToArray()!;
    }

    private static void AssertProfileValidationRejects(string json, string fileName, string expectedMessageText) {
        var ex = Assert.Throws<JsonValidationException>(() =>
            SettingsJsonContract.ValidateAndRoundTrip<FFManagerProfile>(json, fileName));

        Assert.That(ex!.Message, Does.Contain(expectedMessageText));
    }

    private static void AssertSchemaAndJsonRoundTrip<T>(string json)
        where T : class, new() {
        var schema = RevitJsonSchemaFactory.BuildAuthoringSchema(typeof(T), SettingsRuntimeMode.HostOnly,
            resolveFieldOptionSamples: false);
        var issues = schema.Validate(JToken.Parse(json));
        if (issues.Count != 0)
            Console.WriteLine(schema.ToJson());
        Assert.That(issues, Is.Empty, string.Join(Environment.NewLine, issues.Select(issue => issue.ToString())));

        var settings = RevitJsonFormatting.CreateRevitIndentedSettings();
        var value = JsonConvert.DeserializeObject<T>(json, settings);
        Assert.That(value, Is.Not.Null);

        var canonicalJson = RevitJsonFormatting.SerializeIndented(value!, settings);
        var roundTripIssues = schema.Validate(JToken.Parse(canonicalJson));
        if (roundTripIssues.Count != 0)
            Console.WriteLine(schema.ToJson());
        Assert.That(roundTripIssues, Is.Empty,
            string.Join(Environment.NewLine, roundTripIssues.Select(issue => issue.ToString())));
        Assert.That(JToken.DeepEquals(JToken.Parse(json), JToken.Parse(canonicalJson)), Is.True);
    }
}
