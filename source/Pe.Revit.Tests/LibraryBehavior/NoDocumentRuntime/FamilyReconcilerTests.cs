using Pe.Revit.FamilyFoundry.Reconcile;
using Pe.Revit.FamilyFoundry.OperationGroups;
using Pe.Revit.FamilyFoundry.Operations;
using Pe.Revit.SettingsRuntime.Json;
using Pe.Shared.RevitData.Families;
using Pe.Shared.StorageRuntime.Capabilities;

namespace Pe.Revit.Tests.LibraryBehavior.NoDocumentRuntime;

/// <summary>Deterministic proof of the pure half of the reconciler: no Document, no Revit.</summary>
[TestFixture]
public sealed class FamilyReconcilerTests {
    [Test]
    public void Patch_selector_accepts_absent_conditions_and_rejects_unknown_operators() {
        Assert.That(FamilyPatch.Parse("""{"select":{"includeByCondition":null},"patch":{}}""").Select.IncludeByCondition, Is.Null);
        var placeholder = FamilyPatch.Parse("""{"select":{"includeByCondition":{"FieldName":"","FilterType":2,"Value":""}},"patch":{}}""")
            .Select.IncludeByCondition;
        Assert.Multiple(() => {
            Assert.That(placeholder, Is.Not.Null);
            Assert.That(placeholder!.FieldName, Is.Empty);
            Assert.That(placeholder.Value, Is.Empty);
        });
        Assert.Throws<Newtonsoft.Json.JsonSerializationException>(() =>
            FamilyPatch.Parse("""{"select":{"includeByCondition":{"FieldName":"Keep","FilterType":999,"Value":"A"}},"patch":{}}"""));
    }

    [Test]
    public void Structured_run_policies_retain_native_clean_and_sort_settings() {
        var model = new FamilyModel { Family = new FamilyModelHeader { Name = "Policies", Category = FamilyCategory.GenericModels,
            Template = "Generic Model", Placement = FamilyModelPlacement.OneLevelBased } };
        var patch = FamilyPatch.Parse("""{"patch":{},"run":{"clean":{"Enabled":true,"EnablePurgeParams":false,"EnablePurgeNestedFamilies":false,"EnablePurgeModelLines":false,"EnablePurgeReferencePlanes":false},"sort":{"ParamNameSortOrder":"Descending","ParamTypeSortOrder":"FamilyParamsFirst","ParamValueSortOrder":"ValuesFirst"}}}""");
        var plan = FamilyReconciler.Reconcile(model, model, UnitResolvers.Portable, patch.Run);
        var sort = plan.Queue.Operations.OfType<Pe.Revit.FamilyFoundry.Operations.SortParams>().Single().Settings;
        Assert.That(sort.ParamNameSortOrder, Is.EqualTo(ParamNameSortOrder.Descending));
        Assert.That(sort.ParamTypeSortOrder, Is.EqualTo(ParamTypeSortOrder.FamilyParamsFirst));
        Assert.That(sort.ParamValueSortOrder, Is.EqualTo(ParamValueSortOrder.ValuesFirst));
        Assert.That(plan.Queue.Operations.Where(o => o.Name.StartsWith("Purge")).All(o => !o.Settings.Enabled), Is.True);
        var defaults = FamilyReconciler.Reconcile(model, model, UnitResolvers.Portable,
            FamilyPatch.Parse("""{"patch":{},"run":{"clean":true,"sort":true}}""").Run);
        Assert.That(plan.PlanHash, Is.Not.EqualTo(defaults.PlanHash));
        Assert.Throws<Newtonsoft.Json.JsonSerializationException>(() =>
            FamilyPatch.Parse("""{"patch":{},"run":{"sort":{"MisspelledPolicy":true}}}"""));
    }

    [Test]
    public void Execution_behavior_is_bound_into_the_plan_hash() {
        var model = new FamilyModel { Family = new FamilyModelHeader { Name = "Options", Category = FamilyCategory.GenericModels,
            Template = "Generic Model", Placement = FamilyModelPlacement.OneLevelBased } };
        var baseline = FamilyReconciler.Reconcile(model, model, UnitResolvers.Portable).PlanHash;
        var variants = new[] {
            new ExecutionOptions { OptimizeTypeOperations = false },
            new ExecutionOptions { SuppressWarnings = true }
        };
        Assert.That(variants.Select(options => FamilyReconciler.Reconcile(model, model, UnitResolvers.Portable, executionOptions: options).PlanHash),
            Is.All.Not.EqualTo(baseline));
        Assert.That(FamilyReconciler.Reconcile(model, model, UnitResolvers.Portable,
            executionOptions: new ExecutionOptions { EnableCollectors = false }).PlanHash, Is.EqualTo(baseline));
        Assert.That(FamilyReconciler.Reconcile(model, model, UnitResolvers.Portable,
            executionOptions: new ExecutionOptions { SingleTransaction = false }).PlanHash, Is.EqualTo(baseline));
    }

    [Test]
    public void Plan_hash_ignores_dictionary_order_and_detects_semantic_drift() {
        var desiredAb = Parse($$"""{ {{Header}}, "parameters": { "W": { "dataType": "Length" } }, "types": { "A": { "W": "2ft" }, "B": { "W": "2ft" } } }""");
        var currentAb = Parse($$"""{ {{Header}}, "parameters": { "W": { "dataType": "Length" } }, "types": { "A": { "W": "1ft" }, "B": { "W": "1ft" } } }""");
        var desiredBa = Parse($$"""{ {{Header}}, "parameters": { "W": { "dataType": "Length" } }, "types": { "B": { "W": "2ft" }, "A": { "W": "2ft" } } }""");
        var currentBa = Parse($$"""{ {{Header}}, "parameters": { "W": { "dataType": "Length" } }, "types": { "B": { "W": "1ft" }, "A": { "W": "1ft" } } }""");
        var changedBa = Parse($$"""{ {{Header}}, "parameters": { "W": { "dataType": "Length" } }, "types": { "B": { "W": "18in" }, "A": { "W": "1ft" } } }""");

        var ab = FamilyReconciler.Reconcile(desiredAb, currentAb, UnitResolvers.Portable);
        var ba = FamilyReconciler.Reconcile(desiredBa, currentBa, UnitResolvers.Portable);
        var drifted = FamilyReconciler.Reconcile(desiredBa, changedBa, UnitResolvers.Portable);
        Assert.Multiple(() => {
            Assert.That(ab.Changes.Select(change => (change.Section, change.Key)),
                Is.EquivalentTo(ba.Changes.Select(change => (change.Section, change.Key))));
            Assert.That(ba.PlanHash, Is.EqualTo(ab.PlanHash));
            Assert.That(drifted.PlanHash, Is.Not.EqualTo(ab.PlanHash));
        });
    }

    private static readonly string[] Fixtures = ["a-box", "b-grd", "c-bath-shower", "d-bath-shower-refline"];

    [TestCase("association")]
    [TestCase("host")]
    public void Grd_nested_seed_changes_rebuild_both_unchanged_dependent_arrays(string change) {
        var current = Load("b-grd");
        var desired = FamilyModelJson.Parse(FamilyModelJson.Serialize(current)).Value!;
        var vane = desired.Nested["vane"];
        desired.Nested["vane"] = change == "host"
            ? new FamilyModelNested { Family = vane.Family, Type = vane.Type, Host = "opening (Front)", Align = vane.Align, Associate = vane.Associate }
            : new FamilyModelNested { Family = vane.Family, Type = vane.Type, Host = vane.Host, Align = vane.Align,
                Associate = new Dictionary<string, string>(vane.Associate!) { ["_vane length"] = "param:Duct Width" } };

        var plan = FamilyReconciler.Reconcile(desired, current, UnitResolvers.Portable);
        Assert.Multiple(() => {
            Assert.That(plan.Changes.Single(c => c.Section == "nested" && c.Key == "vane").Kind, Is.EqualTo(ChangeKind.Recreate));
            Assert.That(plan.Changes.Where(c => c.Section == "arrays"), Has.Count.EqualTo(2));
            Assert.That(plan.Changes.Where(c => c.Section == "arrays").Select(c => c.Kind), Is.All.EqualTo(ChangeKind.Recreate));
            Assert.That(plan.Queue.Operations.OfType<PlaceNested>(), Is.Empty, "Array seeds remain owned by MakeArrays.");
            Assert.That(plan.Queue.Operations.OfType<MakeArrays>().Single().Description, Does.Contain("vanes-back").And.Contain("vanes-front"));
        });
    }

    /// <summary>The DAG of r2-reconcile §4, as op type names; a plan's OpOrder must be a subsequence of this.</summary>
    private static readonly string[] Dag = [
        "DeleteByName", "RenameParams", "DeleteParams", "CreateFamilyTypes", "AddParams", "SetParamMetadata", "ClearFormulas", "SetLookupTables",
        "SetParamValues", "SetParamValuesPerType", "SetBlankValues", "MakeRefPlanes", "MakeRefLines", "MakeDims",
        "SetParamValues", "SetParamValuesPerType",
        "MakeForms", "PlaceNested", "MakeArrays", "MakeConnectors", "EnsureElectricalConnectorParameters", "PlaceDetails", "SetVisibility", "SetFamilySettings", "AddRoomDingler",
        "PurgeNestedFamilies", "PurgeReferencePlanes", "PurgeModelLines", "PurgeParams", "SortParams", "DeleteFamilyTypes"
    ];

    [Test]
    public void Electrical_connector_run_rule_is_hashed_lowered_and_reported_after_connector_creation() {
        var desired = Load("a-box");
        var current = new FamilyModel { Family = desired.Family, Datums = desired.Datums };
        var run = new PatchRun { ElectricalConnectorParameters = new ElectricalConnectorParameterRule {
            Voltage = "V", NumberOfPoles = "P", ApparentPower = "VA", MinimumCircuitAmpacity = "MCA"
        } };
        var plan = FamilyReconciler.Reconcile(desired, current, UnitResolvers.Portable, run);
        var order = plan.OpOrder.ToList();
        Assert.Multiple(() => {
            Assert.That(order.IndexOf("EnsureElectricalConnectorParameters"), Is.GreaterThan(order.IndexOf("MakeConnectors")));
            Assert.That(plan.RunEffects, Is.EqualTo(new[] { "run.electricalConnectorParameters: voltage=V; numberOfPoles=P; apparentPower=VA; minimumCircuitAmpacity=MCA (declaration only)" }));
            Assert.That(plan.PlanHash, Is.Not.EqualTo(FamilyReconciler.Reconcile(desired, current, UnitResolvers.Portable).PlanHash));
        });
    }

    private static string FixturePath(string name) {
        var dir = Path.GetDirectoryName(typeof(FamilyReconcilerTests).Assembly.Location)!;
        for (var probe = new DirectoryInfo(dir); probe is not null; probe = probe.Parent) {
            var candidate = Path.Combine(probe.FullName, "Fixtures", "FamilyModel", $"{name}.json");
            if (File.Exists(candidate)) return candidate;
        }
        throw new FileNotFoundException(name);
    }

    private static FamilyModel Load(string name) {
        var parsed = FamilyModelJson.Parse(File.ReadAllText(FixturePath(name)));
        Assert.That(parsed.Diagnostics, Is.Empty, string.Join("\n", parsed.Diagnostics.Select(d => $"{d.Path} {d.Code}: {d.Message}")));
        return parsed.Value!;
    }

    private static FamilyModel Parse(string json) {
        var parsed = FamilyModelJson.Parse(json);
        Assert.That(parsed.Diagnostics, Is.Empty, string.Join("\n", parsed.Diagnostics.Select(d => $"{d.Path} {d.Code}: {d.Message}")));
        return parsed.Value!;
    }

    private const string Header = """ "family": { "name": "T", "category": "GenericModels", "template": "Generic Model", "placement": "OneLevelBased" } """;

    [Test]
    public void Parameter_patch_preserves_unmentioned_native_formula_fields_and_unknown_spec_diagnostics() {
        var current = new FamilyModel {
            Family = new FamilyModelHeader { Name = "Legacy", Category = FamilyCategory.MechanicalEquipment,
                Template = "Mechanical Equipment", Placement = FamilyModelPlacement.OneLevelBased },
            Parameters = new Dictionary<string, FamilyModelParameter>(StringComparer.Ordinal) {
                ["Mech Equip Model Number"] = new() { DataType = DataType.Text, Formula = "Model" },
                ["Capacity"] = new() { DataType = DataType.Wattage, Formula = "18000 BTU/h" },
                ["Density"] = new()
            }
        };
        var unrelated = FamilyPatch.Parse("""{"patch":{"parameters":{"PE_G___Model":{"dataType":"Text"},"Capacity":{"wasNamed":["Legacy Capacity"]}}}}""");
        var preserved = FamilyReconciler.Desired(current, unrelated);

        Assert.Multiple(() => {
            Assert.That(preserved.Diagnostics, Is.Empty);
            Assert.That(preserved.Value!.Parameters["Mech Equip Model Number"].Formula, Is.EqualTo("Model"));
            Assert.That(preserved.Value.Parameters["Capacity"].Formula, Is.EqualTo("18000 BTU/h"));
            Assert.That(preserved.Value.Parameters["Density"].DataType, Is.Null);
            Assert.That(FamilyReconciler.Diff(preserved.Value, current, UnitResolvers.Portable)
                .Where(change => change.Key is "Mech Equip Model Number" or "Capacity" or "Density"), Is.Empty);
            Assert.That(FamilyReconciler.Desired(current, FamilyPatch.Parse(
                """{"patch":{"parameters":{"Mech Equip Model Number":{"formula":"Missing authored name"}}}}""")).Diagnostics
                .Select(d => d.Code), Does.Contain(FamilyModelDiagnosticCodes.FormulaUnknownName));
            Assert.That(FamilyReconciler.Desired(current, FamilyPatch.Parse(
                """{"patch":{"parameters":{"Capacity":{"formula":"Missing authored name"}}}}""")).Diagnostics
                .Select(d => d.Code), Does.Contain(FamilyModelDiagnosticCodes.FormulaUnknownName));
            Assert.That(FamilyReconciler.Desired(current, FamilyPatch.Parse(
                """{"patch":{"parameters":{"Density":{"value":1}}}}""")).Diagnostics
                .Select(d => d.Code), Does.Contain(FamilyModelDiagnosticCodes.Required));
        });
    }

    [Test]
    public void Empty_group_and_omitted_group_diff_empty_without_native_resolution() {
        var desired = Parse($$"""{ {{Header}}, "parameters": { "W": { "dataType": "Length", "propertiesGroup": "" } } }""");
        var current = Parse($$"""{ {{Header}}, "parameters": { "W": { "dataType": "Length" } } }""");
        Assert.That(FamilyReconciler.Diff(desired, current, UnitResolvers.Portable), Is.Empty);
    }

    [Test]
    public void Pure_diff_does_not_resolve_group_labels() {
        var desired = Parse($$"""{ {{Header}}, "parameters": { "W": { "dataType": "Length", "propertiesGroup": "Dimensions" } } }""");
        var current = Parse($$"""{ {{Header}}, "parameters": { "W": { "dataType": "Length", "propertiesGroup": "autodesk.parameter.group:geometry-1.0.0" } } }""");
        Assert.That(FamilyReconciler.Diff(desired, current, UnitResolvers.Portable).Single().Section, Is.EqualTo("parameters"));
    }

    [TestCaseSource(nameof(Fixtures))]
    public void Same_document_diffs_empty(string fixture) {
        var model = Load(fixture);
        Assert.That(FamilyReconciler.Diff(model, model, UnitResolvers.Portable), Is.Empty);
    }

    [Test]
    public void Demand_flow_configuration_is_portable_and_pipe_only() {
        var pipe = Load("c-bath-shower");
        Assert.That(pipe.Connectors.Values.Select(connector => connector.FlowConfiguration),
            Is.All.EqualTo(FlowConfiguration.Demand));
        var json = FamilyModelJson.Serialize(pipe);
        Assert.That(FamilyModelJson.Parse(json).Diagnostics, Is.Empty);
        var schema = Newtonsoft.Json.Linq.JObject.Parse(JsonSchemaFactory.CreateEditorSchemaJson(
            typeof(FamilyModel), new JsonSchemaBuildOptions(SettingsRuntimeMode.HostOnly)));
        var flowValues = schema.SelectTokens("$..enum").OfType<Newtonsoft.Json.Linq.JArray>()
            .Single(values => values.Values<string>().Contains(nameof(FlowConfiguration.Demand)));
        Assert.That(flowValues.Values<string>(), Is.EquivalentTo(Enum.GetNames(typeof(FlowConfiguration))));

        foreach (var (domain, systemType) in new[] {
                     ("Duct", "SupplyAir"), ("Electrical", "PowerCircuit")
                 }) {
            var invalid = Newtonsoft.Json.Linq.JObject.Parse(json);
            invalid["connectors"]!["cold"]!["domain"] = domain;
            invalid["connectors"]!["cold"]!["systemType"] = systemType;
            Assert.That(FamilyModelJson.Parse(invalid.ToString()).Diagnostics,
                Has.Some.Matches<FamilyModelDiagnostic>(diagnostic =>
                    diagnostic.Code == FamilyModelDiagnosticCodes.SlotNotLegalForKind &&
                    diagnostic.Path == "$.connectors.cold.flowConfiguration"), domain);
        }
    }

    [Test]
    public void Prism_authored_desired_against_its_expanded_captured_form_diffs_empty() {
        var authored = Load("a-box");                                  // Parse expanded the prism into planes, dims, one extrusion
        var native = Newtonsoft.Json.Linq.JObject.Parse(FamilyModelJson.Serialize(authored));
        var curves = (Newtonsoft.Json.Linq.JArray)native["forms"]!["body"]!["profile"]![0]!["curves"]!;
        native["forms"]!["body"]!["profile"]![0]!["curves"] = new Newtonsoft.Json.Linq.JArray(curves.Reverse().Skip(1).Concat(curves.Reverse().Take(1)));
        native["forms"]!["body"]!["visibility"] = Newtonsoft.Json.Linq.JObject.Parse("""{"planRcp":true,"frontBack":true,"leftRight":true,"onlyWhenCut":false,"coarse":true,"medium":true,"fine":true}""");
        foreach (var dimension in ((Newtonsoft.Json.Linq.JObject)native["dimensions"]!).Properties()) dimension.Value["view"] = "RefLevel";
        var at = (Newtonsoft.Json.Linq.JArray)native["connectors"]!["power"]!["at"]!;
        native["connectors"]!["power"]!["at"] = new Newtonsoft.Json.Linq.JArray(at.Reverse());
        var captured = Parse(native.ToString());
        Assert.Multiple(() => {
            Assert.That(captured.Forms["body"].Kind, Is.EqualTo(FormKind.Extrusion));
            Assert.That(captured.RefPlanes.Keys, Is.SupersetOf(new[] { "body.left", "body.right", "body.front", "body.back", "body.top" }));
            Assert.That(FamilyReconciler.Diff(authored, captured, UnitResolvers.Portable), Is.Empty);
        });
        native["types"]!["Wide"]!["Width"] = "2ft";
        Assert.That(FamilyReconciler.Diff(authored, Parse(native.ToString()), UnitResolvers.Portable)
            .Single().Key, Is.EqualTo("Wide/Width"), "Equivalent geometry ordering must not hide a changed native value.");
    }

    [Test]
    public void Structural_identity_matches_each_current_element_at_most_once() {
        var current = Load("a-box");
        var desired = Parse(FamilyModelJson.Serialize(current));
        desired.Forms["body-copy"] = desired.Forms["body"];

        var change = FamilyReconciler.Diff(desired, current, UnitResolvers.Portable)
            .Single(item => item.Section == "forms");
        Assert.That((change.Key, change.Kind), Is.EqualTo(("body-copy", ChangeKind.Add)));
    }

    [Test]
    public void Feet_inches_and_inch_literals_are_the_same_length_through_the_unit_resolver() {
        var desired = Parse($$"""{ {{Header}}, "parameters": { "W": { "dataType": "Length", "value": "12in" }, "N": { "dataType": "Number", "value": 480 } }, "types": { "A": {} } }""");
        var current = Parse($$"""{ {{Header}}, "parameters": { "W": { "dataType": "Length", "value": "1' - 0\"" }, "N": { "dataType": "Number", "value": "480.0" } }, "types": { "A": {} } }""");
        var calls = new List<string>();
        bool Fake(string parameter, string text, out double value) { calls.Add($"{parameter}={text}"); return UnitResolvers.Portable(parameter, text, out value); }
        Assert.Multiple(() => {
            Assert.That(FamilyReconciler.Diff(desired, current, Fake), Is.Empty);
            Assert.That(calls, Does.Contain("N=480").Or.Contain("N=480.0"), "the resolver decides numeric equality for non-length values");
        });
    }

    [Test]
    public void Per_type_cells_and_uniform_values_are_one_canonical_form() {
        var desired = Parse($$"""{ {{Header}}, "parameters": { "W": { "dataType": "Length", "value": "2ft" } }, "types": { "A": {}, "B": {} } }""");
        var captured = Parse($$"""{ {{Header}}, "parameters": { "W": { "dataType": "Length" } }, "types": { "A": { "W": "24in" }, "B": { "W": "2ft" } } }""");
        Assert.That(FamilyReconciler.Diff(desired, captured, UnitResolvers.Portable), Is.Empty);
    }

    [Test]
    public void Type_names_with_slashes_remain_whole_when_cells_are_lowered() {
        var desired = Parse($$"""{ {{Header}}, "parameters": { "PE_E___MCA": { "dataType": "Current" } }, "types": { "800 - 120v - 11.5 gal/day": { "PE_E___MCA": "11.5" } } }""");
        var current = Parse($$"""{ {{Header}}, "parameters": { "PE_E___MCA": { "dataType": "Current" } }, "types": { "800 - 120v - 11.5 gal/day": {} } }""");
        var row = FamilyReconciler.Reconcile(desired, current, UnitResolvers.Portable).Queue.Operations
            .OfType<Pe.Revit.FamilyFoundry.OperationGroups.SetKnownParams>().Single().Operations
            .OfType<Pe.Revit.FamilyFoundry.Operations.SetParamValuesPerType>().Single().Settings.PerTypeAssignmentsTable.Single();
        Assert.That(row.ValuesByType.Keys, Is.EqualTo(new[] { "800 - 120v - 11.5 gal/day" }));
        Assert.That(row.Parameter, Is.EqualTo("PE_E___MCA"));
    }

    [Test]
    public void A_not_read_section_makes_every_change_in_it_unverifiable() {
        var desired = Load("a-box");
        var current = Parse($$"""{ "family": { "name": "PE Box", "category": "ElectricalEquipment", "template": "Electrical Equipment", "placement": "OneLevelBased" }, "coverage": { "parameters": "Read", "types": "Read" } }""");
        var changes = FamilyReconciler.Diff(desired, current, UnitResolvers.Portable);
        Assert.Multiple(() => {
            Assert.That(changes.Where(c => c.Section is "parameters" or "types" or "types.cell").Select(c => c.Kind), Has.All.Not.EqualTo(ChangeKind.Unverifiable));
            Assert.That(changes.Where(c => c.Section is not ("parameters" or "types" or "types.cell")), Is.Not.Empty);
            Assert.That(changes.Where(c => c.Section is not ("parameters" or "types" or "types.cell")).Select(c => c.Kind), Has.All.EqualTo(ChangeKind.Unverifiable));
        });
    }

    [TestCaseSource(nameof(Fixtures))]
    public void Each_fixture_plans_against_an_empty_template_in_dag_order(string fixture) {
        var desired = Load(fixture);
        var template = new FamilyModel { Family = desired.Family, Datums = desired.Datums };
        var plan = FamilyReconciler.Reconcile(desired, template, UnitResolvers.Portable,
            new PatchRun { Sort = new SortParamsSettings(), Clean = new CleanFamilyDocumentSettings() });
        Assert.That(plan.Refusals, Is.Empty);
        Assert.That(plan.Changes.Select(c => c.Kind), Has.All.EqualTo(ChangeKind.Add).Or.All.EqualTo(ChangeKind.Update).Or.All.Not.EqualTo(ChangeKind.Unverifiable));
        var order = plan.OpOrder;
        Assert.That(order, Is.Not.Empty);
        var cursor = 0;
        foreach (var op in order) {
            var next = Array.IndexOf(Dag, op, cursor);
            Assert.That(next, Is.GreaterThanOrEqualTo(0), $"{fixture}: '{op}' at position {cursor} is out of DAG order in [{string.Join(", ", order)}]");
            cursor = next;
        }
        Assert.That(order, Does.Contain("MakeRefPlanes"));
        Assert.That(order.Last(), Is.EqualTo("SortParams"));
    }

    [Test]
    public void A_changed_plane_recreates_its_dependents_through_the_reference_graph() {
        var current = Load("a-box");
        var moved = Parse(FamilyModelJson.Serialize(current).Replace("\"at\": \"1ft\"", "\"at\": \"2ft\""));
        Assume.That(moved.RefPlanes["body.right"].At.Feet, Is.EqualTo(2.0).Within(1e-9), "the fixture seed changed shape; retarget the replace");
        var changes = FamilyReconciler.Diff(moved, current, UnitResolvers.Portable);
        var recreated = changes.Where(c => c.Kind == ChangeKind.Recreate).Select(c => $"{c.Section}:{c.Key}").ToList();
        Assert.Multiple(() => {
            Assert.That(recreated, Does.Contain("refPlanes:body.right"));
            Assert.That(recreated, Does.Contain("dimensions:body.width"));
            Assert.That(recreated, Does.Contain("forms:body"), "the extrusion's sketch line is locked to the plane");
            Assert.That(recreated, Does.Not.Contain("refPlanes:body.left"));
        });
    }

    [Test]
    public void A_patch_null_deletes_and_empty_object_ensures() {
        var current = Load("a-box");
        var patch = FamilyPatch.Parse("""
            { "select": {},
              "patch": { "parameters": { "Voltage": null, "Amps": { "dataType": "Current", "value": 10 }, "Width": {} },
                         "connectors": { "power": null },
                         "roomCalculationPoint": { "enabled": false } },
              "run": { "blanksBecome": [ { "specs": ["Number"], "value": -1 } ], "sort": true } }
            """);
        var desired = FamilyReconciler.Desired(current, patch);
        Assert.That(desired.Diagnostics, Is.Empty, string.Join("\n", desired.Diagnostics.Select(d => $"{d.Path} {d.Code}: {d.Message}")));
        var plan = FamilyReconciler.Reconcile(desired.Value!, current, UnitResolvers.Portable, patch.Run);
        var keyed = plan.Changes.ToDictionary(c => $"{c.Section}:{c.Key}", c => c.Kind);
        Assert.Multiple(() => {
            Assert.That(keyed, Does.ContainKey("parameters:Voltage").WithValue(ChangeKind.Delete));
            Assert.That(keyed, Does.ContainKey("parameters:Amps").WithValue(ChangeKind.Add));
            Assert.That(keyed, Does.Not.ContainKey("parameters:Width"), "{} ensures an existing entry and changes nothing");
            Assert.That(keyed, Does.ContainKey("connectors:power").WithValue(ChangeKind.Delete));
            Assert.That(keyed, Does.ContainKey("roomCalculationPoint:roomCalculationPoint").WithValue(ChangeKind.Update));
            Assert.That(plan.RunEffects, Is.EqualTo(new[] { "run.blanksBecome: 1 rules", "run.sort" }));
            Assert.That(plan.OpOrder, Is.EqualTo(new[] { "DeleteByName", "DeleteParams", "AddParams", "SetParamMetadata", "SetParamValues", "SetParamValuesPerType", "SetBlankValues", "AddRoomDingler", "SortParams" }));
        });
    }

    [Test]
    public void Two_targets_naming_one_source_rename_once_and_add_once() {
        var desired = Parse($$"""{ {{Header}}, "parameters": { "PE_E___Voltage": { "dataType": "ElectricalPotential", "wasNamed": ["Voltage"] }, "PE_E___Volts": { "dataType": "ElectricalPotential", "wasNamed": ["Voltage"] } } }""");
        var current = Parse($$"""{ {{Header}}, "parameters": { "Voltage": { "dataType": "ElectricalPotential" } } }""");
        var kinds = FamilyReconciler.Diff(desired, current, UnitResolvers.Portable)
            .Where(c => c.Section == "parameters").ToDictionary(c => c.Key, c => c.Kind);
        Assert.Multiple(() => {
            Assert.That(kinds.Values.Count(k => k == ChangeKind.Rename), Is.EqualTo(1));
            Assert.That(kinds.Values.Count(k => k == ChangeKind.Add), Is.EqualTo(1));
            Assert.That(kinds, Does.Not.ContainKey("Voltage"), "the claimed source is renamed away, not deleted");
        });
    }

    [Test]
    public void A_value_on_a_family_with_no_types_is_refused_rather_than_dropped() {
        var desired = Parse($$"""{ {{Header}}, "parameters": { "W": { "dataType": "Length", "value": "2ft" } } }""");
        var current = Parse($$"""{ {{Header}}, "parameters": { "W": { "dataType": "Length" } } }""");
        var plan = FamilyReconciler.Reconcile(desired, current, UnitResolvers.Portable);
        Assert.That(plan.Refusals.Select(r => r.Code), Is.EqualTo(new[] { FamilyModelDiagnosticCodes.ValueWithoutTypes }));
    }

    [Test]
    public void An_unread_cell_makes_that_cell_unverifiable_and_leaves_its_neighbours_alone() {
        var desired = Parse($$"""{ {{Header}}, "parameters": { "W": { "dataType": "Length" } }, "types": { "A": { "W": "2ft" }, "B": { "W": "3ft" } } }""");
        var current = Parse($$"""{ {{Header}}, "parameters": { "W": { "dataType": "Length" } }, "types": { "A": {}, "B": {} }, "coverage": { "parameters": "Read", "types": "Partial" }, "unmodeled": [ { "reason": "ParameterValueUnreadable", "path": "$.types.A.W" } ] }""");
        var kinds = FamilyReconciler.Diff(desired, current, UnitResolvers.Portable)
            .Where(c => c.Section == "types.cell").ToDictionary(c => c.Key, c => c.Kind);
        Assert.Multiple(() => {
            Assert.That(kinds, Does.ContainKey("A/W").WithValue(ChangeKind.Unverifiable));
            Assert.That(kinds, Does.ContainKey("B/W").WithValue(ChangeKind.Update));
        });
    }

    [Test]
    public void Fill_blanks_stops_asking_once_no_source_survives() {
        var desired = Parse($$"""{ {{Header}}, "parameters": { "PE_M___Airflow": { "dataType": "AirFlow", "wasNamed": ["CFM"], "fillBlanksFromSources": true } }, "types": { "A": { "PE_M___Airflow": "100 CFM" }, "B": {} } }""");
        var authored = Newtonsoft.Json.Linq.JObject.Parse("""{"parameters":{"PE_M___Airflow":{}}}""");
        var before = Parse($$"""{ {{Header}}, "parameters": { "PE_M___Airflow": { "dataType": "AirFlow" }, "CFM": { "dataType": "AirFlow" } }, "types": { "A": { "PE_M___Airflow": "100 CFM" }, "B": {} } }""");
        var after = Parse($$"""{ {{Header}}, "parameters": { "PE_M___Airflow": { "dataType": "AirFlow" } }, "types": { "A": { "PE_M___Airflow": "100 CFM" }, "B": {} } }""");
        FamilyPlan Plan(FamilyModel current) => FamilyReconciler.Reconcile(desired, current, UnitResolvers.Portable, null, _ => null, authored);
        Assert.Multiple(() => {
            Assert.That(Plan(before).Changes.Any(c => c.Section == "parameters.sources"), Is.True, "the source is still there to fill from");
            Assert.That(Plan(after).Changes.Any(c => c.Section == "parameters.sources"), Is.False, "type B stays blank forever; asking again never converges");
        });
    }

    [Test]
    public void Connector_identity_is_domain_on_and_sorted_at() {
        var a = new FamilyModelConnector { Domain = ConnectorDomain.Pipe, SystemType = ConnectorSystemType.Sanitary, On = "top", At = ["x", "y"] };
        var b = new FamilyModelConnector { Domain = ConnectorDomain.Pipe, SystemType = ConnectorSystemType.Vent, On = "top", At = ["y", "x"] };
        Assert.That(FamilyReconciler.ConnectorKey(a), Is.EqualTo(FamilyReconciler.ConnectorKey(b)));
    }
}
