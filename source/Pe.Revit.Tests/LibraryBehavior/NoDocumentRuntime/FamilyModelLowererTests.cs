using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using Pe.Revit.FamilyFoundry;
using Pe.Revit.FamilyFoundry.SchemaDefinitions;
using Pe.Revit.FamilyFoundry.Resolution;
using Pe.Revit.SettingsRuntime.Json;
using Pe.Revit.SettingsRuntime.Json.SchemaDefinitions;
using Pe.Revit.SettingsRuntime.Json.ValueDomains;
using Pe.Revit.SettingsRuntime.Validation;
using Pe.Shared.RevitData.Families;
using Pe.Shared.StorageRuntime.Capabilities;
using Pe.Shared.StorageRuntime.Modules;

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
    public void Family_model_is_a_first_class_settings_root_with_authoritative_semantic_validation() {
        var registry = new SettingsRuntimeRegistry();
        registry.RegisterModules(FamilyFoundrySettingsRegistration.StructuralModules);
        registry.RegisterRootBindings(FamilyFoundrySettingsRegistration.RootBindings);

        var binding = registry.ResolveRootBinding(
            FamilyModelSettingsRegistration.ModuleKey,
            FamilyModelSettingsRegistration.RootKey);
        Assert.That(binding.SettingsType, Is.EqualTo(typeof(FamilyModel)));

        var invalid = """
                      {
                        "$schema": "http://127.0.0.1:5180/schemas/settings/FamilyFoundry/models.json",
                        "family": {
                          "name": "Invalid",
                          "category": "Generic Models",
                          "template": "Generic Model",
                          "placement": "Unhosted"
                        },
                        "solids": {
                          "body": {
                            "kind": "Prism",
                            "frame": "frame:missing",
                            "width": "1ft",
                            "depth": "1ft",
                            "height": "1ft"
                          }
                        }
                      }
                      """;
        var configured = SettingsDocumentValidatorRegistry.Shared.TryValidate(
            binding.SettingsType,
            new SettingsDocumentValidationContext(invalid, invalid),
            out var issues);

        Assert.That(configured, Is.True);
        Assert.That(issues.Select(issue => issue.Code), Does.Contain(FamilyModelDiagnosticCodes.UnsupportedFrame));
        Assert.That(FamilyModelJson.Parse(invalid).Value, Is.Not.Null,
            "settings-owned $schema metadata must not invalidate the authored Family Model");

        const string composed = """
                                {
                                  "family": {
                                    "name": "Composed",
                                    "category": "Generic Models",
                                    "template": "Generic Model",
                                    "placement": "Unhosted"
                                  },
                                  "solids": {
                                    "body": {
                                      "kind": "Prism",
                                      "frame": "frame:family",
                                      "width": "1ft",
                                      "depth": "1ft",
                                      "height": "1ft"
                                    }
                                  }
                                }
                                """;
        _ = SettingsDocumentValidatorRegistry.Shared.TryValidate(
            binding.SettingsType,
            new SettingsDocumentValidationContext(invalid, composed),
            out var composedIssues);
        Assert.That(composedIssues, Is.Empty,
            "strict raw parsing and semantic composed validation are separate phases");
    }

    [Test]
    public void Portable_evaluator_conventions_match_the_shared_vectors() {
        using var stream = typeof(FamilyModelLowererTests).Assembly.GetManifestResourceStream(
            "Pe.Revit.Tests.FamilyModelEvaluatorConformance.json");
        Assert.That(stream, Is.Not.Null);
        using var reader = new StreamReader(stream!);
        var vectors = JObject.Parse(reader.ReadToEnd());

        foreach (var vector in vectors["planes"]!.Children<JObject>()) {
            var direction = Enum.Parse<FamilyModelOffsetDirection>(vector.Value<string>("direction")!);
            Assert.That(
                FamilyModelEvaluatorConventions.Offset(vector.Value<double>("distance"), direction),
                Is.EqualTo(vector.Value<double>("coordinate")));
        }

        var prism = (JObject)vectors["prism"]!;
        foreach (var face in ((JObject)prism["faces"]!).Properties()) {
            var actual = FamilyModelEvaluatorConventions.ResolvePrismFace(
                face.Name,
                prism.Value<double>("width"),
                prism.Value<double>("depth"),
                prism.Value<double>("height"));
            Assert.That(actual.Coordinate, Is.EqualTo(face.Value.Value<double>()), face.Name);
        }

        var cylinder = (JObject)vectors["cylinder"]!;
        var cylinderBounds = FamilyModelEvaluatorConventions.ResolveCylinderBounds(
            cylinder.Value<double>("diameter"),
            cylinder.Value<double>("height"));
        var expectedBounds = (JObject)cylinder["bounds"]!;
        Assert.That(
            new[] { cylinderBounds.X.Minimum, cylinderBounds.X.Maximum },
            Is.EqualTo(expectedBounds["x"]!.Values<double>()));
        Assert.That(
            new[] { cylinderBounds.Y.Minimum, cylinderBounds.Y.Maximum },
            Is.EqualTo(expectedBounds["y"]!.Values<double>()));
        Assert.That(
            new[] { cylinderBounds.Z.Minimum, cylinderBounds.Z.Maximum },
            Is.EqualTo(expectedBounds["z"]!.Values<double>()));

        var expectedFrame = (JObject)vectors["frame"]!["coordinate"]!;
        var front = FamilyModelEvaluatorConventions.ResolvePrismFace(
            "Front",
            prism.Value<double>("width"),
            prism.Value<double>("depth"),
            prism.Value<double>("height"));
        Assert.That(0, Is.EqualTo(expectedFrame.Value<double>("x")));
        Assert.That(front.Coordinate, Is.EqualTo(expectedFrame.Value<double>("y")));
        Assert.That(
            FamilyModelEvaluatorConventions.Offset(4, FamilyModelOffsetDirection.Out),
            Is.EqualTo(expectedFrame.Value<double>("z")));

        foreach (var vector in vectors["centeredLinear"]!.Children<JObject>()) {
            Assert.That(
                FamilyModelEvaluatorConventions.CenteredLinearTotal(vector.Value<int>("halfCount")),
                Is.EqualTo(vector.Value<int>("total")));
        }
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
                ["Width"] = new() { DataType = "Length (Common)", Value = "12in" },
                ["Depth"] = new() { DataType = "Length (Common)", Value = "8in" },
                ["Height"] = new() { DataType = "Length (Common)", Value = "6in" }
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
        Assert.That(result.Profile.FamilyParameters.Single(item => item.Name == "Width").Value, Is.Null);
        Assert.That(result.Profile.PerTypeAssignmentsTable, Has.Count.EqualTo(1));
        Assert.That(result.Profile.PerTypeAssignmentsTable[0].Parameter, Is.EqualTo("Width"));
        Assert.That(result.Profile.PerTypeAssignmentsTable[0].ValuesByType["Default"]!.ToString(), Is.EqualTo("12in"));
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

    [Test]
    public void Plane_frame_and_engineering_connector_lower_to_the_existing_stub_compiler() {
        var model = new FamilyModel {
            Family = new FamilyModelHeader {
                Name = "FF Connector Probe",
                Category = "Generic Models",
                Template = "Generic Model",
                Placement = FamilyModelPlacement.Unhosted
            },
            FamilyParameters = new Dictionary<string, FamilyModelFamilyParameter>(StringComparer.Ordinal) {
                ["Width"] = new() { DataType = "Length (Common)", Value = "12in" },
                ["Depth"] = new() { DataType = "Length (Common)", Value = "8in" },
                ["Height"] = new() { DataType = "Length (Common)", Value = "6in" },
                ["Pipe Elevation"] = new() { DataType = "Length (Common)", Value = "3in" },
                ["Pipe Diameter"] = new() { DataType = "Length (Common)", Value = "1in" },
                ["Stub Depth"] = new() { DataType = "Length (Common)", Value = "1in" }
            },
            Solids = new Dictionary<string, FamilyModelSolid>(StringComparer.Ordinal) {
                ["body"] = new() {
                    Kind = FamilySolidKind.Prism,
                    Frame = "frame:family",
                    Width = "param:Width",
                    Depth = "param:Depth",
                    Height = "param:Height"
                }
            },
            Planes = new Dictionary<string, FamilyModelPlane>(StringComparer.Ordinal) {
                ["pipe-elevation"] = new() {
                    From = "face:body.Bottom",
                    By = "param:Pipe Elevation",
                    Direction = FamilyModelOffsetDirection.Out
                }
            },
            Frames = new Dictionary<string, FamilyModelFrame>(StringComparer.Ordinal) {
                ["pipe"] = new() {
                    Origin = ["face:body.Left", "plane:family.CenterFB", "plane:pipe-elevation"],
                    Normal = "-X",
                    Up = "+Z"
                }
            },
            Connectors = new Dictionary<string, FamilyModelConnector>(StringComparer.Ordinal) {
                ["pipe"] = new() {
                    Domain = FamilyConnectorDomain.Pipe,
                    Frame = "frame:pipe",
                    Shape = FamilyConnectorShape.Round,
                    Diameter = "param:Pipe Diameter",
                    Stub = new FamilyConnectorStub {
                        Depth = "param:Stub Depth",
                        Direction = FamilyModelOffsetDirection.In
                    },
                    SystemType = "OtherPipe",
                    FlowDirection = "Out"
                }
            }
        };

        var result = FamilyModelLowerer.Lower(model);

        Assert.That(result.Diagnostics, Is.Empty,
            string.Join(Environment.NewLine, result.Diagnostics.Select(item => item.Message)));
        Assert.That(result.Profile!.ParamDrivenSolids.Planes["pipe-elevation"].From, Is.EqualTo("@Bottom"));
        var connector = result.Profile.ParamDrivenSolids.Connectors.Single();
        Assert.That(connector.Name, Is.EqualTo("pipe"));
        Assert.That(connector.Face, Is.EqualTo("plane:body.left"));
        Assert.That(connector.Round!.Center,
            Is.EqualTo(new[] { "@CenterFB", "plane:pipe-elevation" }));
        Assert.That(connector.Depth.Dir, Is.EqualTo("in"));

        var compiled = AuthoredParamDrivenSolidsCompiler.Compile(result.Profile.ParamDrivenSolids);
        Assert.That(compiled.CanExecute, Is.True,
            string.Join(Environment.NewLine, compiled.Diagnostics.Select(item => item.ToDisplayMessage())));
        Assert.That(compiled.Connectors.Connectors, Has.Count.EqualTo(1));
    }

}
