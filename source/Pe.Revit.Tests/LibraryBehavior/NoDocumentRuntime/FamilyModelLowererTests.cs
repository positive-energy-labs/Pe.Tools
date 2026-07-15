using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using Pe.Revit.FamilyFoundry.SchemaDefinitions;
using Pe.Revit.FamilyFoundry.Resolution;
using Pe.Revit.SettingsRuntime.Json;
using Pe.Revit.SettingsRuntime.Json.SchemaDefinitions;
using Pe.Revit.SettingsRuntime.Json.ValueDomains;
using Pe.Shared.RevitData.Families;
using Pe.Shared.StorageRuntime.Capabilities;

namespace Pe.Revit.Tests;

[TestFixture]
public sealed class FamilyModelLowererTests {
    [Test]
    public void Family_model_schema_uses_the_authored_shape_and_hydrates_Revit_fields() {
        FamilyFoundrySchemaDefinitionBootstrapper.EnsureRegistered();
        var schema = RevitJsonSchemaFactory.BuildAuthoringSchema(
            typeof(FamilyModel),
            SettingsRuntimeMode.HostOnly,
            resolveFieldOptionSamples: false);
        var json = JsonConvert.SerializeObject(new FamilyModel {
            Family = new FamilyModelHeader {
                Name = "FF Schema Probe",
                Category = "Generic Models",
                Template = "Generic Model",
                Placement = FamilyModelPlacement.Unhosted
            }
        });

        Assert.That(schema.Validate(JToken.Parse(json)), Is.Empty);
        var root = JObject.Parse(schema.ToJson());
        Assert.That(root["properties"]?["family"], Is.Not.Null);
        Assert.That(root["properties"]?["Family"], Is.Null);

        Assert.That(SettingsSchemaDefinitionRegistry.Shared.TryGet(typeof(FamilyModelHeader), out var definition),
            Is.True);
        Assert.That(definition.Bindings[nameof(FamilyModelHeader.Category)].ValueDomain!.Key,
            Is.EqualTo(ValueDomainKeys.CategoryNames));
    }

    [Test]
    public void Minimal_box_lowers_to_the_existing_param_driven_solids_seam() {
        var model = new FamilyModel {
            Family = new FamilyModelHeader {
                Name = "FF Minimal Box",
                Category = "Generic Models",
                Template = "Generic Model",
                Placement = FamilyModelPlacement.Unhosted
            },
            FamilyParameters = new Dictionary<string, FamilyModelFamilyParameter>(StringComparer.Ordinal) {
                ["Width"] = new() { DataType = "Length", Value = "12in" },
                ["Depth"] = new() { DataType = "Length", Value = "8in" },
                ["Height"] = new() { DataType = "Length", Value = "6in" }
            },
            Types = new Dictionary<string, Dictionary<string, string>>(StringComparer.Ordinal) {
                ["Default"] = new(StringComparer.Ordinal),
                ["Wide"] = new(StringComparer.Ordinal) { ["Width"] = "24in" }
            },
            Solids = new Dictionary<string, FamilyModelSolid>(StringComparer.Ordinal) {
                ["body"] = new() {
                    Kind = FamilySolidKind.Prism,
                    Frame = "frame:family",
                    Width = "param:Width",
                    Depth = "param:Depth",
                    Height = "param:Height"
                }
            }
        };

        var result = FamilyModelLowerer.Lower(model);

        Assert.That(result.Diagnostics, Is.Empty,
            string.Join(Environment.NewLine, result.Diagnostics.Select(item => item.Message)));
        Assert.That(result.Profile, Is.Not.Null);
        Assert.That(result.FamilyTypeNames, Is.EqualTo(new[] { "Default", "Wide" }));
        Assert.That(result.Profile!.FamilyParameters.Select(item => item.Name),
            Is.EqualTo(new[] { "Width", "Depth", "Height" }));
        Assert.That(result.Profile.PerTypeAssignmentsTable, Has.Count.EqualTo(1));
        Assert.That(result.Profile.PerTypeAssignmentsTable[0].Parameter, Is.EqualTo("Width"));
        Assert.That(result.Profile.PerTypeAssignmentsTable[0].ValuesByType["Wide"]!.ToString(), Is.EqualTo("24in"));

        var prism = result.Profile.ParamDrivenSolids.Prisms.Single();
        Assert.That(prism.Name, Is.EqualTo("body"));
        Assert.That(prism.On, Is.EqualTo("@Bottom"));
        Assert.That(prism.Length.InlineSpan!.By, Is.EqualTo("param:Width"));
        Assert.That(prism.Width.InlineSpan!.By, Is.EqualTo("param:Depth"));
        Assert.That(prism.Height.InlinePlane!.By, Is.EqualTo("param:Height"));

        var compiled = AuthoredParamDrivenSolidsCompiler.Compile(result.Profile.ParamDrivenSolids);
        Assert.That(compiled.CanExecute, Is.True,
            string.Join(Environment.NewLine, compiled.Diagnostics.Select(item => item.ToDisplayMessage())));
    }

    [Test]
    public void Fractional_metric_and_void_dimensions_lower_to_legacy_inches_without_losing_semantics() {
        var model = new FamilyModel {
            Family = new FamilyModelHeader {
                Name = "FF Literal Box",
                Category = "Generic Models",
                Template = "Generic Model",
                Placement = FamilyModelPlacement.Unhosted
            },
            Solids = new Dictionary<string, FamilyModelSolid>(StringComparer.Ordinal) {
                ["opening"] = new() {
                    Kind = FamilySolidKind.VoidCylinder,
                    Frame = "frame:family",
                    Diameter = "25.4mm",
                    Height = "1/2in"
                }
            }
        };

        var result = FamilyModelLowerer.Lower(model);

        Assert.That(result.Diagnostics, Is.Empty);
        var cylinder = result.Profile!.ParamDrivenSolids.Cylinders.Single();
        Assert.That(cylinder.IsSolid, Is.False);
        Assert.That(cylinder.Diameter.By, Is.EqualTo("1in"));
        Assert.That(cylinder.Height.InlinePlane!.By, Is.EqualTo("0.5in"));
    }
}
