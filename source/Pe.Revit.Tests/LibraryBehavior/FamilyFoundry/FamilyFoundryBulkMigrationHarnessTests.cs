using Autodesk.Revit.ApplicationServices;
using Autodesk.Revit.DB.Electrical;
using Autodesk.Revit.DB.Events;
using Pe.Revit.Extensions.FamDocument;
using Pe.Revit.Extensions.FamManager;
using Pe.Revit.FamilyFoundry;
using Pe.Revit.FamilyFoundry.Apply;
using Pe.Revit.FamilyFoundry.Operations;
using Pe.Revit.FamilyFoundry.Reconcile;
using Pe.Shared.RevitData.Families;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using Pe.Revit.Global.Services.Aps;
using Pe.Revit.Parameters;
using Pe.App.Host;
using Pe.Shared.HostContracts.Operations;

using Pe.Revit.Failures;

namespace Pe.Revit.Tests;

/// <summary>Normalization acceptance through the processor. Runtime owner runs these on disposable documents.</summary>
[TestFixture]
public sealed class FamilyFoundryBulkMigrationHarnessTests {
    private Application _application = null!;

    [OneTimeSetUp]
    public void SetUp(UIApplication application) => this._application = application.Application;

    private Document NewFamily(string name, BuiltInCategory category = BuiltInCategory.OST_GenericModel) {
        var document = RevitFamilyFixtureHarness.CreateFamilyDocument(this._application, category, name);
        using var transaction = new Transaction(document, "Seed normalization case");
        transaction.Start();
        var fm = document.FamilyManager;
        var width = fm.AddParameter("Width", GroupTypeId.Geometry, SpecTypeId.Length, false);
        var keep = fm.AddParameter("Keep", GroupTypeId.Data, SpecTypeId.String.Text, false);
        foreach (var type in new[] { "A", "B" }) {
            fm.CurrentType = fm.NewType(type);
            fm.Set(width, type == "A" ? 1.0 : 2.0);
            fm.Set(keep, type);
        }
        Assert.That(transaction.Commit(), Is.EqualTo(TransactionStatus.Committed));
        return document;
    }

    private static ReconcileFamily WidthPatch(string? expectedHash = null) => new(FamilyPatch.Parse(
        """{"patch":{"parameters":{"Width":{"value":"3ft"}}}}"""), expectedPlanHash: expectedHash);

    private static IReadOnlyList<ParametersApi.Parameters.ParametersResult> CompanyDefinitions() =>
        JsonConvert.DeserializeObject<List<ParametersApi.Parameters.ParametersResult>>(File.ReadAllText(
            RevitFamilyFixtureHarness.GetProfileFixturePath("normalization-aps-definitions.json")))!;

    private static IReadOnlyList<ParametersApi.Parameters.ParametersResult> CompanyCorpusDefinitions() =>
        JsonConvert.DeserializeObject<List<ParametersApi.Parameters.ParametersResult>>(File.ReadAllText(
            RevitFamilyFixtureHarness.GetProfileFixturePath("normalization-company-definitions.json")))!;

    private static JObject GeometryInput(JObject settings, params string[] operations) {
        var input = new JObject();
        foreach (var name in new[] { "FilterApsParams", "AddAndMapSharedParams", "AddFamilyParams" }.Concat(operations))
            if (settings[name] is { } value) input[name] = value.DeepClone();
        return input;
    }

    private static JObject AddKnownTemplateContext(string profilePath, JObject native) {
        if (!profilePath.EndsWith("Modine HHD Series.json", StringComparison.Ordinal)) return native;
        var datums = (JObject)native["datums"]!;
        datums["Left"] = new JObject { ["normal"] = "X" };
        datums["Right"] = new JObject { ["normal"] = "X" };
        return native;
    }

    [Test]
    public void Native_formula_canonicalization_is_rollback_only_and_distinguishes_changed_literal() {
        const string raw = "if(PE_E___Voltage = 120, 1, 2)";
        var document = this.NewFamily("Formula canonicalization");
        try {
            using (var transaction = new Transaction(document, "Seed formula")) {
                transaction.Start();
                var fm = document.FamilyManager;
                fm.AddParameter("PE_E___Voltage", GroupTypeId.Electrical, SpecTypeId.ElectricalPotential, false);
                var poles = fm.AddParameter("PE_E___NumberOfPoles", GroupTypeId.Electrical, SpecTypeId.Int.NumberOfPoles, false);
                fm.SetFormula(poles, raw);
                Assert.That(transaction.Commit(), Is.EqualTo(TransactionStatus.Committed));
            }
            var current = document.CaptureFamilyModel();
            var native = current.Parameters["PE_E___NumberOfPoles"].Formula!;
            Assert.That(native, Is.Not.EqualTo(raw));
            using (var transaction = new Transaction(document, "Accept native formula grammar")) {
                transaction.Start();
                Assert.That(document.GetFamilyDocument().TrySetFormula(
                    document.FamilyManager.get_Parameter("PE_E___NumberOfPoles"), native, out var error), Is.True, error);
                Assert.That(transaction.RollBack(), Is.EqualTo(TransactionStatus.RolledBack));
            }
            var before = FamilyModelJson.Serialize(current);
            var currentType = document.FamilyManager.CurrentType.Name;
            var modified = document.IsModified;
            FamilyModel Desired(string formula) => FamilyReconciler.Desired(current, new FamilyPatch { Patch = new JObject {
                ["parameters"] = new JObject { ["PE_E___NumberOfPoles"] = new JObject { ["formula"] = formula } }
            } }).Value!;

            var canonical = FamilyReconciler.ResolveNativeFormulas(Desired(raw), document);
            Assert.That(canonical.Parameters["PE_E___NumberOfPoles"].Formula, Is.EqualTo(native));
            Assert.That(FamilyReconciler.Reconcile(canonical, current, UnitResolvers.Revit(document)).Changes, Is.Empty);
            Assert.That(FamilyModelJson.Serialize(document.CaptureFamilyModel()), Is.EqualTo(before));
            Assert.That(document.FamilyManager.CurrentType.Name, Is.EqualTo(currentType));
            Assert.That(document.IsModified, Is.EqualTo(modified));

            var changed = FamilyReconciler.ResolveNativeFormulas(Desired(raw.Replace("120", "208")), document);
            Assert.That(FamilyReconciler.Diff(changed, current, UnitResolvers.Revit(document)),
                Has.Some.Matches<FamilyChange>(c => c.Section == "parameters" && c.Key == "PE_E___NumberOfPoles"));
        } finally { document.Close(false); }
    }

    [TestCase(false, false)]
    [TestCase(true, false)]
    [TestCase(false, true)]
    public void Product_export_retains_conditional_mapping_and_explicit_state_wins(bool sourceExists, bool explicitValue) {
        var definition = CompanyDefinitions().Single(d => d.Name == "PE_G_Dim_Width1");
        var exported = Pe.Revit.FamilyFoundry.Apply.FamilyProfileConverter.ExportSharedMappings(
            new Pe.Revit.FamilyFoundry.OperationSettings.MapParamsSettings { MappingData = [new() {
                NewName = definition.Name!, CurrNames = [sourceExists ? "Width" : "Absent source"], OnlyAddIfSourceExists = true }] }, [definition]);
        Assert.That(exported.Patch["parameters"]![definition.Name!], Is.Null);
        Assert.That(exported.Run!.ParametersIfSourceExists, Contains.Key(definition.Name!));
        var patch = FamilyPatch.Parse(JsonConvert.SerializeObject(exported, FamilyPatch.Settings));
        if (explicitValue) {
            var explicitParameter = JObject.FromObject(patch.Run!.ParametersIfSourceExists![definition.Name!], JsonSerializer.Create(FamilyModelJson.Settings));
            explicitParameter["value"] = "3ft";
            patch.Patch["parameters"]![definition.Name!] = explicitParameter;
        }
        var document = this.NewFamily("Conditional exported mapping");
        try {
            using var processor = new OperationProcessor(document);
            for (var pass = 0; pass < (explicitValue ? 1 : 2); pass++) {
                var operation = new ReconcileFamily(patch, sharedSource: d => new FamilySharedParameterSource(d, []));
                var (contexts, _) = processor.ProcessQueue(new OperationQueue().Add(operation));
                var (_, error) = contexts.Single().OperationLogs;
                Assert.That(error, Is.Null, error?.Message);
                Assert.That(operation.LastReceipt?.Converged, Is.True);
                var target = document.FamilyManager.get_Parameter(definition.Name);
                Assert.That(target is not null, Is.EqualTo(sourceExists || explicitValue));
                if (target is not null) {
                    Assert.That(target.GUID, Is.EqualTo(definition.DownloadOptions.GetGuid()));
                    foreach (var type in document.FamilyManager.Types.Cast<FamilyType>().Where(t => t.Name is "A" or "B"))
                        Assert.That(type.AsDouble(target), Is.EqualTo(explicitValue ? 3d : type.Name == "A" ? 1d : 2d));
                }
                if (pass == 1) Assert.That(operation.LastPlan!.Changes, Is.Empty);
            }
        } finally { document.Close(false); }
    }

    public static IEnumerable<string> CompanyProfiles() => JArray.Parse(File.ReadAllText(
        RevitFamilyFixtureHarness.GetProfileFixturePath("company-composed-20260906.json"))).Select(p => (string)p["source"]!);

    [Test]
    public void Public_converter_selects_name_patterns_exclusions_and_native_category_identity() {
        var project = RevitFamilyFixtureHarness.CreateProjectDocument(this._application);
        var output = RevitFamilyFixtureHarness.CreateTemporaryOutputDirectory(nameof(Public_converter_selects_name_patterns_exclusions_and_native_category_identity));
        var loadedFamilyIds = new HashSet<ElementId>();
        try {
            foreach (var (name, category) in new[] {
                         ("Exact Pump", BuiltInCategory.OST_MechanicalEquipment),
                         ("Prefix Fan Keep", BuiltInCategory.OST_MechanicalEquipment),
                         ("Prefix Fan Blocked", BuiltInCategory.OST_MechanicalEquipment),
                         ("Middle Coil Keep", BuiltInCategory.OST_MechanicalEquipment),
                         ("Middle Coil Remove", BuiltInCategory.OST_MechanicalEquipment),
                         ("Prefix Reject Start", BuiltInCategory.OST_MechanicalEquipment),
                         ("Prefix Generic Keep", BuiltInCategory.OST_GenericModel)
                     }) {
                var familyDocument = this.NewFamily(name, category);
                string path;
                try {
                    if (name is "Prefix Fan Keep" or "Exact Pump" or "Middle Coil Keep") {
                        using var transaction = new Transaction(familyDocument, "Seed condition selector");
                        transaction.Start();
                        var manager = familyDocument.FamilyManager;
                        var keep = manager.get_Parameter("Keep");
                        if (name != "Prefix Fan Keep") {
                            manager.RemoveParameter(keep);
                            keep = name == "Exact Pump"
                                ? RevitFamilyFixtureHarness.AddSharedFamilyParameter(familyDocument,
                                    new SharedDefinitionSpec("Keep", SpecTypeId.String.Text,
                                        Guid: new Guid("8be6c9e0-ce6e-43d3-a536-2b83e60ce7de")), GroupTypeId.Data, false)
                                : manager.AddParameter("Keep", GroupTypeId.Data, SpecTypeId.String.Text, true);
                        }
                        foreach (var type in familyDocument.FamilyManager.Types.Cast<FamilyType>()) {
                            manager.CurrentType = type;
                            manager.Set(keep, name == "Prefix Fan Keep" && type.Name == "A" ? "other" : "selected");
                        }
                        Assert.That(transaction.Commit(), Is.EqualTo(TransactionStatus.Committed));
                    }
                    path = RevitFamilyFixtureHarness.SaveDocumentCopy(familyDocument, output, name);
                }
                finally { familyDocument.Close(false); }
                var loaded = RevitFamilyFixtureHarness.LoadFamilyIntoProject(this._application, project, path);
                Assert.Multiple(() => {
                    Assert.That(loaded.Name, Is.EqualTo(name));
                    Assert.That(loaded.FamilyCategory?.Id.Value(), Is.EqualTo((long)category));
                });
                loadedFamilyIds.Add(loaded.Id);
            }
            Assert.That(new FilteredElementCollector(project).OfClass(typeof(FamilyInstance)).Cast<FamilyInstance>()
                    .Where(instance => loadedFamilyIds.Contains(instance.Symbol.Family.Id)), Is.Empty,
                "IncludeUnusedFamilies=true must retain unplaced loaded families.");
            WriteLocalConditionSelectorProbe(project, output);
            var settings = JObject.Parse("""
                {"FilterFamilies":{
                  "IncludeUnusedFamilies":true,
                  "IncludeCategoriesEqualing":["Mechanical Equipment"],
                  "IncludeNames":{"Equaling":["Exact Pump"],"Containing":["Coil"],"StartingWith":["Prefix"]},
                  "ExcludeNames":{"Equaling":["Prefix Fan Blocked"],"Containing":["Remove"],"StartingWith":["Prefix Reject"]},
                  "IncludeByCondition":{"FieldName":"","FilterType":2,"Value":""}
                }}
                """);
            var converted = FamilyProfileConverter.Convert(settings, [], project.GetUnits());
            Assert.That(project.FamiliesMatching(converted.Patch.Select).Select(f => f.Name), Is.EqualTo(new[] {
                "Exact Pump", "Middle Coil Keep", "Prefix Fan Keep"
            }));

            settings["FilterFamilies"]!["IncludeByCondition"] = JValue.CreateNull();
            converted = FamilyProfileConverter.Convert(settings, [], project.GetUnits());
            Assert.That(converted.Patch.Select.IncludeByCondition, Is.Null);
            Assert.That(project.FamiliesMatching(converted.Patch.Select).Select(f => f.Name), Is.EqualTo(new[] {
                "Exact Pump", "Middle Coil Keep", "Prefix Fan Keep"
            }));

            settings["FilterFamilies"]!["IncludeByCondition"] = new JObject {
                ["FieldName"] = "Keep", ["FilterType"] = "Equal", ["Value"] = "selected"
            };
            converted = FamilyProfileConverter.Convert(settings, [], project.GetUnits());
            Assert.That(project.FamiliesMatching(converted.Patch.Select).Select(f => f.Name),
                Is.EqualTo(new[] { "Exact Pump", "Middle Coil Keep", "Prefix Fan Keep" }),
                "Local type, local instance-default, and shared fields with one name must all participate.");

            settings["FilterFamilies"]!["IncludeByCondition"] = new JObject {
                ["FieldName"] = "Keep", ["FilterType"] = "BeginsWith", ["Value"] = "sel"
            };
            converted = FamilyProfileConverter.Convert(settings, [], project.GetUnits());
            Assert.That(project.FamiliesMatching(converted.Patch.Select).Select(f => f.Name),
                Is.EqualTo(new[] { "Exact Pump", "Middle Coil Keep", "Prefix Fan Keep" }),
                "A native local string rule must retain any-type semantics without a placed instance.");

            settings["FilterFamilies"]!["IncludeByCondition"]!["FieldName"] = "Missing condition field";
            converted = FamilyProfileConverter.Convert(settings, [], project.GetUnits());
            Assert.That(() => project.FamiliesMatching(converted.Patch.Select),
                Throws.InvalidOperationException.With.Message.Contains("could not apply every filter"));
        } finally { project.Close(false); }
    }

    private static void WriteLocalConditionSelectorProbe(Document project, string output) {
        const string familyName = "Prefix Fan Keep";
        const string fieldName = "Keep";
        const string expected = "selected";
        var evidence = new JObject { ["family"] = familyName, ["field"] = fieldName, ["expected"] = expected };
        using var transaction = new Transaction(project, "Probe local family condition selection");
        transaction.Start();
        try {
            var family = new FilteredElementCollector(project).OfClass(typeof(Family)).Cast<Family>()
                .Single(candidate => candidate.Name == familyName);
            var rows = new JArray();
            evidence["symbols"] = rows;
            foreach (var symbol in family.GetFamilySymbolIds().Select(project.GetElement).OfType<FamilySymbol>()
                         .OrderBy(candidate => candidate.Name, StringComparer.Ordinal)) {
                if (!symbol.IsActive) symbol.Activate();
                var instance = project.Create.NewFamilyInstance(XYZ.Zero, symbol,
                    Autodesk.Revit.DB.Structure.StructuralType.NonStructural);
                project.Regenerate();
                var row = new JObject {
                    ["symbolId"] = symbol.Id.Value(),
                    ["symbolName"] = symbol.Name,
                    ["symbolParameter"] = ParameterFacts(symbol.LookupParameter(fieldName)),
                    ["instanceId"] = instance.Id.Value(),
                    ["instanceParameter"] = ParameterFacts(instance.LookupParameter(fieldName))
                };
                rows.Add(row);
                try {
                    var parameter = symbol.LookupParameter(fieldName)
                                    ?? throw new InvalidOperationException($"Loaded symbol '{symbol.Name}' has no '{fieldName}' parameter.");
                    var rule = ParameterFilterRuleFactory.CreateEqualsRule(parameter.Id, expected);
                    var filter = new ElementParameterFilter(rule);
                    row["filterRuleSymbolPasses"] = rule.ElementPasses(symbol);
                    row["filterRuleInstancePasses"] = rule.ElementPasses(instance);
                    row["elementFilterSymbolPasses"] = filter.PassesFilter(project, symbol.Id);
                    row["elementFilterInstancePasses"] = filter.PassesFilter(project, instance.Id);
                } catch (Exception exception) {
                    row["filterError"] = exception.ToString();
                }
            }

            var categoryId = Category.GetCategory(project, BuiltInCategory.OST_MechanicalEquipment).Id;
            var schedule = ViewSchedule.CreateSchedule(project, categoryId);
            var fields = schedule.Definition.GetSchedulableFields();
            evidence["schedulableFieldCount"] = fields.Count;
            evidence["schedulableMatches"] = new JArray(fields
                .Where(field => field.GetName(project).Equals(fieldName, StringComparison.OrdinalIgnoreCase))
                .Select(field => new JObject {
                    ["name"] = field.GetName(project),
                    ["parameterId"] = field.ParameterId.Value(),
                    ["fieldType"] = field.FieldType.ToString()
                }));
        } catch (Exception exception) {
            evidence["probeError"] = exception.ToString();
        } finally {
            if (transaction.GetStatus() == TransactionStatus.Started) transaction.RollBack();
            File.WriteAllText(Path.Combine(output, "local-condition-selector-prerequisites.json"), evidence.ToString());
        }

        static JObject ParameterFacts(Parameter? parameter) {
            if (parameter is null) return new JObject { ["missing"] = true };
            var builtIn = (parameter.Definition as InternalDefinition)?.BuiltInParameter ?? BuiltInParameter.INVALID;
            return new JObject {
                ["id"] = parameter.Id.Value(),
                ["builtInParameter"] = builtIn.ToString(),
                ["name"] = parameter.Definition.Name,
                ["storage"] = parameter.StorageType.ToString(),
                ["spec"] = parameter.Definition.GetDataType().TypeId,
                ["shared"] = parameter.IsShared,
                ["readOnly"] = parameter.IsReadOnly,
                ["value"] = parameter.AsValueString() ?? parameter.AsString()
            };
        }
    }

    [TestCase("CmdFFManager/profiles/SavedEquip/AprilAire 800 Series.json", 4, 4)]
    [TestCase("CmdFFManager/profiles/SavedEquip/Wine Guardian DS050 Outdoor Condenser.json", 4, 4)]
    [TestCase("CmdFFManager/profiles/SavedEquip/Wine Guardian DS050 Indoor Unit.json", 7, 7)]
    [TestCase("CmdFFManager/profiles/SavedEquip/Modine HHD Series.json", 7, 7)]
    public void Public_converter_maps_corpus_reference_plane_intent(string profilePath, int planeCount, int dimensionCount) {
        var settings = (JObject)JArray.Parse(File.ReadAllText(RevitFamilyFixtureHarness.GetProfileFixturePath("company-composed-20260906.json")))
            .Single(p => (string)p["source"]! == profilePath)["settings"]!;
        var document = this.NewFamily("Reference plane conversion proof");
        try {
            var patch = Pe.Revit.FamilyFoundry.Apply.FamilyProfileConverter.Convert(
                GeometryInput(settings, "MakeRefPlaneAndDims"), CompanyCorpusDefinitions(), document.GetUnits()).Patch;
            Assert.That(((JObject)patch.Patch["refPlanes"]!).Count, Is.EqualTo(planeCount));
            Assert.That(((JObject)patch.Patch["dimensions"]!).Count, Is.EqualTo(dimensionCount));
            var merged = AddKnownTemplateContext(profilePath,
                FamilyPatch.Apply(JObject.Parse(FamilyModelJson.Serialize(document.CaptureFamilyModel())), patch.Patch));
            Assert.That(FamilyModelJson.Parse(merged.ToString()).Diagnostics, Is.Empty);
        } finally { document.Close(false); }
    }

    [Test]
    public void Public_converter_preserves_all_real_param_driven_solids() {
        var profiles = JArray.Parse(File.ReadAllText(RevitFamilyFixtureHarness.GetProfileFixturePath("company-composed-20260906.json")))
            .Where(p => p["settings"]!["ParamDrivenSolids"] is not null).ToDictionary(p => (string)p["source"]!, StringComparer.Ordinal);
        var document = this.NewFamily("Param driven solids conversion proof");
        try {
            FamilyPatch Convert(string source) {
                var settings = (JObject)profiles[source]["settings"]!;
                return Pe.Revit.FamilyFoundry.Apply.FamilyProfileConverter.Convert(
                    GeometryInput(settings, "ParamDrivenSolids"), CompanyCorpusDefinitions(), document.GetUnits()).Patch;
            }

            var box = Convert("CmdFFManager/profiles/SavedEquip/Constrained Box.json");
            Assert.That(((JObject)box.Patch["forms"]!).Properties().Single().Name, Is.EqualTo("Box"));
            Assert.That(((JObject)box.Patch["refPlanes"]!).Properties().Select(p => p.Name), Is.EquivalentTo(
                new[] { "width (Back)", "width (Front)", "length (Left)", "length (Right)", "top" }));
            var merged = FamilyPatch.Apply(JObject.Parse(FamilyModelJson.Serialize(document.CaptureFamilyModel())), box.Patch);
            Assert.That(FamilyModelJson.Parse(merged.ToString()).Diagnostics, Is.Empty);

            var hpwh = Convert("CmdFFMigrator/profiles/PlumbEquip/HPWH.json");
            Assert.That(hpwh.Patch["forms"], Is.Null, "The frozen empty HPWH operation is a validated no-op.");

            foreach (var (source, planeCount, formCount, connectorCount) in new[] {
                         ("CmdFFManager/profiles/SavedEquip/Grinder Pump Basin.json", 6, 4, 1),
                         ("CmdFFManager/profiles/SavedEquip/Zehnder ComfoAir 550 R Luxe ERV.json", 15, 5, 4)
                     }) {
                var converted = Convert(source);
                Assert.That(((JObject)converted.Patch["refPlanes"]!).Count, Is.EqualTo(planeCount), source);
                Assert.That(((JObject)converted.Patch["forms"]!).Count, Is.EqualTo(formCount), source);
                Assert.That(((JObject)converted.Patch["connectors"]!).Count, Is.EqualTo(connectorCount), source);
                var native = FamilyPatch.Apply(JObject.Parse(FamilyModelJson.Serialize(document.CaptureFamilyModel())), converted.Patch);
                Assert.That(FamilyModelJson.Parse(native.ToString()).Diagnostics, Is.Empty, source);
            }

            foreach (var (source, planeCount, formCount, connectorCount) in new[] {
                         ("CmdFFManager/profiles/SavedEquip/Modine HHD Series.json", 15, 4, 3),
                         ("CmdFFManager/profiles/SavedEquip/Wine Guardian DS050 Indoor Unit.json", 17, 6, 5),
                         ("CmdFFManager/profiles/SavedEquip/Wine Guardian DS050 Outdoor Condenser.json", 11, 3, 2)
                     }) {
                var settings = profiles[source]["settings"]!;
                var converted = Pe.Revit.FamilyFoundry.Apply.FamilyProfileConverter.Convert(
                    GeometryInput((JObject)settings, "MakeRefPlaneAndDims", "ParamDrivenSolids"),
                    CompanyCorpusDefinitions(), document.GetUnits()).Patch;
                Assert.That(((JObject)converted.Patch["refPlanes"]!).Count, Is.EqualTo(planeCount), source);
                Assert.That(((JObject)converted.Patch["forms"]!).Count, Is.EqualTo(formCount), source);
                Assert.That(((JObject)converted.Patch["connectors"]!).Count, Is.EqualTo(connectorCount), source);
                var native = AddKnownTemplateContext(source,
                    FamilyPatch.Apply(JObject.Parse(FamilyModelJson.Serialize(document.CaptureFamilyModel())), converted.Patch));
                Assert.That(FamilyModelJson.Parse(native.ToString()).Diagnostics.Any(d => d.Code == FamilyModelDiagnosticCodes.InvalidJson), Is.False, source);
            }
            var power = (JObject)Pe.Revit.FamilyFoundry.Apply.FamilyProfileConverter.Convert(new JObject {
                ["ParamDrivenSolids"] = profiles["CmdFFManager/profiles/SavedEquip/Modine HHD Series.json"]["settings"]!["ParamDrivenSolids"]!.DeepClone()
            }, [], document.GetUnits()).Patch.Patch["connectors"]!["Power"]!;
            Assert.That((string)power["systemType"]!, Is.EqualTo("PowerBalanced"));
            Assert.That((string)power["associate"]!["Voltage"]!, Is.EqualTo("param:PE_E___Voltage"));
            Assert.That((string)power["associate"]!["Number of Poles"]!, Is.EqualTo("param:PE_E___NumberOfPoles"));
            Assert.That(power["diameter"], Is.Null, "Electrical connector size belongs to its retained stub form.");

            var demandProfile = (JObject)profiles["CmdFFManager/profiles/SavedEquip/Modine HHD Series.json"]
                ["settings"]!["ParamDrivenSolids"]!.DeepClone();
            demandProfile["Connectors"]![0]!["Config"]!["Pipe"]!["FlowConfiguration"] = "Demand";
            var demand = (JObject)Pe.Revit.FamilyFoundry.Apply.FamilyProfileConverter.Convert(new JObject {
                ["ParamDrivenSolids"] = demandProfile
            }, [], document.GetUnits()).Patch.Patch["connectors"]!["SupplyWater"]!;
            Assert.That((string)demand["flowConfiguration"]!, Is.EqualTo("Demand"),
                "Legacy pipe connector conversion must retain explicitly authored Demand intent.");

            var grinderLookup = profiles["CmdFFManager/profiles/SavedEquip/Grinder Pump Basin.json"]["settings"]!["SetLookupTables"]!;
            var lookup = Pe.Revit.FamilyFoundry.Apply.FamilyProfileConverter.Convert(new JObject { ["SetLookupTables"] = grinderLookup.DeepClone() }, [], document.GetUnits()).Patch;
            Assert.That(lookup.Patch["lookupTables"], Is.Null, "The frozen active Tables:[] operation is a validated no-op.");
        } finally { document.Close(false); }
    }

    [Test]
    public void Company_profiles_export_all_nineteen_connector_rules_and_omit_all_nine_disabled_rules() {
        var profiles = JArray.Parse(File.ReadAllText(RevitFamilyFixtureHarness.GetProfileFixturePath("company-composed-20260906.json")))
            .OfType<JObject>().Where(profile => profile["settings"]?["MakeElectricalConnector"] is JObject).ToList();
        var enabled = profiles.Where(HasEnabledConnectorRule).ToList();
        Assert.Multiple(() => {
            Assert.That(enabled, Has.Count.EqualTo(19));
            Assert.That(profiles.Except(enabled).Count(), Is.EqualTo(9));
        });
        var definitions = CompanyCorpusDefinitions();
        var document = this.NewFamily("Company connector conversion census");
        try {
            foreach (var profile in profiles)
                AssertConnectorRule(profile, CompanyNormalizationFixture.ConvertProfileParameters((JObject)profile["settings"]!, document, definitions).Patch);
            var sample = (JObject)enabled[0]["settings"]!.DeepClone();
            void Reject(JToken connector) {
                var malformed = (JObject)sample.DeepClone();
                malformed["MakeElectricalConnector"] = connector;
                Assert.Throws<InvalidOperationException>(() => CompanyNormalizationFixture.ConvertProfileParameters(malformed, document, definitions));
            }
            Reject("not an object");
            var unknownSetting = (JObject)sample["MakeElectricalConnector"]!.DeepClone();
            unknownSetting["Unexpected"] = true;
            Reject(unknownSetting);
            var unknownSource = (JObject)sample["MakeElectricalConnector"]!.DeepClone();
            unknownSource["SourceParameterNames"]!["Unexpected"] = "PE_E___MCA";
            Reject(unknownSource);
        } finally { document.Close(false); }
    }

    [TestCaseSource(nameof(CompanyProfiles))]
    [Category("CompanyCorpus")]
    public void Each_company_profile_parameter_intent_uses_public_reconciler(string profilePath) {
        var profile = JArray.Parse(File.ReadAllText(RevitFamilyFixtureHarness.GetProfileFixturePath("company-composed-20260906.json")))
            .Single(p => (string)p["source"]! == profilePath);
        var definitions = JsonConvert.DeserializeObject<List<ParametersApi.Parameters.ParametersResult>>(File.ReadAllText(
            RevitFamilyFixtureHarness.GetProfileFixturePath("normalization-company-definitions.json")))!;
        var connectorRule = HasEnabledConnectorRule((JObject)profile);
        var document = this.NewFamily("Company profile parameter proof",
            connectorRule ? BuiltInCategory.OST_MechanicalEquipment : BuiltInCategory.OST_GenericModel);
        var output = RevitFamilyFixtureHarness.CreateTemporaryOutputDirectory(nameof(Each_company_profile_parameter_intent_uses_public_reconciler));
        var evidence = new JObject { ["profile"] = profilePath, ["composedSettings"] = profile["settings"]!.DeepClone() };
        try {
            var settings = CompanyNormalizationFixture.ApplyNativeProfileOverride(profilePath, (JObject)profile["settings"]!);
            var conversion = CompanyNormalizationFixture.ConvertProfileParameters(settings, document, definitions);
            var patch = conversion.Patch;
            AssertConnectorRule((JObject)profile, patch);
            if (profilePath.Replace('\\', '/') == "CmdFFManager/profiles/SavedEquip/DBF-DEDPV.json")
                Assert.That(patch.Patch["parameters"]!["PE_G___SoundLevel"]!.Value<string>("value"), Is.EqualTo("4"));
            if (profilePath.Replace('\\', '/') == "CmdFFManager/profiles/SavedEquip/Grinder Pump Basin.json") {
                var original = JObject.Parse(File.ReadAllText(RevitFamilyFixtureHarness.GetProfileFixturePath(
                    Path.Combine("company-20260906", profilePath))));
                var sourceValue = original["SetKnownParams"]!["GlobalAssignments"]!.Single(assignment =>
                    (string)assignment["Parameter"]! == "PE_G___SoundLevel").Value<string>("Value");
                Assert.Multiple(() => {
                    Assert.That(sourceValue, Is.EqualTo("80 dBi alarm"), "The frozen company profile remains immutable.");
                    Assert.That(settings["SetKnownParams"]!["GlobalAssignments"]!.Single(assignment =>
                        (string)assignment["Parameter"]! == "PE_G___SoundLevel").Value<string>("Value"), Is.EqualTo("80"));
                    Assert.That(patch.Patch["parameters"]!["PE_G___SoundLevel"]!.Value<string>("value"), Is.EqualTo("80"));
                });
            }
            if (profilePath.Contains("/WaterFurnace-", StringComparison.Ordinal)) {
                Assert.That(patch.Patch["parameters"]!["Model"]!["isInstance"], Is.Null,
                    "Omitted legacy scope must preserve the built-in parameter's current scope.");
                Assert.That(patch.Patch["parameters"]!["Manufacturer"]!.Value<bool?>("isInstance"), Is.False,
                    "Explicit legacy scope remains authoritative.");
            }
            if (profilePath.EndsWith("/AprilAire 800 Series.json", StringComparison.Ordinal)) {
                var url = (JObject)patch.Patch["parameters"]!["PE_G___URL"]!;
                var definition = definitions.Single(d => d.Name == "PE_G___URL");
                Assert.That(patch.Patch["parameters"]!["PE_G___Url"], Is.Null);
                Assert.That(url.Value<bool>("shared"), Is.True);
                Assert.That(url.Value<string>("sharedGuid"), Is.EqualTo(definition.DownloadOptions.GetGuid().ToString()));
                Assert.That(url.Value<string>("value"), Does.StartWith("https://"));
            }
            if (profilePath.EndsWith("/Modine HHD Series.json", StringComparison.Ordinal)) {
                var literal = patch.Patch["types"]!["HHD45"]!["PE_M_PerfHeat_FluidEWT"]!.Value<string>()!;
                Assert.That(literal, Does.Contain(" "), "Converted temperature must retain an explicit unit symbol.");
                Assert.That(ParameterStringIo.TryParseMeasuredValue(document.GetUnits(), SpecTypeId.HvacTemperature, literal, out var parsed), Is.True);
                Assert.That(parsed, Is.EqualTo(UnitUtils.ConvertToInternalUnits(180, UnitTypeId.Fahrenheit)).Within(1e-9));
            }
            evidence["parameterPatch"] = patch.Patch.DeepClone();
            var before = document.CaptureFamilyModel();
            var operation = new ReconcileFamily(patch, sharedSource: d => new FamilySharedParameterSource(d, definitions));
            using var processor = new OperationProcessor(document, conversion.Options);
            var (contexts, _) = processor.ProcessQueue(new OperationQueue().Add(operation));
            var (_, error) = contexts.Single().OperationLogs;
            evidence["receipt"] = operation.LastReceipt is null ? null : JObject.FromObject(operation.LastReceipt);
            evidence["error"] = error?.ToString();
            if (error is not null) {
                var after = document.CaptureFamilyModel();
                Assert.That(JToken.DeepEquals(JToken.Parse(FamilyModelJson.Serialize(after)), JToken.Parse(FamilyModelJson.Serialize(before))),
                    Is.True, "Failed parameter migration must fully roll back.");
            }
            Assert.That(error, Is.Null, error?.Message);
            Assert.That(operation.LastReceipt?.Converged, Is.True);
            if (profilePath.Replace('\\', '/') == "CmdFFManager/profiles/SavedEquip/Constrained Box.json") {
                Assert.That(document.CaptureFamilyModel().Forms.Values.Single().Start, Is.EqualTo("Reference Plane"));
                var repeated = new ReconcileFamily(patch, sharedSource: d => new FamilySharedParameterSource(d, definitions));
                var (repeatedContexts, _) = processor.ProcessQueue(new OperationQueue().Add(repeated));
                var (_, repeatedError) = repeatedContexts.Single().OperationLogs;
                Assert.That(repeatedError, Is.Null, repeatedError?.Message);
                Assert.That(repeated.LastReceipt?.Converged, Is.True);
                Assert.That(repeated.LastPlan!.Changes, Is.Empty);
            }
            foreach (var parameter in ((JObject)patch.Patch["parameters"]!).Properties().Where(p => p.Value.Value<bool?>("shared") == true)) {
                var actual = document.FamilyManager.get_Parameter(parameter.Name);
                Assert.That(actual?.IsShared, Is.True, parameter.Name);
                Assert.That(actual!.GUID, Is.EqualTo(definitions.Single(d => d.Name == parameter.Name).DownloadOptions.GetGuid()));
            }
            AssertCompanyLiteral(profilePath, document);
            if (connectorRule) {
                var rule = patch.Run!.ElectricalConnectorParameters!;
                Assert.That(document.FamilyManager.get_Parameter(rule.MinimumCircuitAmpacity), Is.Not.Null);
                var connectors = new FilteredElementCollector(document).OfClass(typeof(ConnectorElement)).Cast<ConnectorElement>()
                    .Where(connector => connector.Domain == Domain.DomainElectrical).ToList();
                Assert.That(connectors, Is.Not.Empty);
                foreach (var connector in connectors)
                    foreach (var (target, source) in new Dictionary<BuiltInParameter, string> {
                                 [BuiltInParameter.RBS_ELEC_VOLTAGE] = rule.Voltage,
                                 [BuiltInParameter.RBS_ELEC_NUMBER_OF_POLES] = rule.NumberOfPoles,
                                 [BuiltInParameter.RBS_ELEC_APPARENT_LOAD] = rule.ApparentPower })
                        Assert.That(document.FamilyManager.GetAssociatedFamilyParameter(connector.get_Parameter(target))?.Definition.Name,
                            Is.EqualTo(source), $"{profilePath}: {target}");
                var connectorIds = connectors.Select(connector => connector.Id.Value()).ToList();
                var repeated = new ReconcileFamily(patch, sharedSource: d => new FamilySharedParameterSource(d, definitions));
                var (repeatedContexts, _) = processor.ProcessQueue(new OperationQueue().Add(repeated));
                var (repeatedLogs, repeatedError) = repeatedContexts.Single().OperationLogs;
                Assert.That(repeatedError, Is.Null, repeatedError?.Message);
                Assert.That(repeated.LastReceipt?.Converged, Is.True);
                Assert.That(repeated.LastPlan!.Changes, Is.Empty);
                Assert.That(repeatedLogs!.SelectMany(log => log.Entries)
                    .Single(entry => entry.Name == "Electrical connectors").Status, Is.EqualTo(LogStatus.Skipped));
                Assert.That(new FilteredElementCollector(document).OfClass(typeof(ConnectorElement)).Cast<ConnectorElement>()
                    .Where(connector => connector.Domain == Domain.DomainElectrical).Select(connector => connector.Id.Value()), Is.EqualTo(connectorIds));
            }
        } catch (Exception error) { evidence["failure"] = error.ToString(); throw; }
        finally {
            File.WriteAllText(Path.Combine(output, "company-profile-parameters.json"), evidence.ToString());
            document.Close(false);
        }
    }

    private static bool HasEnabledConnectorRule(JObject profile) =>
        profile["settings"]?["MakeElectricalConnector"] is JObject settings && settings.Value<bool?>("Enabled") != false;

    [Test, Category("CompanyCorpus")]
    public void Public_converter_preserves_all_real_local_parameter_group_intent() {
        var profiles = JArray.Parse(File.ReadAllText(RevitFamilyFixtureHarness.GetProfileFixturePath("company-composed-20260906.json")))
            .OfType<JObject>().Where(profile => profile["settings"]?["AddFamilyParams"] is JObject).ToList();
        var document = this.NewFamily("Company local parameter group conversion");
        try {
            foreach (var profile in profiles) {
                var settings = new JObject { ["AddFamilyParams"] = profile["settings"]!["AddFamilyParams"]!.DeepClone() };
                var patch = CompanyNormalizationFixture.ConvertProfileParameters(settings, document, []).Patch;
                AssertLocalParameterGroups(settings, patch);
            }
        } finally { document.Close(false); }
    }

    private static void AssertLocalParameterGroups(JObject settings, FamilyPatch patch) {
        if (settings["AddFamilyParams"] is not JObject add || add.Value<bool?>("Enabled") == false) return;
        foreach (var local in add["Parameters"] ?? new JArray()) {
            var parameter = patch.Patch["parameters"]![(string)local["Name"]!]!;
            Assert.That(parameter["propertiesGroup"]?.Value<string>(),
                Is.EqualTo(local["PropertiesGroup"] is { Type: not JTokenType.Null } group
                    ? SetParamMetadata.Group(((string?)group)!).TypeId
                    : null),
                $"{local["Name"]}: omitted group must remain omitted; explicit Other must remain Revit's empty group id.");
        }
    }

    private static void AssertConnectorRule(JObject profile, FamilyPatch patch) {
        var settings = profile["settings"]?["MakeElectricalConnector"] as JObject;
        if (!HasEnabledConnectorRule(profile)) {
            Assert.That(patch.Run?.ElectricalConnectorParameters, Is.Null, (string?)profile["source"]);
            return;
        }
        var source = (JObject)settings!["SourceParameterNames"]!;
        var rule = patch.Run?.ElectricalConnectorParameters;
        Assert.That(rule, Is.Not.Null, (string?)profile["source"]);
        Assert.Multiple(() => {
            Assert.That(rule!.Voltage, Is.EqualTo((string)source["Voltage"]!));
            Assert.That(rule.NumberOfPoles, Is.EqualTo((string)source["NumberOfPoles"]!));
            Assert.That(rule.ApparentPower, Is.EqualTo((string)source["ApparentPower"]!));
            Assert.That(rule.MinimumCircuitAmpacity, Is.EqualTo((string)source["MinimumCircuitAmpacity"]!));
            foreach (var name in new[] { rule.Voltage, rule.NumberOfPoles, rule.ApparentPower, rule.MinimumCircuitAmpacity })
                Assert.That(patch.Patch["parameters"]?[name] is not null || patch.Run?.ParametersIfSourceExists?.ContainsKey(name) == true,
                    Is.True, $"{profile["source"]}: {name} must remain governed by exported parameter intent.");
        });
    }

    private static void AssertCompanyLiteral(string profilePath, Document document) {
        if (profilePath.Replace('\\', '/') == "CmdFFManager/profiles/SavedEquip/DBF-DEDPV.json") {
            var sound = document.FamilyManager.get_Parameter("PE_G___SoundLevel");
            Assert.That(sound.Definition.GetDataType(), Is.EqualTo(SpecTypeId.Number));
            foreach (var type in document.FamilyManager.Types.Cast<FamilyType>())
                Assert.That(type.AsDouble(sound), Is.EqualTo(4d).Within(1e-9), $"{profilePath}: {type.Name}/PE_G___SoundLevel");
        }
        var expected = profilePath.Replace('\\', '/') switch {
            "CmdFFManager/profiles/SavedEquip/DBF-DEDPV.json" => (Name: "PE_M_Fan_ExternalStaticPressure", Type: (string?)null,
                Spec: SpecTypeId.HvacPressure, Value: UnitUtils.ConvertToInternalUnits(0.2, UnitTypeId.InchesOfWater60DegreesFahrenheit)),
            "CmdFFManager/profiles/SavedEquip/Build Equinox CERV2.json" => (Name: "PE_M_Fan_ExternalStaticPressure", Type: "CERV2",
                Spec: SpecTypeId.HvacPressure, Value: UnitUtils.ConvertToInternalUnits(0.4, UnitTypeId.InchesOfWater60DegreesFahrenheit)),
            "CmdFFManager/profiles/SavedEquip/AprilAire E-Series.json" => (Name: "PE_G___Weight", Type: "E130",
                Spec: SpecTypeId.Number, Value: 98d),
            "CmdFFManager/profiles/SavedEquip/Modine HHD Series.json" => (Name: "PE_M_PerfHeat_FluidEWT", Type: "HHD45",
                Spec: SpecTypeId.HvacTemperature, Value: UnitUtils.ConvertToInternalUnits(180, UnitTypeId.Fahrenheit)),
            _ => default
        };
        if (expected.Name is null) return;
        var parameter = document.FamilyManager.get_Parameter(expected.Name);
        Assert.That(parameter.StorageType, Is.EqualTo(StorageType.Double), expected.Name);
        Assert.That(parameter.Definition.GetDataType(), Is.EqualTo(expected.Spec), expected.Name);
        var types = document.FamilyManager.Types.Cast<FamilyType>().Where(type => expected.Type is null || type.Name == expected.Type).ToList();
        Assert.That(types, Is.Not.Empty, $"{profilePath}: {expected.Type}");
        foreach (var type in types)
            Assert.That(type.AsDouble(parameter), Is.EqualTo(expected.Value).Within(1e-9), $"{profilePath}: {type.Name}/{expected.Name}");
    }

    [Test]
    public void Authored_form_view_flags_survive_build_save_and_reopen() {
        var json = JObject.Parse(File.ReadAllText(RevitFamilyFixtureHarness.GetFamilyModelFixturePath("a-box.family.json")));
        var flags = JObject.Parse("""{"planRcp":false,"frontBack":false,"leftRight":true,"onlyWhenCut":false,"coarse":false,"medium":true,"fine":true}""");
        foreach (var form in ((JObject)json["forms"]!).Properties()) form.Value["visibility"] = flags.DeepClone();
        var model = FamilyModelJson.Parse(json.ToString()).Value!;
        var output = RevitFamilyFixtureHarness.CreateTemporaryOutputDirectory(nameof(Authored_form_view_flags_survive_build_save_and_reopen));
        var path = Path.Combine(output, "Visibility.rfa");
        var built = Pe.Revit.FamilyFoundry.Apply.FamilyModelBuild.BuildAndSave(this._application, model, path);
        Assert.That(built.Receipt?.Converged, Is.True);
        var document = this._application.OpenDocumentFile(path);
        try {
            var manager = document.FamilyManager;
            var type = manager.CurrentType;
            var expectedSize = new XYZ(type.AsDouble(manager.get_Parameter("Width"))!.Value,
                type.AsDouble(manager.get_Parameter("Depth"))!.Value, type.AsDouble(manager.get_Parameter("Height"))!.Value);
            // Identify the authored box independently by its native extents, not the writer's lookup or every extrusion.
            var body = new FilteredElementCollector(document).OfClass(typeof(Extrusion)).Cast<Extrusion>().Single(form => {
                var bounds = form.get_BoundingBox(null);
                return bounds is not null && (bounds.Max - bounds.Min).IsAlmostEqualTo(expectedSize, 1e-6);
            });
            {
                var form = body;
                var visibility = form.GetVisibility();
                Assert.That(new[] { visibility.IsShownInPlanRCPCut, visibility.IsShownInFrontBack, visibility.IsShownInLeftRight,
                    visibility.IsShownOnlyWhenCut, visibility.IsShownInCoarse, visibility.IsShownInMedium, visibility.IsShownInFine },
                    Is.EqualTo(new[] { false, false, true, false, false, true, true }));
            }
        } finally { document.Close(false); }
    }

    [Test]
    public void Omitted_new_parameter_scope_resolves_to_native_type_default_and_reapplies_empty() {
        var document = this.NewFamily("FF parameter scope defaults");
        try {
            var patch = FamilyPatch.Parse("""{"patch":{"parameters":{"Rotation":{"dataType":"Angle","value":"90deg"},"Note":{"dataType":"Text","value":"Rotation"}}}}""");
            var desired = FamilyReconciler.Desired(document.CaptureFamilyModel(), patch).Value!;
            using var source = new FamilySharedParameterSource(document, []);
            var resolved = source.Resolve(desired, patch.Patch);
            Assert.That(resolved.Parameters["Rotation"].IsInstance, Is.False);
            Assert.That(resolved.Parameters["Note"].IsInstance, Is.False);
            using var processor = new OperationProcessor(document);
            for (var pass = 0; pass < 2; pass++) {
                var operation = new ReconcileFamily(patch, sharedSource: d => new FamilySharedParameterSource(d, []));
                var (contexts, _) = processor.ProcessQueue(new OperationQueue().Add(operation));
                var (_, error) = contexts.Single().OperationLogs;
                Assert.That(error, Is.Null, error?.Message);
                Assert.That(operation.LastReceipt?.Converged, Is.True);
                if (pass == 1) Assert.That(operation.LastPlan!.Changes, Is.Empty);
            }
            Assert.That(document.FamilyManager.FindParameter("Rotation").IsInstance, Is.False);
            Assert.That(document.FamilyManager.FindParameter("Note").IsInstance, Is.False);
        } finally { document.Close(false); }
    }

    [TestCase("PE_P_LoadCalc_CWFU", false, false)]
    [TestCase("PE_P_LoadCalc_CWFU", false, true)]
    [TestCase("PE_P_LoadCalc_CWFU", true, false)]
    [TestCase("PE_P_LoadCalc_CWFU", true, true)]
    [TestCase("PE_E___FLA", false, false)]
    [TestCase("PE_E___FLA", false, true)]
    [TestCase("PE_E___FLA", true, false)]
    [TestCase("PE_E___FLA", true, true)]
    public void Shared_creation_native_group_and_file_scope_probe(string name, bool otherGroup, bool activeTemporaryFile) {
        var document = this.NewFamily("FF shared creation probe");
        var originalFile = this._application.SharedParametersFilename;
        var output = RevitFamilyFixtureHarness.CreateTemporaryOutputDirectory(nameof(Shared_creation_native_group_and_file_scope_probe));
        var evidence = new JObject { ["name"] = name, ["otherGroup"] = otherGroup, ["activeTemporaryFile"] = activeTemporaryFile };
        try {
            var data = JsonConvert.DeserializeObject<List<ParametersApi.Parameters.ParametersResult>>(File.ReadAllText(
                RevitFamilyFixtureHarness.GetProfileFixturePath("normalization-company-definitions.json")))!.Single(d => d.Name == name);
            var options = data.DownloadOptions;
            using var file = new TempSharedParamFile(document);
            Assert.That(this._application.SharedParametersFilename, Is.EqualTo(file.TempFileName));
            var definition = SharedParameterBinder.EnsureDefinition(file, new SharedDefinitionSpec(name, options.GetSpecTypeId(),
                Guid: options.GetGuid(), Description: data.Description ?? "", Visible: options.Visible, UserModifiable: !data.ReadOnly));
            if (!activeTemporaryFile) this._application.SharedParametersFilename = originalFile;
            try {
                evidence["guid"] = definition.GUID.ToString();
                evidence["spec"] = definition.GetDataType().TypeId;
                using var transaction = new Transaction(document, "Probe exact native shared creation");
                transaction.Start();
                if (!activeTemporaryFile) {
                    Assert.Throws<Autodesk.Revit.Exceptions.InvalidOperationException>(() =>
                        document.FamilyManager.AddParameter(definition, otherGroup ? new ForgeTypeId("") : GroupTypeId.Data, options.IsInstance));
                    evidence["inactiveFileRejected"] = true;
                    transaction.RollBack();
                    return;
                }
                var parameter = document.FamilyManager.AddParameter(definition, otherGroup ? new ForgeTypeId("") : GroupTypeId.Data, options.IsInstance);
                Assert.That(parameter, Is.Not.Null);
                evidence["created"] = true;
                Assert.That(parameter.GUID, Is.EqualTo(options.GetGuid()));
                transaction.RollBack();
            } finally { this._application.SharedParametersFilename = originalFile; }
        } catch (Exception error) { evidence["error"] = error.ToString(); throw; }
        finally {
            this._application.SharedParametersFilename = originalFile;
            File.WriteAllText(Path.Combine(output, "shared-creation-probe.json"), evidence.ToString());
            document.Close(false);
        }
    }

    [Test]
    public void Native_resolution_converts_local_and_shared_group_labels_before_pure_diff() {
        var document = this.NewFamily("FF native group resolution");
        try {
            var label = LabelUtils.GetLabelForGroup(GroupTypeId.IdentityData);
            var patch = new FamilyPatch { Patch = new JObject { ["parameters"] = new JObject {
                ["Width"] = new JObject { ["propertiesGroup"] = label, ["value"] = "4ft" },
                ["Group Shared"] = new JObject { ["shared"] = true, ["sharedGuid"] = Guid.NewGuid().ToString(),
                    ["sharedSpecId"] = SpecTypeId.Length.TypeId, ["isInstance"] = false, ["propertiesGroup"] = label, ["value"] = "5ft" }
            } } };
            var current = document.CaptureFamilyModel();
            var desired = FamilyReconciler.Desired(current, patch).Value!;
            using var source = new FamilySharedParameterSource(document, []);
            var resolved = source.Resolve(desired, patch.Patch);
            Assert.That(resolved.Parameters["Width"].PropertiesGroup, Is.EqualTo(GroupTypeId.IdentityData.TypeId));
            Assert.That(resolved.Parameters["Group Shared"].PropertiesGroup, Is.EqualTo(GroupTypeId.IdentityData.TypeId));
            Assert.That(patch.Patch["parameters"]!["Width"]!["propertiesGroup"]!.Value<string>(), Is.EqualTo(label), "Exact authored intent remains available for plan hashing.");
            using var processor = new OperationProcessor(document);
            var operation = new ReconcileFamily(patch, sharedSource: d => new FamilySharedParameterSource(d, []));
            var (contexts, _) = processor.ProcessQueue(new OperationQueue().Add(operation));
            var (_, error) = contexts.Single().OperationLogs;
            Assert.That(error, Is.Null, error?.Message);
            Assert.That(operation.LastReceipt?.Converged, Is.True);
            var captured = document.CaptureFamilyModel();
            Assert.That(captured.Parameters["Width"].PropertiesGroup, Is.EqualTo(GroupTypeId.IdentityData.TypeId));
            Assert.That(captured.Parameters["Group Shared"].PropertiesGroup, Is.EqualTo(GroupTypeId.IdentityData.TypeId));
            Assert.That(FamilyReconciler.Diff(resolved, captured, UnitResolvers.Revit(document)), Is.Empty);
        } finally { document.Close(false); }
    }

    [Test, Timeout(600000)]
    public void Old_template_Mitsubishi_MSZ_GL_preserves_join_graph_or_rolls_back() {
        const string familyName = "Mitsubishi_MSZ-GL";
        var original = RevitFamilyFixtureHarness.GetProjectFixturePath("Old_Template.rvt");
        var originalHash = System.Security.Cryptography.SHA256.HashData(File.ReadAllBytes(original));
        var output = RevitFamilyFixtureHarness.CreateTemporaryOutputDirectory(nameof(Old_template_Mitsubishi_MSZ_GL_preserves_join_graph_or_rolls_back));
        var copy = Path.Combine(output, "Old_Template.rvt");
        File.Copy(original, copy);
        var project = this._application.OpenDocumentFile(copy);
        try {
            var family = new FilteredElementCollector(project).OfClass(typeof(Family)).Cast<Family>().Single(f => f.Name == familyName);
            var originalId = family.Id;
            var originalUniqueId = family.UniqueId;
            var before = Pe.Revit.DocumentData.Families.Extraction.FamilySnapshotExtractor.ExtractFromProjectFamily(project, family);
            var beforeJoins = CaptureJoinGraph(project, family);
            Assert.That(beforeJoins, Has.Some.Contains("|Extrusion|"), "The real family must exercise joined extrusion geometry.");

            var mappings = CompanyNormalizationFixture.MechanicalMappings();
            var names = mappings.MappingData.Select(mapping => mapping.NewName).ToHashSet(StringComparer.Ordinal);
            var definitions = CompanyCorpusDefinitions().Where(definition => names.Contains(definition.Name!)).ToList();
            Assert.That(definitions, Has.Count.EqualTo(38));
            var operation = new ReconcileFamily(CompanyNormalizationFixture.Convert(mappings, names),
                sharedSource: document => new FamilySharedParameterSource(document, definitions));
            var failurePath = Path.Combine(output, "join-failures.json");
            var failureEvidence = new JObject { ["status"] = "subscribed", ["failures"] = new JArray() };
            WriteCheckpoint(failurePath, failureEvidence);
            void CaptureFailures(object? _, FailuresProcessingEventArgs args) {
                var accessor = args.GetFailuresAccessor();
                if (accessor == null) return;
                foreach (var failure in accessor.GetFailureMessages())
                    ((JArray)failureEvidence["failures"]!).Add(new JObject {
                        ["capturedAtUtc"] = DateTime.UtcNow.ToString("O"),
                        ["document"] = accessor.GetDocument()?.Title,
                        ["severity"] = failure.GetSeverity().ToString(),
                        ["failureDefinitionId"] = failure.GetFailureDefinitionId().Guid.ToString(),
                        ["description"] = failure.GetDescriptionText()
                    });
                failureEvidence["status"] = "observed";
                WriteCheckpoint(failurePath, failureEvidence);
            }

            this._application.FailuresProcessing += CaptureFailures;
            try {
                using var processor = new OperationProcessor(project);
                var (contexts, _) = processor.SelectFamilies(() => [family]).ProcessQueue(new OperationQueue().Add(operation));
                var (_, error) = contexts.Single().OperationLogs;

                var loaded = new FilteredElementCollector(project).OfClass(typeof(Family)).Cast<Family>().Single(f => f.Name == familyName);
                var afterJoins = CaptureJoinGraph(project, loaded);
                Assert.That(afterJoins, Is.EqualTo(beforeJoins), "Migration must preserve every authored join edge.");
                if (error is null) {
                    Assert.That(operation.LastReceipt?.Converged, Is.True);
                    var after = Pe.Revit.DocumentData.Families.Extraction.FamilySnapshotExtractor.ExtractFromProjectFamily(project, loaded);
                    var exact = definitions.Count(definition => after.Parameters.Any(parameter =>
                        parameter.Definition.Identity.Name == definition.Name &&
                        parameter.Definition.Identity.SharedGuid == definition.DownloadOptions.GetGuid().ToString()));
                    Assert.That(exact, Is.EqualTo(definitions.Count));
                } else {
                    var joinLossGuid = BuiltInFailures.JoinElementsFailures.CannotKeepJoined.Guid.ToString();
                    Assert.That(error.ToString(), Does.Contain(joinLossGuid), "Rollback must report the exact native join-loss failure GUID.");
                    Assert.That(loaded.Id, Is.EqualTo(originalId));
                    Assert.That(loaded.UniqueId, Is.EqualTo(originalUniqueId));
                    var after = Pe.Revit.DocumentData.Families.Extraction.FamilySnapshotExtractor.ExtractFromProjectFamily(project, loaded);
                    Assert.That(JToken.DeepEquals(JToken.FromObject(after.Parameters), JToken.FromObject(before.Parameters)), Is.True,
                        "Rollback must preserve the complete parameter matrix.");
                }
            } finally {
                this._application.FailuresProcessing -= CaptureFailures;
                failureEvidence["status"] = "unsubscribed";
                WriteCheckpoint(failurePath, failureEvidence);
            }
        } finally {
            project.Close(false);
            Assert.That(System.Security.Cryptography.SHA256.HashData(File.ReadAllBytes(original)), Is.EqualTo(originalHash),
                "Original template fixture was modified.");
        }
    }

    private static IReadOnlyList<string> CaptureJoinGraph(Document project, Family family) {
        var document = project.EditFamily(family);
        try {
            static string Describe(CombinableElement element) =>
                $"{element.UniqueId}|{element.GetType().Name}|{element.Category?.Name ?? "<none>"}";
            return new FilteredElementCollector(document).WhereElementIsNotElementType().OfType<CombinableElement>()
                .SelectMany(element => element.Combinations.Cast<GeomCombination>())
                .DistinctBy(combination => combination.Id)
                .Select(combination => combination.AllMembers.Cast<CombinableElement>()
                    .Select(Describe).OrderBy(member => member, StringComparer.Ordinal).ToList())
                .Where(members => members.Count > 1)
                .Select(members => string.Join("<->", members))
                .OrderBy(combination => combination, StringComparer.Ordinal)
                .ToList();
        } finally { document.Close(false); }
    }

    [TestCase("800 - 120v - 11.5 gal/day")]
    [TestCase("800 - 120v - 16 gal/day")]
    [TestCase("800 - 240v - 23.3 gal/day")]
    [TestCase("800 - 240v - 34.6 gal/day")]
    [Timeout(600000)]
    public void AprilAire_dimension_labels_preserve_all_type_values_and_current_type(string currentType) {
        const string familyName = "AprilAire 800 801 Series Humidifier";
        const string profilePath = "CmdFFManager/profiles/SavedEquip/AprilAire 800 Series.json";
        var original = RevitFamilyFixtureHarness.GetProjectFixturePath("Old_Template.rvt");
        var originalHash = System.Security.Cryptography.SHA256.HashData(File.ReadAllBytes(original));
        var output = RevitFamilyFixtureHarness.CreateTemporaryOutputDirectory(nameof(AprilAire_dimension_labels_preserve_all_type_values_and_current_type));
        var copy = Path.Combine(output, "Old_Template.rvt");
        File.Copy(original, copy);
        var project = this._application.OpenDocumentFile(copy);
        try {
            var settings = (JObject)JArray.Parse(File.ReadAllText(RevitFamilyFixtureHarness.GetProfileFixturePath("company-composed-20260906.json")))
                .Single(profile => (string)profile["source"]! == profilePath)["settings"]!;
            var conversion = CompanyNormalizationFixture.ConvertProfileParameters(settings, project, CompanyCorpusDefinitions());
            var family = new FilteredElementCollector(project).OfClass(typeof(Family)).Cast<Family>().Single(candidate => candidate.Name == familyName);
            string CurrentTypeName(Family target) {
                var document = project.EditFamily(target);
                try { return document.FamilyManager.CurrentType.Name; }
                finally { document.Close(false); }
            }
            var seed = project.EditFamily(family);
            try {
                using var transaction = new Transaction(seed, "Select initial type");
                transaction.Start();
                seed.FamilyManager.CurrentType = seed.FamilyManager.Types.Cast<FamilyType>().Single(type => type.Name == currentType);
                Assert.That(transaction.Commit(), Is.EqualTo(TransactionStatus.Committed));
                family = seed.LoadFamily(project, new DefaultFamilyLoadOptions());
            } finally { seed.Close(false); }
            Assert.That(CurrentTypeName(family), Is.EqualTo(currentType));

            ReconcileFamily Apply(Family target) {
                var operation = new ReconcileFamily(conversion.Patch,
                    sharedSource: document => new FamilySharedParameterSource(document, CompanyCorpusDefinitions()));
                using var processor = new OperationProcessor(project, conversion.Options);
                var (contexts, _) = processor.SelectFamilies(() => [target]).ProcessQueue(new OperationQueue().Add(operation));
                var (_, error) = contexts.Single().OperationLogs;
                Assert.That(error, Is.Null, error?.Message);
                Assert.That(operation.LastReceipt?.Converged, Is.True,
                    "Every value, unset state, and formula must survive dimension-label regeneration without residue.");
                return operation;
            }

            Apply(family);
            var loaded = new FilteredElementCollector(project).OfClass(typeof(Family)).Cast<Family>().Single(candidate => candidate.Name == familyName);
            Assert.That(CurrentTypeName(loaded), Is.EqualTo(currentType));
            var repeated = Apply(loaded);
            Assert.That(repeated.LastPlan!.Changes, Is.Empty);
        } finally {
            project.Close(false);
            Assert.That(System.Security.Cryptography.SHA256.HashData(File.ReadAllBytes(original)), Is.EqualTo(originalHash));
        }
    }

    [Test, Timeout(3600000)]
    public void Old_template_all_editable_mechanical_families_migrate_company_mapping() {
        const string selectionVariable = "PE_FF_OLD_TEMPLATE_FAMILY_SELECTION";
        var original = RevitFamilyFixtureHarness.GetProjectFixturePath("Old_Template.rvt");
        var originalHash = System.Security.Cryptography.SHA256.HashData(File.ReadAllBytes(original));
        var output = RevitFamilyFixtureHarness.CreateTemporaryOutputDirectory(nameof(Old_template_all_editable_mechanical_families_migrate_company_mapping));
        var checkpointPath = Path.Combine(output, "company-template-migration.json");
        var copy = Path.Combine(output, "Old_Template.rvt");
        File.Copy(original, copy);
        var project = this._application.OpenDocumentFile(copy);
        var evidence = new JObject { ["status"] = "starting", ["fixtureSha256"] = string.Concat(originalHash.Select(value => value.ToString("X2"))),
            ["selectionInput"] = Environment.GetEnvironmentVariable(selectionVariable), ["completed"] = new JArray(), ["remaining"] = new JArray() };
        var failures = new List<string>();
        try {
            var mappings = CompanyNormalizationFixture.MechanicalMappings();
            var names = mappings.MappingData.Select(m => m.NewName).ToHashSet(StringComparer.Ordinal);
            // 2026-09-07 ruling: connector Number of Poles routes explicitly to PE_E___NumberOfPoles, never through legacy Phase.
            // The company MechEquip profiles route all four connector slots; the sweep carries the same rule for every family
            // that already has an electrical connector and never creates one (creation belongs to the profile lane).
            var connectorRule = new ElectricalConnectorParameterRule { Voltage = "PE_E___Voltage", NumberOfPoles = "PE_E___NumberOfPoles",
                ApparentPower = "PE_E___ApparentPower", MinimumCircuitAmpacity = "PE_E___MCA", CreateIfAbsent = false };
            names.UnionWith([connectorRule.Voltage, connectorRule.NumberOfPoles, connectorRule.ApparentPower, connectorRule.MinimumCircuitAmpacity]);
            var definitions = JsonConvert.DeserializeObject<List<ParametersApi.Parameters.ParametersResult>>(File.ReadAllText(
                RevitFamilyFixtureHarness.GetProfileFixturePath("normalization-company-definitions.json")))!.Where(d => names.Contains(d.Name!)).ToList();
            Assert.That(definitions.Count, Is.EqualTo(39), "38 mapped mechanical definitions plus the routed PE_E___ApparentPower.");
            FamilyPatch WithRule(FamilyPatch converted, Dictionary<string, FailureAction>? failures = null) => new() { Select = converted.Select, Patch = converted.Patch,
                Run = new PatchRun { ElectricalConnectorParameters = connectorRule, ParametersIfSourceExists = converted.Run?.ParametersIfSourceExists,
                    Clean = converted.Run?.Clean, Sort = converted.Run?.Sort, BlanksBecome = converted.Run?.BlanksBecome, Failures = failures } };
            var patch = WithRule(CompanyNormalizationFixture.Convert(mappings, names));
            var scopedOverride = CompanyNormalizationFixture.OldTemplateHorsepowerOverride();
            var scopedPatch = WithRule(CompanyNormalizationFixture.Convert(scopedOverride.Mappings, names));
            // 2026-09-08 ruling: PVFY's one-way angular rig (`z Duct Angle = z Type Flow * 180 deg`) posts "Constraints are not satisfied"
            // whenever the type cursor moves; this family alone lets Revit unlock that constraint, and the receipt must say so.
            const string pvfy = "Mitsubishi_PVFY-NAMU-E1";
            var pvfyPatch = WithRule(CompanyNormalizationFixture.Convert(mappings, names), new() { ["constraintsNotSatisfied"] = FailureAction.Resolve });
            var families = new FilteredElementCollector(project).OfClass(typeof(Family)).Cast<Family>()
                .Where(f => f.IsEditable && f.FamilyCategory?.BuiltInCategory == BuiltInCategory.OST_MechanicalEquipment)
                .Select(f => f.Name).OrderBy(name => name, StringComparer.Ordinal).ToList();
            Assert.That(families, Is.Not.Empty, "The real template must provide migration candidates.");
            var selectionPath = Environment.GetEnvironmentVariable(selectionVariable);
            var requested = selectionPath is null ? families : File.ReadAllLines(selectionPath)
                .Select(name => name.Trim()).Where(name => name.Length > 0).ToList();
            Assert.That(requested, Is.Not.Empty, $"{selectionVariable} must name at least one family.");
            Assert.That(requested.Distinct(StringComparer.Ordinal).Count(), Is.EqualTo(requested.Count), "Selection contains duplicate family names.");
            Assert.That(requested.Except(families, StringComparer.Ordinal), Is.Empty, "Selection contains ineligible or missing family names.");
            var selected = requested;
            evidence["status"] = "running";
            evidence["eligible"] = new JArray(families);
            evidence["selected"] = new JArray(selected);
            evidence["unselected"] = new JArray(families.Except(selected, StringComparer.Ordinal));
            evidence["remaining"] = new JArray(selected);
            WriteCheckpoint(checkpointPath, evidence);
            foreach (var familyName in selected) {
                var timer = System.Diagnostics.Stopwatch.StartNew();
                var familyFailures = new List<string>();
                var family = new FilteredElementCollector(project).OfClass(typeof(Family)).Cast<Family>().Single(f => f.Name == familyName);
                var originalId = family.Id;
                var originalUniqueId = family.UniqueId;
                var before = Pe.Revit.DocumentData.Families.Extraction.FamilySnapshotExtractor.ExtractFromProjectFamily(project, family);
                // The immutable fixture holds the source alias (`Minimum Circuit Ampacity` = `Amperage`); migration creates PE_E___MCA.
                var fantechMcaBefore = familyName == "Fantech - MUAH Heater"
                    ? before.Parameters.SingleOrDefault(parameter => parameter.Definition.Identity.Name == "PE_E___MCA")
                      ?? before.Parameters.Single(parameter => parameter.Definition.Identity.Name == "Minimum Circuit Ampacity")
                    : null;
                var operation = new ReconcileFamily(familyName == pvfy ? pvfyPatch : scopedOverride.Families.Contains(familyName) ? scopedPatch : patch,
                    sharedSource: d => new FamilySharedParameterSource(d, definitions));
                using var processor = new OperationProcessor(project);
                var (contexts, processorMs) = processor.SelectFamilies(() => [family]).ProcessQueue(new OperationQueue().Add(operation));
                var (operationLogs, error) = contexts.Single().OperationLogs;
                var loaded = new FilteredElementCollector(project).OfClass(typeof(Family)).Cast<Family>().SingleOrDefault(f => f.Name == familyName);
                var assertions = new JObject { ["loadedFamilyPresent"] = loaded is not null,
                    ["committedConverged"] = error is null && operation.LastReceipt?.Converged == true,
                    ["runEffects"] = new JArray(operation.LastReceipt?.RunEffects ?? []) };
                if (familyName == pvfy && operation.LastReceipt?.RunEffects.Any(e => e.Contains($"{FamilyFailurePolicy.ResolvedPrefix}constraintsNotSatisfied", StringComparison.Ordinal)) != true)
                    familyFailures.Add("PVFY receipt does not record the resolved constraint as a RunEffect");
                if (loaded is null) familyFailures.Add("loaded family disappeared");
                else if (error is null && Environment.GetEnvironmentVariable("PE_FF_OLD_TEMPLATE_SAVE_DIR") is { Length: > 0 } saveDir) {
                    // Review export only: the migrated family as an .rfa beside the checkpoint. The project itself is never saved.
                    // Re-opening a family Revit resolved under run.failures can post the same error again (PVFY, run 17); the
                    // failure scope records it on the row instead of a modal dialog, and the export is skipped.
                    var exportDiagnostics = new List<(bool IsError, string Message)>();
                    try {
                        Pe.Revit.Tasks.RevitFailureScope.Execute(project, accessor => FamilyFailurePolicy.Reject.Apply(accessor, exportDiagnostics), () => {
                            var export = new FamilyDocument(project.EditFamily(loaded));
                            try {
                                var fileName = string.Concat(familyName.Select(c => Path.GetInvalidFileNameChars().Contains(c) ? '_' : c)) + ".rfa";
                                export.SaveAs(Path.Combine(saveDir, fileName), new SaveAsOptions { OverwriteExistingFile = true, Compact = true });
                            } finally { _ = export.Close(false); }
                            return true;
                        });
                    } catch (Exception exportFailure) {
                        exportDiagnostics.Add((true, exportFailure.Message));
                    }
                    assertions["reviewExport"] = exportDiagnostics.Count == 0 ? "saved" : string.Join("; ", exportDiagnostics.Select(d => d.Message));
                }
                if (loaded is not null) {
                    var after = Pe.Revit.DocumentData.Families.Extraction.FamilySnapshotExtractor.ExtractFromProjectFamily(project, loaded);
                    if (error is not null || operation.LastReceipt?.Converged != true) {
                        familyFailures.Add(error?.Message ?? "No committed converged receipt");
                        assertions["rollbackIdentityPreserved"] = loaded.Id == originalId && loaded.UniqueId == originalUniqueId;
                        assertions["rollbackParameterMatrixPreserved"] = JToken.DeepEquals(JToken.FromObject(before.Parameters), JToken.FromObject(after.Parameters));
                        if (assertions.Value<bool>("rollbackIdentityPreserved") != true) familyFailures.Add("failed migration changed project identity");
                        if (assertions.Value<bool>("rollbackParameterMatrixPreserved") != true) familyFailures.Add("failed migration changed the loaded parameter matrix");
                    } else {
                        assertions["completeParameterEvidence"] = before.Issues.Count == 0 && after.Issues.Count == 0;
                        if (assertions.Value<bool>("completeParameterEvidence") != true) familyFailures.Add("incomplete parameter evidence");
                        var exact = definitions.Count(definition => after.Parameters.Any(parameter => parameter.Definition.Identity.Name == definition.Name &&
                            parameter.Definition.Identity.SharedGuid == definition.DownloadOptions.GetGuid().ToString()));
                        assertions["exactSharedIdentityCount"] = exact;
                        assertions["all38SharedIdentities"] = exact == definitions.Count;
                        if (exact != definitions.Count) familyFailures.Add($"exact shared identities: {exact}/{definitions.Count}");
                        if (fantechMcaBefore is not null) {
                            var fantechMcaAfter = after.Parameters.Single(parameter => parameter.Definition.Identity.Name == "PE_E___MCA");
                            var valuesPreserved = fantechMcaBefore.ValuesPerType.Count == fantechMcaAfter.ValuesPerType.Count &&
                                fantechMcaBefore.ValuesPerType.All(value => fantechMcaAfter.ValuesPerType.TryGetValue(value.Key, out var afterValue) && afterValue == value.Value);
                            assertions["fantechMcaSourceWasExactAlias"] = fantechMcaBefore.Formula == "Amperage";
                            assertions["fantechMcaValuesPreserved"] = valuesPreserved;
                            assertions["fantechMcaAliasCleared"] = fantechMcaAfter.Formula is null;
                            if (fantechMcaBefore.Formula != "Amperage") familyFailures.Add($"unexpected original PE_E___MCA formula: {fantechMcaBefore.Formula}");
                            if (!valuesPreserved) familyFailures.Add("PE_E___MCA per-type values changed while materializing Amperage alias");
                            if (fantechMcaAfter.Formula is not null) familyFailures.Add($"PE_E___MCA alias remained: {fantechMcaAfter.Formula}");
                        }
                    }
                }
                timer.Stop();
                failures.AddRange(familyFailures.Select(failure => $"{familyName}: {failure}"));
                ((JArray)evidence["completed"]!).Add(new JObject { ["familyName"] = familyName, ["familyId"] = originalId.Value(),
                    ["familyUniqueId"] = originalUniqueId, ["result"] = familyFailures.Count == 0 ? "passed" : "failed",
                    ["elapsedMs"] = timer.Elapsed.TotalMilliseconds, ["processorMs"] = processorMs,
                    // OperationsMs is the reconcile body alone; elapsedMs - operationsMs is EditFamily + LoadFamily + close.
                    ["operationsMs"] = contexts.Single().OperationsMs,
                    ["operations"] = new JArray((operationLogs ?? []).Select(log => new JObject { ["name"] = log.OperationName, ["msElapsed"] = log.MsElapsed })),
                    ["complexity"] = contexts.Single().Complexity is { } complexity ? new JObject { ["sketchPlanes"] = complexity.SketchPlanes,
                        ["elements"] = complexity.Elements, ["types"] = complexity.Types, ["predictedSeconds"] = complexity.PredictedSeconds } : null,
                    ["dependencyGraph"] = contexts.Single().DependencyGraph,
                    ["assertions"] = assertions, ["receipt"] = operation.LastReceipt is null ? null : JObject.FromObject(operation.LastReceipt),
                    ["error"] = error?.ToString(), ["failures"] = new JArray(familyFailures) });
                evidence["remaining"] = new JArray(selected.Skip(((JArray)evidence["completed"]!).Count));
                WriteCheckpoint(checkpointPath, evidence);
            }
            evidence["status"] = failures.Count == 0 ? "passed" : "completedWithFailures";
            WriteCheckpoint(checkpointPath, evidence);
            Assert.That(failures, Is.Empty, string.Join(Environment.NewLine, failures));
        } finally {
            if (evidence.Value<string>("status") == "running") evidence["status"] = "interrupted";
            WriteCheckpoint(checkpointPath, evidence);
            project.Close(false);
            Assert.That(System.Security.Cryptography.SHA256.HashData(File.ReadAllBytes(original)), Is.EqualTo(originalHash), "Original template fixture was modified.");
        }
    }

    [Test, Timeout(3600000), Category("CompanyCorpus")]
    public void Old_template_plans_every_composed_company_profile_against_its_authored_selector() {
        var original = RevitFamilyFixtureHarness.GetProjectFixturePath("Old_Template.rvt");
        var output = RevitFamilyFixtureHarness.CreateTemporaryOutputDirectory(nameof(Old_template_plans_every_composed_company_profile_against_its_authored_selector));
        var checkpointPath = Path.Combine(output, "company-profile-plan-census.json");
        var copy = Path.Combine(output, "Old_Template.rvt");
        File.Copy(original, copy);
        var evidence = new JObject { ["status"] = "starting", ["profiles"] = new JArray() };
        var failures = new List<string>();
        var project = this._application.OpenDocumentFile(copy);
        try {
            var profiles = JArray.Parse(File.ReadAllText(RevitFamilyFixtureHarness.GetProfileFixturePath("company-composed-20260906.json"))).OfType<JObject>().ToList();
            var definitions = CompanyCorpusDefinitions();
            var eligible = project.FamiliesMatching(new PatchSelect());
            var mechanical = eligible.Where(f => f.FamilyCategory?.BuiltInCategory == BuiltInCategory.OST_MechanicalEquipment).ToList();
            var placed = new FilteredElementCollector(project).OfClass(typeof(FamilyInstance)).Cast<FamilyInstance>()
                .GroupBy(instance => instance.Symbol.Family.Id).ToDictionary(group => group.Key, group => group.Count());
            evidence["status"] = "running";
            evidence["eligible"] = new JArray(eligible.Select(f => new JObject {
                ["familyId"] = f.Id.Value(), ["familyName"] = f.Name, ["category"] = f.FamilyCategory?.Name,
                ["placedInstanceCount"] = placed.TryGetValue(f.Id, out var count) ? count : 0
            }));
            evidence["mechanical81"] = new JArray(mechanical.Select(f => f.Name));
            WriteCheckpoint(checkpointPath, evidence);
            Assert.That(mechanical, Has.Count.EqualTo(81), "The frozen Old Template Mechanical Equipment census changed.");
            Assert.That(profiles, Has.Count.EqualTo(45), "The frozen composed company corpus changed.");
            foreach (var profile in profiles) {
                var source = (string)profile["source"]!;
                var row = new JObject { ["source"] = source };
                ((JArray)evidence["profiles"]!).Add(row);
                try {
                    var settings = CompanyNormalizationFixture.ApplyNativeProfileOverride(source, (JObject)profile["settings"]!);
                    var conversion = Pe.Revit.FamilyFoundry.Apply.FamilyProfileConverter.Convert(settings, definitions, project.GetUnits());
                    row["select"] = JObject.FromObject(conversion.Patch.Select, JsonSerializer.Create(FamilyModelJson.Settings));
                    row["patchSections"] = new JArray(((JObject)conversion.Patch.Patch).Properties().Select(p => p.Name));
                    row["hasRun"] = conversion.Patch.Run is not null;
                    var selected = project.FamiliesMatching(conversion.Patch.Select);
                    row["selected"] = new JArray(selected.Select(f => f.Name));
                    var plans = new JArray();
                    row["plans"] = plans;
                    foreach (var family in selected) {
                        var pair = new JObject { ["familyId"] = family.Id.Value(), ["familyName"] = family.Name };
                        plans.Add(pair);
                        try {
                            var plan = FamilyFoundryBridgeOps.PlanFamilies(
                                new FamilyFoundryPlanRequest(JsonConvert.SerializeObject(conversion.Patch), family.Id.Value()), project);
                            pair["plan"] = JObject.FromObject(plan);
                            if (plan.Diagnostics.Count > 0 || plan.Families.Any(f => f.Refusals.Count > 0))
                                failures.Add($"{source} -> {family.Name}: native plan diagnostics");
                        } catch (Exception exception) {
                            pair["error"] = exception.ToString();
                            failures.Add($"{source} -> {family.Name}: {exception.Message}");
                        }
                        WriteCheckpoint(checkpointPath, evidence);
                    }
                } catch (Exception exception) {
                    row["error"] = exception.ToString();
                    failures.Add($"{source}: {exception.Message}");
                }
                WriteCheckpoint(checkpointPath, evidence);
            }
            evidence["status"] = failures.Count == 0 ? "passed" : "failed";
            evidence["failures"] = new JArray(failures);
            WriteCheckpoint(checkpointPath, evidence);
            Assert.That(failures, Is.Empty, string.Join(Environment.NewLine, failures));
        } finally {
            try {
                if (evidence.Value<string>("status") is "starting" or "running") evidence["status"] = "interrupted";
                WriteCheckpoint(checkpointPath, evidence);
            } finally { project.Close(false); }
        }
    }

    /// <summary>
    ///     Rung 5b (kaitpw 2026-09-08): the converted company profiles themselves, applied natively. Formulas, connector creation, tag values,
    ///     clean, sort and the -1 sentinel, then an empty second plan. Three profiles are the agreed guarantee; HP is cut to two families.
    /// </summary>
    [Test, Timeout(3600000)]
    public void Old_template_applies_composed_company_profiles_natively() {
        var profileFamilies = new Dictionary<string, string[]?>(StringComparer.Ordinal) {
            ["CmdFFMigrator/profiles/MechEquip/SH.json"] = null,
            // FV-0511VK2 rolls back on "Constraints are not satisfied" once run.clean purges its planes (LEDGER 2026-09-08); named out until diagnosed.
            ["CmdFFMigrator/profiles/MechEquip/Fan.json"] = ["Tamarack Technologies Dragon Garage Fan", "Thunderbird Dryer Vent", "Panasonic - WhisperGreen Select - FV-0511VKSL2 - Exhaust Fan Light",
                "Panasonic - WhisperLine - Remote Mount In-Line Fan - Exhaust Fan", "Panasonic - WhisperValue DC - FV-0510VS1 - Exhaust Fan",
                "Panasonic - WhisperRecessed LED Designer Fan - FV-08VRE2 - Exhaust Fan Light", "Fantech - prioAir 6 EC Inline Fan", "Fantech - prioAir 10 EC Inline Fan BETA"],
            // PVFY is out until the unbalanced two-pole connector has a ruling (LEDGER 2026-09-08).
            ["CmdFFMigrator/profiles/MechEquip/HP.json"] = ["Mitsubishi_PKA-HA", "Mitsubishi_SLZ-KA"]
        };
        var original = RevitFamilyFixtureHarness.GetProjectFixturePath("Old_Template.rvt");
        var originalHash = System.Security.Cryptography.SHA256.HashData(File.ReadAllBytes(original));
        var output = RevitFamilyFixtureHarness.CreateTemporaryOutputDirectory(nameof(Old_template_applies_composed_company_profiles_natively));
        var checkpointPath = Path.Combine(output, "company-profile-apply.json");
        var copy = Path.Combine(output, "Old_Template.rvt");
        File.Copy(original, copy);
        var project = this._application.OpenDocumentFile(copy);
        var evidence = new JObject { ["status"] = "running", ["families"] = new JArray() };
        var failures = new List<string>();
        var saveDir = Environment.GetEnvironmentVariable("PE_FF_OLD_TEMPLATE_SAVE_DIR") is { Length: > 0 } root ? Directory.CreateDirectory(Path.Combine(root, "profiles")).FullName : null;
        try {
            var profiles = JArray.Parse(File.ReadAllText(RevitFamilyFixtureHarness.GetProfileFixturePath("company-composed-20260906.json"))).OfType<JObject>()
                .ToDictionary(p => (string)p["source"]!, StringComparer.Ordinal);
            var definitions = CompanyCorpusDefinitions();
            foreach (var (source, only) in profileFamilies) {
                var settings = CompanyNormalizationFixture.ApplyNativeProfileOverride(source, (JObject)profiles[source]["settings"]!);
                var patch = FamilyProfileConverter.Convert(settings, definitions, project.GetUnits()).Patch;
                var authored = ((JObject)patch.Patch["parameters"]!).Properties().Where(p => p.Value is JObject).ToList();
                var formulas = authored.Where(p => p.Value["formula"]?.Type == JTokenType.String).ToDictionary(p => p.Name, p => (string)p.Value["formula"]!, StringComparer.Ordinal);
                var values = authored.Where(p => p.Value["value"]?.Type == JTokenType.String).ToDictionary(p => p.Name, p => (string)p.Value["value"]!, StringComparer.Ordinal);
                var rule = patch.Run?.ElectricalConnectorParameters;
                var sentinelSpecs = (patch.Run?.BlanksBecome ?? []).SelectMany(r => r.Specs).Select(SetParamMetadata.Spec).ToList();
                foreach (var family in project.FamiliesMatching(patch.Select).Where(f => only is null || only.Contains(f.Name)).OrderBy(f => f.Name, StringComparer.Ordinal).ToList()) {
                    var familyName = family.Name;
                    var row = new JObject { ["profile"] = source, ["familyName"] = familyName };
                    ((JArray)evidence["families"]!).Add(row);
                    var familyFailures = new List<string>();
                    try {
                        var familyPatch = familyName == "Mitsubishi_PVFY-NAMU-E1" ? WithFailures(patch, new() { ["constraintsNotSatisfied"] = FailureAction.Resolve }) : patch;
                        var operation = new ReconcileFamily(familyPatch, sharedSource: d => new FamilySharedParameterSource(d, definitions));
                        using var processor = new OperationProcessor(project);
                        var (contexts, _) = processor.SelectFamilies(() => [family]).ProcessQueue(new OperationQueue().Add(operation));
                        var (_, error) = contexts.Single().OperationLogs;
                        row["receipt"] = operation.LastReceipt is null ? null : JObject.FromObject(operation.LastReceipt);
                        row["complexity"] = contexts.Single().Complexity?.ToString();
                        if (error is not null || operation.LastReceipt?.Converged != true) { familyFailures.Add(error?.Message ?? "no converged receipt"); continue; }
                        var loaded = new FilteredElementCollector(project).OfClass(typeof(Family)).Cast<Family>().Single(f => f.Name == familyName);
                        var inspect = new List<(bool IsError, string Message)>();
                        Pe.Revit.Tasks.RevitFailureScope.Execute(project, accessor => FamilyFailurePolicy.Reject.Apply(accessor, inspect), () => {
                            var document = new FamilyDocument(project.EditFamily(loaded));
                            try {
                                var fm = document.FamilyManager;
                                var types = fm.Types.Cast<FamilyType>().ToList();
                                if (rule is not null) {
                                    var power = new FilteredElementCollector(document.Document).OfClass(typeof(ConnectorElement)).Cast<ConnectorElement>().Where(c => c.IsPowerConnector()).ToList();
                                    row["powerConnectors"] = power.Count;
                                    if (power.Count == 0) familyFailures.Add("no power connector after the profile's connector rule");
                                    foreach (var connector in power)
                                        foreach (var (slot, name) in new[] { (BuiltInParameter.RBS_ELEC_VOLTAGE, rule.Voltage), (BuiltInParameter.RBS_ELEC_NUMBER_OF_POLES, rule.NumberOfPoles), (BuiltInParameter.RBS_ELEC_APPARENT_LOAD, rule.ApparentPower) })
                                            if (fm.GetAssociatedFamilyParameter(connector.AssociableSlot(slot))?.Definition.Name != name)
                                                familyFailures.Add($"connector {connector.Id.Value()} slot {slot} is not associated to {name}");
                                }
                                foreach (var (name, formula) in formulas) {
                                    var actual = fm.get_Parameter(name)?.Formula;
                                    row[$"formula:{name}"] = actual;
                                    if (string.IsNullOrEmpty(actual)) familyFailures.Add($"{name} has no formula; the profile authored '{formula}'");
                                }
                                foreach (var (name, value) in values) {
                                    var parameter = fm.get_Parameter(name);
                                    var actual = parameter is null ? null : types.Select(t => t.AsString(parameter) ?? t.AsValueString(parameter)).FirstOrDefault();
                                    row[$"value:{name}"] = actual;
                                    if (actual != value) familyFailures.Add($"{name} reads '{actual}'; the profile authored '{value}'");
                                }
                                var numeric = fm.GetParameters().Where(p => string.IsNullOrEmpty(p.Formula) && !p.IsReadOnly && sentinelSpecs.Contains(p.Definition.GetDataType())).ToList();
                                var blank = numeric.SelectMany(p => types.Where(t => !document.HasValue(t, p)).Select(t => $"{p.Definition.Name}@{t.Name}")).ToList();
                                row["blankNumericCells"] = new JArray(blank);
                                row["numericValues"] = new JObject(numeric.Select(p => new JProperty(p.Definition.Name, types.Select(t => t.AsValueString(p)).FirstOrDefault())));
                                if (blank.Count > 0) familyFailures.Add($"{blank.Count} numeric cells still blank after run.blanksBecome: {string.Join(", ", blank.Take(5))}");
                                if (saveDir is { Length: > 0 })
                                    document.SaveAs(Path.Combine(saveDir, string.Concat(familyName.Select(c => Path.GetInvalidFileNameChars().Contains(c) ? '_' : c)) + ".rfa"),
                                        new SaveAsOptions { OverwriteExistingFile = true, Compact = true });
                            } finally { _ = document.Close(false); }
                            return true;
                        });
                        familyFailures.AddRange(inspect.Where(d => d.IsError).Select(d => $"inspect: {d.Message}"));
                        // Second plan through the library, not Pe.App.Host: an installed Pe.App beside the test DLL wins the type load (rung 7).
                        var dry = new ReconcileFamily(familyPatch, dryRun: true, sharedSource: d => new FamilySharedParameterSource(d, definitions));
                        using (var replanner = new OperationProcessor(project))
                            _ = replanner.SelectFamilies(() => [loaded]).ProcessQueue(new OperationQueue().Add(dry), loadAndSaveOptions: new LoadAndSaveOptions { LoadFamily = false });
                        var replan = dry.LastPlan;
                        row["replanChanges"] = new JArray((replan?.Changes ?? []).Select(c => new JObject { ["change"] = $"{c.Section}:{c.Key} {c.Kind}",
                            ["before"] = c.Before is null ? null : JToken.FromObject(c.Before), ["after"] = c.After is null ? null : JToken.FromObject(c.After) }));
                        if (replan is null) familyFailures.Add("second plan was not produced");
                        else if (replan.Changes.Count > 0 || replan.Refusals.Count > 0) familyFailures.Add($"second plan is not empty: {replan.Changes.Count} changes, {replan.Refusals.Count} refusals");
                    } catch (Exception exception) {
                        familyFailures.Add(exception.Message);
                        row["error"] = exception.ToString();
                    } finally {
                        row["result"] = familyFailures.Count == 0 ? "passed" : "failed";
                        row["failures"] = new JArray(familyFailures);
                        failures.AddRange(familyFailures.Select(f => $"{familyName}: {f}"));
                        WriteCheckpoint(checkpointPath, evidence);
                    }
                }
            }
            evidence["status"] = failures.Count == 0 ? "passed" : "completedWithFailures";
            WriteCheckpoint(checkpointPath, evidence);
            Assert.That(failures, Is.Empty, string.Join(Environment.NewLine, failures));
        } finally {
            WriteCheckpoint(checkpointPath, evidence);
            project.Close(false);
            Assert.That(System.Security.Cryptography.SHA256.HashData(File.ReadAllBytes(original)), Is.EqualTo(originalHash), "Original template fixture was modified.");
        }
    }

    private static FamilyPatch WithFailures(FamilyPatch patch, Dictionary<string, FailureAction> failures) => new() { Select = patch.Select, Patch = patch.Patch,
        Run = new PatchRun { ParametersIfSourceExists = patch.Run?.ParametersIfSourceExists, ElectricalConnectorParameters = patch.Run?.ElectricalConnectorParameters,
            BlanksBecome = patch.Run?.BlanksBecome, Clean = patch.Run?.Clean, Sort = patch.Run?.Sort, Failures = failures } };

    private static void WriteCheckpoint(string path, JObject evidence) {
        var pending = path + ".pending";
        File.WriteAllText(pending, evidence.ToString());
        if (!File.Exists(path)) {
            File.Move(pending, path);
            return;
        }

        const int attempts = 5;
        for (var attempt = 1; ; attempt++) {
            try {
                File.Replace(pending, path, null);
                return;
            } catch (IOException ex) {
                if (attempt == attempts)
                    throw new IOException($"Checkpoint replace failed after {attempts} attempts (HResult 0x{ex.HResult:X8}). Previous and pending checkpoints were retained.", ex);
                Thread.Sleep(25 * attempt);
            }
        }
    }

    [Test]
    public void Company_shared_definition_replaces_local_source_with_exact_guid_and_values() {
        var document = this.NewFamily("FF company width");
        try {
            var definitions = CompanyDefinitions();
            var requested = definitions.Single(p => p.Name == "PE_G_Dim_Width1");
            var originalSetting = this._application.SharedParametersFilename;
            var converted = CompanyNormalizationFixture.Convert(CompanyNormalizationFixture.MechanicalMappings(), [requested.Name!]);
            converted.Patch["parameters"]![requested.Name!]!["value"] = "5ft";
            var operation = new ReconcileFamily(converted, sharedSource: d => new FamilySharedParameterSource(d, definitions));
            using var processor = new OperationProcessor(document);
            var (contexts, _) = processor.ProcessQueue(new OperationQueue().Add(operation));
            var (_, error) = contexts.Single().OperationLogs;
            Assert.That(error, Is.Null, error?.Message);
            Assert.That(operation.LastReceipt?.Converged, Is.True);
            var parameter = document.FamilyManager.FindParameter(requested.Name!);
            Assert.That(parameter.GUID, Is.EqualTo(requested.DownloadOptions.GetGuid()));
            Assert.That(document.CaptureFamilyModel().Parameters[requested.Name!].SharedGuid, Is.EqualTo(parameter.GUID));
            Assert.That(document.FamilyManager.FindParameter("Width"), Is.Null);
            foreach (var type in document.FamilyManager.Types.Cast<FamilyType>().Where(t => t.Name is "A" or "B"))
                Assert.That(type.AsDouble(parameter), Is.EqualTo(5.0));
            using (var source = new FamilySharedParameterSource(document, definitions))
                Assert.That(source.GetDefinition(requested.Name!).Description, Is.EqualTo(requested.Description), "native source tooltip; not a claim of internal-definition readback");
            Assert.That(this._application.SharedParametersFilename, Is.EqualTo(originalSetting));
        } finally { document.Close(false); }
    }

    [TestCase(true)]
    [TestCase(false)]
    public void Company_horsepower_na_is_missing_only_when_the_mapping_authors_it(bool companyMapping) {
        var document = this.NewFamily(companyMapping ? "FF company missing horsepower" : "FF unrelated horsepower");
        try {
            using (var seed = new Transaction(document, "Seed text horsepower sentinel")) {
                seed.Start();
                var source = document.FamilyManager.AddParameter("Horsepower (HP)", GroupTypeId.Data, SpecTypeId.String.Text, false);
                foreach (var type in document.FamilyManager.Types.Cast<FamilyType>()) {
                    document.FamilyManager.CurrentType = type;
                    document.FamilyManager.Set(source, "N/A");
                }
                Assert.That(seed.Commit(), Is.EqualTo(TransactionStatus.Committed));
            }
            var definitions = CompanyCorpusDefinitions();
            var definition = definitions.Single(item => item.Name == "PE_G_Perf_Horsepower");
            var mappings = companyMapping ? CompanyNormalizationFixture.OldTemplateHorsepowerOverride().Mappings : CompanyNormalizationFixture.MechanicalMappings();
            var patch = Pe.Revit.FamilyFoundry.Apply.FamilyProfileConverter.ExportSharedMappings(mappings, [definition]);
            Assert.That(patch.Patch["parameters"]![definition.Name!]!["sourceValuesTreatedAsMissing"] is not null, Is.EqualTo(companyMapping));
            var before = document.CaptureFamilyModel();
            var operation = new ReconcileFamily(patch, sharedSource: d => new FamilySharedParameterSource(d, definitions));
            using var processor = new OperationProcessor(document);
            var (contexts, _) = processor.ProcessQueue(new OperationQueue().Add(operation));
            var (_, error) = contexts.Single().OperationLogs;
            if (!companyMapping) {
                Assert.That(error?.ToString(), Does.Contain("SourceValue='N/A'").And.Contain("PE_G_Perf_Horsepower"));
                Assert.That(FamilyModelJson.Serialize(document.CaptureFamilyModel()), Is.EqualTo(FamilyModelJson.Serialize(before)));
                return;
            }
            Assert.That(error, Is.Null, error?.Message);
            Assert.That(operation.LastReceipt?.Converged, Is.True);
            Assert.That(document.FamilyManager.FindParameter("Horsepower (HP)"), Is.Null);
            var target = document.FamilyManager.FindParameter(definition.Name!);
            Assert.That(target, Is.Not.Null);
            Assert.That(document.FamilyManager.Types.Cast<FamilyType>().Any(type => type.HasValue(target)), Is.False,
                "No profile default was authored, so the missing source leaves the target blank.");
        } finally { document.Close(false); }
    }

    [Test]
    public void Captured_raw_values_rebuild_despite_rounded_symbol_suppressed_display() {
        var source = this.NewFamily("FF exact capture");
        var target = this.NewFamily("FF exact rebuild");
        var values = new[] {
            (Name: "Width", Spec: SpecTypeId.Length, Unit: UnitTypeId.Millimeters, Raw: 1.23456789012345),
            (Name: "Fine Angle", Spec: SpecTypeId.Angle, Unit: UnitTypeId.Degrees, Raw: 0.123456789012345),
            (Name: "Fine Voltage", Spec: SpecTypeId.ElectricalPotential, Unit: UnitTypeId.Volts, Raw: UnitUtils.ConvertToInternalUnits(123.456789012345, UnitTypeId.Volts)),
            (Name: "ResultVoltageLookupUnit", Spec: SpecTypeId.ElectricalPotential, Unit: UnitTypeId.Volts, Raw: 10.763910416709722),
            (Name: "ResultAirFlowLookupUnit", Spec: SpecTypeId.AirFlow, Unit: UnitTypeId.CubicFeetPerMinute, Raw: 0.016666666666666666),
            (Name: "Fine Temperature", Spec: SpecTypeId.HvacTemperature, Unit: UnitTypeId.Celsius, Raw: UnitUtils.ConvertToInternalUnits(23.456789012345, UnitTypeId.Celsius)),
            (Name: "Fine Number", Spec: SpecTypeId.Number, Unit: UnitTypeId.General, Raw: 1.23456789012345)
        };
        try {
            using (var seed = new Transaction(source, "Seed disposable coarse display settings")) {
                seed.Start();
                var units = source.GetUnits();
                foreach (var value in values) {
                    var parameter = source.FamilyManager.FindParameter(value.Name) ?? source.FamilyManager.AddParameter(value.Name, GroupTypeId.Data, value.Spec, false);
                    foreach (var type in source.FamilyManager.Types.Cast<FamilyType>()) { source.FamilyManager.CurrentType = type; source.FamilyManager.Set(parameter, value.Raw); }
                    if (value.Spec == SpecTypeId.Number) continue;
                    var format = new FormatOptions(value.Unit) { Accuracy = 1 };
                    format.SetSymbolTypeId(new ForgeTypeId(""));
                    units.SetFormatOptions(value.Spec, format);
                }
                source.SetUnits(units);
                Assert.That(seed.Commit(), Is.EqualTo(TransactionStatus.Committed));
            }
            var captured = source.CaptureFamilyModel();
            var json = JObject.Parse(FamilyModelJson.Serialize(captured));
            foreach (var basis in values.Where(v => v.Name.EndsWith("LookupUnit", StringComparison.Ordinal)))
                foreach (var type in (JObject)json["types"]!) {
                    var text = type.Value![basis.Name]!.Value<string>();
                    Assert.That(UnitFormatUtils.TryParse(target.GetUnits(), basis.Spec, text, out var raw), Is.True, $"{basis.Name}: {text}");
                    Assert.That(raw, Is.EqualTo(basis.Raw).Within(1e-14), $"Captured unit basis {basis.Name}: {text}");
                }
            var patch = new FamilyPatch { Patch = new JObject { ["parameters"] = json["parameters"]!.DeepClone(), ["types"] = json["types"]!.DeepClone() } };
            Assert.That(FamilyModelUnitValidation.Validate(captured, patch.Patch, _ => null), Is.Empty);
            using var processor = new OperationProcessor(target);
            var operation = new ReconcileFamily(patch);
            var (contexts, _) = processor.ProcessQueue(new OperationQueue().Add(operation));
            var (_, error) = contexts.Single().OperationLogs;
            Assert.That(error, Is.Null, error?.Message);
            Assert.That(operation.LastReceipt?.Converged, Is.True);
            foreach (var value in values) {
                var parameter = target.FamilyManager.FindParameter(value.Name);
                foreach (var type in target.FamilyManager.Types.Cast<FamilyType>())
                    Assert.That(type.AsDouble(parameter), Is.EqualTo(value.Raw).Within(Math.Max(1, Math.Abs(value.Raw)) * 1e-12), value.Name);
                if (value.Spec != SpecTypeId.Number) {
                    var format = source.GetUnits().GetFormatOptions(value.Spec);
                    Assert.That(format.Accuracy, Is.EqualTo(1));
                    Assert.That(format.GetSymbolTypeId().TypeId, Is.Empty);
                }
            }
        } finally { source.Close(false); target.Close(false); }
    }

    [Test]
    public void Plumbing_shared_number_definitions_use_native_other_group() {
        var document = this.NewFamily("FF plumbing shared definitions");
        try {
            var names = new[] { "PE_P_LoadCalc_CWFU", "PE_P_LoadCalc_DFU", "PE_P_LoadCalc_HWFU" };
            var definitions = JsonConvert.DeserializeObject<List<ParametersApi.Parameters.ParametersResult>>(File.ReadAllText(
                RevitFamilyFixtureHarness.GetProfileFixturePath("normalization-company-definitions.json")))!.Where(d => names.Contains(d.Name)).ToList();
            Assert.That(definitions.Count, Is.EqualTo(3));
            foreach (var definition in definitions) {
                Assert.That(definition.DownloadOptions.GetGroupTypeId().TypeId, Is.Empty);
                Assert.That(definition.DownloadOptions.GetSpecTypeId(), Is.EqualTo(SpecTypeId.Number));
            }
            var patch = CompanyNormalizationFixture.Convert(new(), names);
            foreach (var name in names) patch.Patch["parameters"]![name]!["value"] = name.EndsWith("DFU") ? 2d : 7.5;
            var operation = new ReconcileFamily(patch, sharedSource: d => new FamilySharedParameterSource(d, definitions));
            using var processor = new OperationProcessor(document);
            var (contexts, _) = processor.ProcessQueue(new OperationQueue().Add(operation));
            var (_, error) = contexts.Single().OperationLogs;
            Assert.That(error, Is.Null, error?.Message);
            Assert.That(operation.LastReceipt?.Converged, Is.True);
            foreach (var definition in definitions) {
                var parameter = document.FamilyManager.FindParameter(definition.Name!);
                Assert.That(parameter.GUID, Is.EqualTo(definition.DownloadOptions.GetGuid()));
                Assert.That(parameter.Definition.GetGroupTypeId().TypeId, Is.Empty);
                foreach (var type in document.FamilyManager.Types.Cast<FamilyType>())
                    Assert.That(type.AsDouble(parameter), Is.EqualTo(definition.Name!.EndsWith("DFU") ? 2d : 7.5));
            }
        } finally { document.Close(false); }
    }

    [Test]
    public void Direct_public_plan_keeps_group_contexts_after_normalization() {
        var document = this.NewFamily("FF public plan");
        try {
            var patch = FamilyPatch.Parse("""{"patch":{"parameters":{"Mapped Width":{"dataType":"Length","wasNamed":["Width"],"value":"3ft"}}}}""");
            var current = document.CaptureFamilyModel();
            var desired = FamilyReconciler.Desired(current, patch);
            Assert.That(desired.Diagnostics, Is.Empty);
            var plan = FamilyReconciler.Reconcile(desired.Value!, current, UnitResolvers.Revit(document), authored: patch.Patch);
            Assert.That(plan.OpOrder.First(), Is.EqualTo("NormalizeParamSources"));
            using var processor = new OperationProcessor(document);
            var (contexts, _) = processor.ProcessQueue(plan.Queue);
            var (logs, error) = contexts.Single().OperationLogs;
            Assert.That(error, Is.Null, error?.Message);
            Assert.That(logs!.Sum(log => log.PendingCount), Is.Zero);
            foreach (var type in document.FamilyManager.Types.Cast<FamilyType>().Where(t => t.Name is "A" or "B"))
                Assert.That(type.AsDouble(document.FamilyManager.FindParameter("Mapped Width")), Is.EqualTo(3d));
        } finally { document.Close(false); }
    }

    [Test]
    public void Reapplying_shared_mapping_has_no_operations_changes_or_effects() {
        var document = this.NewFamily("FF repeated shared mapping");
        try {
            var definitions = CompanyDefinitions();
            var patch = CompanyNormalizationFixture.Convert(CompanyNormalizationFixture.MechanicalMappings(), ["PE_G_Dim_Width1"]);
            patch.Patch["parameters"]!["PE_G_Dim_Width1"]!["value"] = "5ft";
            string? repeatedHash = null;
            for (var pass = 0; pass < 3; pass++) {
                var operation = new ReconcileFamily(patch, sharedSource: d => new FamilySharedParameterSource(d, definitions));
                using var processor = new OperationProcessor(document);
                var (contexts, _) = processor.ProcessQueue(new OperationQueue().Add(operation));
                var (_, error) = contexts.Single().OperationLogs;
                Assert.That(error, Is.Null, error?.Message);
                Assert.That(operation.LastReceipt?.Converged, Is.True);
                if (pass == 0) continue;
                Assert.That(operation.LastPlan!.Changes, Is.Empty);
                Assert.That(operation.LastPlan.Queue.Operations, Is.Empty);
                Assert.That(operation.LastPlan.RunEffects, Is.Empty);
                if (repeatedHash is not null) Assert.That(operation.LastPlan.PlanHash, Is.EqualTo(repeatedHash));
                repeatedHash = operation.LastPlan.PlanHash;
            }
        } finally { document.Close(false); }
    }

    [TestCase(false)]
    [TestCase(true)]
    public void Conflicting_source_references_follow_existing_destination_before_source_removal(bool incompatible) {
        var document = this.NewFamily("FF destination wins");
        try {
            using (var seed = new Transaction(document, "Seed conflicting destination and dependent formula")) {
                seed.Start();
                var manager = document.FamilyManager;
                var target = manager.AddParameter("Winning Width", GroupTypeId.Geometry, incompatible ? SpecTypeId.String.Text : SpecTypeId.Length, false);
                var dependent = manager.AddParameter("Dependent Width", GroupTypeId.Geometry, SpecTypeId.Length, false);
                foreach (var type in manager.Types.Cast<FamilyType>()) {
                    manager.CurrentType = type;
                    if (incompatible) manager.Set(target, "destination"); else manager.Set(target, 9d);
                }
                manager.SetFormula(dependent, "Width * 2");
                Assert.That(seed.Commit(), Is.EqualTo(TransactionStatus.Committed));
            }
            var operation = new ReconcileFamily(FamilyPatch.Parse("""{"patch":{"parameters":{"Winning Width":{"wasNamed":["Width"]}}}}"""));
            using var processor = new OperationProcessor(document);
            var (contexts, _) = processor.ProcessQueue(new OperationQueue().Add(operation));
            var (_, error) = contexts.Single().OperationLogs;
            if (incompatible) {
                Assert.That(error, Is.Not.Null, "A text destination cannot replace a length reference in multiplication.");
                Assert.That(error!.ToString(), Does.Contain("Dependent Width").And.Contain("Width").And.Contain("Winning Width")
                    .And.Contain("Winning Width * 2").And.Contain("Formula setting failed"));
                Assert.That(operation.LastReceipt?.Converged ?? false, Is.False);
                AssertOriginalWidths(document);
                Assert.That(document.FamilyManager.FindParameter("Dependent Width").Formula, Is.EqualTo("Width * 2"));
                Assert.That(document.FamilyManager.Parameters.Cast<FamilyParameter>().Any(p => p.Definition.Name.StartsWith("FF_Transfer_")), Is.False);
                foreach (var type in document.FamilyManager.Types.Cast<FamilyType>())
                    Assert.That(type.AsString(document.FamilyManager.FindParameter("Winning Width")), Is.EqualTo("destination"));
                return;
            }
            Assert.That(error, Is.Null, error?.Message);
            Assert.That(operation.LastReceipt?.Converged, Is.True);
            Assert.That(document.FamilyManager.FindParameter("Width"), Is.Null);
            var targetParameter = document.FamilyManager.FindParameter("Winning Width");
            var dependentParameter = document.FamilyManager.FindParameter("Dependent Width");
            Assert.That(dependentParameter.Formula, Does.Contain("Winning Width"));
            foreach (var type in document.FamilyManager.Types.Cast<FamilyType>()) {
                Assert.That(type.AsDouble(targetParameter), Is.EqualTo(9d));
                Assert.That(type.AsDouble(dependentParameter), Is.EqualTo(18d));
            }
        } finally { document.Close(false); }
    }

    [Test]
    public void Exact_destination_alias_materializes_every_type_and_reapply_is_noop() {
        var document = this.NewFamily("FF exact destination alias");
        try {
            IReadOnlyDictionary<string, double?> beforeValues;
            string unrelatedFormula;
            using (var seed = new Transaction(document, "Seed exact destination alias")) {
                seed.Start();
                var seedManager = document.FamilyManager;
                var source = seedManager.AddParameter("Amperage", GroupTypeId.Electrical, SpecTypeId.Current, false);
                var targetParameter = seedManager.AddParameter("PE_E___MCA", GroupTypeId.Electrical, SpecTypeId.Current, false);
                var related = seedManager.AddParameter("Related Current", GroupTypeId.Electrical, SpecTypeId.Current, false);
                var unrelatedInput = seedManager.AddParameter("Unrelated Current", GroupTypeId.Electrical, SpecTypeId.Current, false);
                var unrelated = seedManager.AddParameter("Unrelated Formula", GroupTypeId.Electrical, SpecTypeId.Current, false);
                foreach (var type in seedManager.Types.Cast<FamilyType>().Where(type => type.Name is "A" or "B")) {
                    seedManager.CurrentType = type;
                    seedManager.Set(source, type.Name == "A" ? 10d : 20d);
                    seedManager.Set(unrelatedInput, type.Name == "A" ? 3d : 4d);
                }
                seedManager.SetFormula(targetParameter, "Amperage");
                seedManager.SetFormula(related, "Amperage * 2");
                seedManager.SetFormula(unrelated, "Unrelated Current * 3");
                beforeValues = seedManager.Types.Cast<FamilyType>().Where(type => type.Name is "A" or "B")
                    .ToDictionary(type => type.Name, type => type.AsDouble(targetParameter), StringComparer.Ordinal);
                unrelatedFormula = unrelated.Formula;
                Assert.That(seed.Commit(), Is.EqualTo(TransactionStatus.Committed));
            }
            var patch = FamilyPatch.Parse("""{"patch":{"parameters":{"PE_E___MCA":{"wasNamed":["Amperage"]}}}}""");
            using var processor = new OperationProcessor(document);
            var operation = new ReconcileFamily(patch);
            var (contexts, _) = processor.ProcessQueue(new OperationQueue().Add(operation));
            var (_, error) = contexts.Single().OperationLogs;
            Assert.That(error, Is.Null, error?.Message);
            Assert.That(operation.LastReceipt?.Converged, Is.True);
            var manager = document.FamilyManager;
            var target = manager.FindParameter("PE_E___MCA");
            Assert.That(target.Formula, Is.Null);
            Assert.That(manager.FindParameter("Amperage"), Is.Null);
            foreach (var (typeName, value) in beforeValues)
                Assert.That(manager.Types.Cast<FamilyType>().Single(type => type.Name == typeName).AsDouble(target), Is.EqualTo(value));
            Assert.That(manager.FindParameter("Related Current").Formula, Is.EqualTo("PE_E___MCA * 2"));
            Assert.That(manager.FindParameter("Unrelated Formula").Formula, Is.EqualTo(unrelatedFormula));

            var repeated = new ReconcileFamily(patch);
            var (repeatedContexts, _) = processor.ProcessQueue(new OperationQueue().Add(repeated));
            var (_, repeatedError) = repeatedContexts.Single().OperationLogs;
            Assert.That(repeatedError, Is.Null, repeatedError?.Message);
            Assert.That(repeated.LastReceipt?.Converged, Is.True);
            Assert.That(repeated.LastPlan!.Changes, Is.Empty);
        } finally { document.Close(false); }
    }

    [Test]
    public void Nontrivial_destination_dependency_refuses_without_dropping_formula() {
        var document = this.NewFamily("FF nontrivial destination dependency");
        try {
            using (var seed = new Transaction(document, "Seed nontrivial destination dependency")) {
                seed.Start();
                var manager = document.FamilyManager;
                var source = manager.AddParameter("Amperage", GroupTypeId.Electrical, SpecTypeId.Current, false);
                var target = manager.AddParameter("PE_E___MCA", GroupTypeId.Electrical, SpecTypeId.Current, false);
                foreach (var type in manager.Types.Cast<FamilyType>().Where(type => type.Name is "A" or "B")) {
                    manager.CurrentType = type;
                    manager.Set(source, type.Name == "A" ? 10d : 20d);
                }
                manager.SetFormula(target, "Amperage * 1.25");
                Assert.That(seed.Commit(), Is.EqualTo(TransactionStatus.Committed));
            }
            var before = document.CaptureFamilyModel();
            var valuesBefore = document.FamilyManager.Types.Cast<FamilyType>().Where(type => type.Name is "A" or "B")
                .ToDictionary(type => type.Name, type => type.AsDouble(document.FamilyManager.FindParameter("Amperage")));
            var operation = new ReconcileFamily(FamilyPatch.Parse("""{"patch":{"parameters":{"PE_E___MCA":{"wasNamed":["Amperage"]}}}}"""));
            using var processor = new OperationProcessor(document);
            var (contexts, _) = processor.ProcessQueue(new OperationQueue().Add(operation));
            var (_, error) = contexts.Single().OperationLogs;
            Assert.That(error?.ToString(), Does.Contain("PE_E___MCA").And.Contain("Amperage * 1.25")
                .And.Contain("not an exact alias").And.Contain("Refusing to discard formula intent"));
            var after = document.CaptureFamilyModel();
            Assert.That(document.FamilyManager.FindParameter("PE_E___MCA")!.Formula, Is.EqualTo("Amperage * 1.25"));
            Assert.That(document.FamilyManager.Types.Cast<FamilyType>().Where(type => type.Name is "A" or "B")
                .ToDictionary(type => type.Name, type => type.AsDouble(document.FamilyManager.FindParameter("Amperage"))), Is.EqualTo(valuesBefore));
            Assert.That(FamilyReconciler.Diff(before, after, UnitResolvers.Revit(document)), Is.Empty);
            Assert.That(FamilyReconciler.Diff(after, before, UnitResolvers.Revit(document)), Is.Empty);
        } finally { document.Close(false); }
    }

    [Test]
    public void Multiple_targets_receive_a_shared_source_before_cleanup() {
        var document = this.NewFamily("FF batched fallback");
        try {
            var originalType = document.FamilyManager.CurrentType.Name;
            var operation = new ReconcileFamily(FamilyPatch.Parse("""{"patch":{"parameters":{"Mapped A":{"dataType":"Length","wasNamed":["Width"]},"Mapped B":{"dataType":"Length","wasNamed":["Width"]}}}}"""));
            using var processor = new OperationProcessor(document);
            var (contexts, _) = processor.ProcessQueue(new OperationQueue().Add(operation));
            var (_, error) = contexts.Single().OperationLogs;
            Assert.That(error, Is.Null, error?.Message);
            Assert.That(operation.LastReceipt?.Converged, Is.True);
            foreach (var type in document.FamilyManager.Types.Cast<FamilyType>().Where(t => t.Name is "A" or "B"))
                foreach (var name in new[] { "Mapped A", "Mapped B" })
                    Assert.That(type.AsDouble(document.FamilyManager.FindParameter(name)), Is.EqualTo(type.Name == "A" ? 1d : 2d));
            Assert.That(document.FamilyManager.CurrentType.Name, Is.EqualTo(originalType));
            Assert.That(document.FamilyManager.FindParameter("Keep"), Is.Not.Null);
        } finally { document.Close(false); }
    }

    [Test]
    public void Company_numeric_literals_use_known_legacy_units_and_number_stays_unitless() {
        var assignments = new Pe.Revit.FamilyFoundry.OperationSettings.SetKnownParamsSettings {
            GlobalAssignments = [new() { Parameter = "Voltage", Kind = Pe.Revit.FamilyFoundry.OperationSettings.ParamAssignmentKind.Value, Value = "480" },
                new() { Parameter = "Ratio", Kind = Pe.Revit.FamilyFoundry.OperationSettings.ParamAssignmentKind.Value, Value = "1.5" }]
        };
        var specs = new Dictionary<string, ForgeTypeId> { ["Voltage"] = SpecTypeId.ElectricalPotential, ["Ratio"] = SpecTypeId.Number };
        Assert.Throws<InvalidOperationException>(() => CompanyNormalizationFixture.Convert(new(), [], assignments, specs: specs));
        var units = new Units(UnitSystem.Metric);
        units.SetFormatOptions(SpecTypeId.ElectricalPotential, new FormatOptions(UnitTypeId.Volts));
        var patch = CompanyNormalizationFixture.Convert(new(), [], assignments, specs: specs, legacyUnits: units);
        Assert.That(patch.Patch["parameters"]!["Voltage"]!["value"]!.ToString(), Does.Contain("V"));
        Assert.That(patch.Patch["parameters"]!["Ratio"]!["value"]!.ToString(), Is.EqualTo("1.5"));
    }

    [Test]
    public void Explicit_units_are_independent_of_display_units_and_implicit_literals_fail_before_writes() {
        foreach (var displayUnit in new[] { UnitTypeId.Feet, UnitTypeId.Millimeters }) {
            var document = this.NewFamily("FF explicit units");
            try {
                using (var seed = new Transaction(document, "Seed disposable display units")) {
                    seed.Start();
                    var units = document.GetUnits();
                    units.SetFormatOptions(SpecTypeId.Length, new FormatOptions(displayUnit));
                    document.SetUnits(units);
                    Assert.That(seed.Commit(), Is.EqualTo(TransactionStatus.Committed));
                }
                var invalid = new ReconcileFamily(FamilyPatch.Parse("""{"patch":{"parameters":{"Width":{"value":3},"NeverAdded":{"dataType":"Number","value":2}}}}"""));
                using (var processor = new OperationProcessor(document)) {
                    var (contexts, _) = processor.ProcessQueue(new OperationQueue().Add(invalid));
                    var (_, error) = contexts.Single().OperationLogs;
                    Assert.That(error, Is.Not.Null);
                    Assert.That(document.FamilyManager.FindParameter("NeverAdded"), Is.Null);
                }
                var valid = new ReconcileFamily(FamilyPatch.Parse("""{"patch":{"parameters":{"Width":{"value":"3ft"},"Count":{"dataType":"Integer","value":2},"Ratio":{"dataType":"Number","value":1.5}}}}"""));
                using (var processor = new OperationProcessor(document)) {
                    var (contexts, _) = processor.ProcessQueue(new OperationQueue().Add(valid));
                    var (_, error) = contexts.Single().OperationLogs;
                    Assert.That(error, Is.Null, error?.Message);
                    Assert.That(valid.LastReceipt?.Converged, Is.True);
                }
                var width = document.FamilyManager.FindParameter("Width");
                foreach (var type in document.FamilyManager.Types.Cast<FamilyType>())
                    Assert.That(type.AsDouble(width), Is.EqualTo(3).Within(1e-9));
                Assert.That(document.GetUnits().GetFormatOptions(SpecTypeId.Length).GetUnitTypeId(), Is.EqualTo(displayUnit));
            } finally { document.Close(false); }
        }
    }

    [Test]
    public void Captured_shared_definitions_rebuild_offline_without_APS_cache() {
        var original = this.NewFamily("FF offline source");
        var target = this.NewFamily("FF offline rebuild");
        try {
            var definitions = JsonConvert.DeserializeObject<List<ParametersApi.Parameters.ParametersResult>>(File.ReadAllText(
                RevitFamilyFixtureHarness.GetProfileFixturePath("normalization-company-definitions.json")))!;
            var mappingNames = CompanyNormalizationFixture.MechanicalMappings().MappingData.Select(m => m.NewName).ToHashSet();
            definitions = definitions.Where(d => mappingNames.Contains(d.Name!)).ToList();
            Assert.That(definitions.Count, Is.EqualTo(38), "Every target in the real mechanical mapping fragment has an exact frozen definition.");
            var patch = CompanyNormalizationFixture.Convert(CompanyNormalizationFixture.MechanicalMappings(),
                definitions.Select(d => d.Name!));
            using (var processor = new OperationProcessor(original)) {
                var operation = new ReconcileFamily(patch, sharedSource: d => new FamilySharedParameterSource(d, definitions));
                var (contexts, _) = processor.ProcessQueue(new OperationQueue().Add(operation));
                var (_, error) = contexts.Single().OperationLogs;
                Assert.That(error, Is.Null, error?.Message);
                Assert.That(operation.LastReceipt?.Converged, Is.True);
            }
            var captured = original.CaptureFamilyModel();
            var json = JObject.Parse(FamilyModelJson.Serialize(captured));
            var offline = new FamilyPatch { Patch = new JObject { ["parameters"] = json["parameters"]!.DeepClone(), ["types"] = json["types"]!.DeepClone() } };
            using (var processor = new OperationProcessor(target)) {
                // Empty injected source deliberately makes every APS lookup fail.
                var operation = new ReconcileFamily(offline, sharedSource: d => new FamilySharedParameterSource(d, []));
                var (contexts, _) = processor.ProcessQueue(new OperationQueue().Add(operation));
                var (_, error) = contexts.Single().OperationLogs;
                Assert.That(error, Is.Null, error?.Message);
                Assert.That(operation.LastReceipt?.Converged, Is.True);
            }
            var rebuilt = target.CaptureFamilyModel();
            foreach (var definition in definitions) {
                var before = captured.Parameters[definition.Name!];
                var after = rebuilt.Parameters[definition.Name!];
                Assert.That(after.SharedGuid, Is.EqualTo(before.SharedGuid));
                Assert.That(after.SharedSpecId, Is.EqualTo(before.SharedSpecId));
                Assert.That(after.SharedVisible, Is.EqualTo(before.SharedVisible));
                Assert.That(after.SharedUserModifiable, Is.EqualTo(before.SharedUserModifiable));
            }
        } finally { original.Close(false); target.Close(false); }
    }

    [TestCase(false, false)]
    [TestCase(true, false)]
    [TestCase(false, true)]
    [TestCase(true, true)]
    public void Ranked_company_sources_fill_only_opted_in_blanks_and_explicit_values_always_win(bool fill, bool explicitValue) {
        var document = this.NewFamily("FF company model");
        try {
            using (var transaction = new Transaction(document, "Seed company source candidates")) {
                transaction.Start();
                var fm = document.FamilyManager;
                var sparse = fm.get_Parameter(BuiltInParameter.ALL_MODEL_MODEL)
                    ?? throw new InvalidOperationException("Generic Model template has no built-in Model source.");
                var dense = fm.AddParameter("Mech Equip Model Number", GroupTypeId.Data, SpecTypeId.String.Text, false);
                var target = fm.AddParameter("PE_G___Model", GroupTypeId.Data, SpecTypeId.String.Text, false);
                foreach (var type in fm.Types.Cast<FamilyType>().Where(t => t.Name is "A" or "B")) {
                    fm.CurrentType = type;
                    fm.Set(sparse, type.Name == "A" ? "sparse" : "");
                    fm.Set(dense, "dense-" + type.Name);
                    fm.Set(target, type.Name == "A" ? "destination" : "");
                }
                Assert.That(transaction.Commit(), Is.EqualTo(TransactionStatus.Committed));
            }
            var parameter = JObject.Parse("""{"shared":true,"wasNamed":["Model","Mech Equip Model Number"]}""");
            parameter["fillBlanksFromSources"] = fill;
            if (explicitValue) parameter["value"] = "explicit";
            var operation = new ReconcileFamily(new FamilyPatch { Patch = new JObject { ["parameters"] = new JObject { ["PE_G___Model"] = parameter } } },
                sharedSource: d => new FamilySharedParameterSource(d, CompanyDefinitions()));
            using var processor = new OperationProcessor(document);
            var (contexts, _) = processor.ProcessQueue(new OperationQueue().Add(operation));
            var (_, error) = contexts.Single().OperationLogs;
            Assert.That(error, Is.Null, error?.Message);
            Assert.That(operation.LastReceipt?.Converged, Is.True);
            var targetParameter = document.FamilyManager.FindParameter("PE_G___Model");
            foreach (var type in document.FamilyManager.Types.Cast<FamilyType>().Where(t => t.Name is "A" or "B"))
                Assert.That(type.AsString(targetParameter), Is.EqualTo(explicitValue ? "explicit" : type.Name == "A" ? "destination" : fill ? "dense-B" : ""));
            Assert.That(document.FamilyManager.FindParameter("Model"), Is.Not.Null, "Revit owns the built-in source; it cannot be removed.");
            Assert.That(document.FamilyManager.FindParameter("Mech Equip Model Number"), Is.Null, "Conflicting user-defined source is removed after transfer; destination wins.");
        } finally { document.Close(false); }
    }

    [Test]
    public void Explicit_value_updates_every_type_preserves_unmentioned_parameter_and_does_not_save() {
        var document = this.NewFamily("FF normalization values");
        try {
            var path = document.PathName;
            var operation = WidthPatch();
            using var processor = new OperationProcessor(document);
            var (contexts, _) = processor.ProcessQueue(new OperationQueue().Add(operation));
            var (_, error) = contexts.Single().OperationLogs;
            Assert.That(error, Is.Null, error?.Message);
            Assert.That(operation.LastReceipt?.Converged, Is.True);
            Assert.That(document.PathName, Is.EqualTo(path));
            foreach (var type in document.FamilyManager.Types.Cast<FamilyType>().Where(t => t.Name is "A" or "B")) {
                Assert.That(type.AsDouble(document.FamilyManager.FindParameter("Width")), Is.EqualTo(3.0));
                Assert.That(type.AsString(document.FamilyManager.FindParameter("Keep")), Is.EqualTo(type.Name));
            }
        } finally { document.Close(false); }
    }

    [TestCase(false)]
    [TestCase(true)]
    public void Failed_dependent_work_rolls_back_the_entire_family_and_receipt(bool singleTransaction) {
        var document = this.NewFamily("FF normalization rollback");
        try {
            var operation = WidthPatch();
            var options = new ExecutionOptions();
            if (!singleTransaction) {
                var profile = JArray.Parse(File.ReadAllText(RevitFamilyFixtureHarness.GetProfileFixturePath("company-composed-20260906.json")))
                    .Single(p => (string)p["source"]! == "CmdFFManager/profiles/SavedEquip/Constrained Box.json");
                options = Pe.Revit.FamilyFoundry.Apply.FamilyProfileConverter.Convert(
                    new JObject { ["ExecutionOptions"] = profile["settings"]!["ExecutionOptions"]!.DeepClone() }, [], document.GetUnits()).Options;
                Assert.That(options.SingleTransaction, Is.False);
                Assert.That(options.OptimizeTypeOperations, Is.False);
            }
            using var processor = new OperationProcessor(document, options);
            var (contexts, _) = processor.ProcessQueue(new OperationQueue().Add(operation).Add(new FailFamily()));
            var (_, error) = contexts.Single().OperationLogs;
            Assert.That(error, Is.Not.Null);
            Assert.That(operation.LastReceipt?.Converged ?? false, Is.False);
            Assert.That(operation.LastReceipt?.Residue, Is.Empty, "Rollback must not replace measured post-apply residue with the requested plan.");
            AssertOriginalWidths(document);
        } finally { document.Close(false); }
    }

    [Test]
    public void Caller_owned_transaction_does_not_publish_committed_receipt() {
        var document = this.NewFamily("FF normalization caller transaction");
        try {
            using var transaction = new Transaction(document, "Caller owns commit");
            transaction.Start();
            var operation = WidthPatch();
            using var processor = new OperationProcessor(document);
            var (contexts, _) = processor.ProcessQueue(new OperationQueue().Add(operation));
            var (_, error) = contexts.Single().OperationLogs;
            Assert.That(error, Is.Null, error?.Message);
            Assert.That(operation.LastReceipt?.Converged, Is.False);
            Assert.That(operation.LastReceipt?.Residue, Is.Empty, "Staged edits have no measured residue, but the caller still owns commit.");
            transaction.RollBack();
            AssertOriginalWidths(document);
        } finally { document.Close(false); }
    }

    [Test]
    public void Stale_plan_is_rejected_before_parameter_mutation() {
        var document = this.NewFamily("FF normalization drift");
        try {
            var operation = WidthPatch("stale");
            using var processor = new OperationProcessor(document);
            var (contexts, _) = processor.ProcessQueue(new OperationQueue().Add(operation));
            var (_, error) = contexts.Single().OperationLogs;
            Assert.That(error?.Message, Does.Contain("Plan hash drifted"));
            Assert.That(operation.LastReceipt, Is.Null);
            AssertOriginalWidths(document);
        } finally { document.Close(false); }
    }

    [Test]
    public void Failed_family_does_not_load_and_next_family_can_succeed() {
        var project = RevitFamilyFixtureHarness.CreateProjectDocument(this._application);
        try {
            var families = new List<Family>();
            foreach (var name in new[] { "FF fail", "FF pass" }) {
                var document = this.NewFamily(name);
                try { families.Add(document.LoadFamily(project, new DefaultFamilyLoadOptions())); }
                finally { document.Close(false); }
            }
            var operation = WidthPatch();
            var receipts = new List<bool>();
            var familyIds = families.Select(f => f.Id).ToArray();
            var familyNames = families.Select(f => f.Name).ToArray();
            var failure = new FailFamily(familyNames[0]);
            Assert.That(familyIds.Distinct().Count(), Is.EqualTo(2));
            using var processor = new OperationProcessor(project, new ExecutionOptions { SingleTransaction = false });
            var (contexts, _) = processor.SelectFamilies(() => families)
                .WithPerFamilyCallback(_ => receipts.Add(operation.LastReceipt?.Converged ?? false))
                .ProcessQueue(new OperationQueue().Add(operation).Add(failure));
            Assert.That(contexts.Count, Is.EqualTo(2));
            var (_, firstError) = contexts[0].OperationLogs;
            Assert.That(failure.Triggered, Is.True, $"Earlier failure: {firstError}; loaded names: {string.Join(", ", familyNames)}; contexts: {string.Join(", ", contexts.Select(c => c.FamilyName))}");
            Assert.That(firstError?.Message, Does.Contain("injected failure"));
            Assert.That(receipts, Is.EqualTo(new[] { false, true }));
            for (var index = 0; index < familyNames.Length; index++) {
                var family = new FilteredElementCollector(project).OfClass(typeof(Family)).Cast<Family>()
                    .Single(f => f.Name == familyNames[index]);
                if (index == 0) Assert.That(family.Id, Is.EqualTo(familyIds[0]), "Failed family must retain its original project identity.");
                var document = project.EditFamily(family);
                try {
                    if (index == 0) AssertOriginalWidths(document);
                    else foreach (var type in document.FamilyManager.Types.Cast<FamilyType>().Where(t => t.Name is "A" or "B"))
                        Assert.That(type.AsDouble(document.FamilyManager.FindParameter("Width")), Is.EqualTo(3.0));
                } finally { document.Close(false); }
            }
        } finally { project.Close(false); }
    }

    private static void AssertOriginalWidths(Document document) {
        foreach (var type in document.FamilyManager.Types.Cast<FamilyType>().Where(t => t.Name is "A" or "B"))
            Assert.That(type.AsDouble(document.FamilyManager.FindParameter("Width")), Is.EqualTo(type.Name == "A" ? 1.0 : 2.0));
    }

    private sealed class FailFamily(string? family = null) : DocOperation<DefaultOperationSettings>(new()) {
        public override string Description => "Injected dependent failure";
        public bool Triggered { get; private set; }
        public override OperationLog Execute(FamilyDocument document, FamilyProcessingContext context, OperationContext group) {
            var reject = family is null || family == context.FamilyName;
            this.Triggered |= reject;
            return new(this.Name, [reject ? new LogEntry("dependent").Error("injected failure") : new LogEntry("dependent").Success("accepted")]);
        }
    }
}
