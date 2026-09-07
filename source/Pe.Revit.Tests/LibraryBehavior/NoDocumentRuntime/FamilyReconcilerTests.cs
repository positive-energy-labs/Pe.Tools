using Pe.Revit.FamilyFoundry.Reconcile;
using Pe.Shared.RevitData.Families;

namespace Pe.Revit.Tests.LibraryBehavior.NoDocumentRuntime;

/// <summary>Deterministic proof of the pure half of the reconciler: no Document, no Revit.</summary>
[TestFixture]
public sealed class FamilyReconcilerTests {
    [Test]
    public void Structured_run_policies_retain_native_clean_and_sort_settings() {
        var model = new FamilyModel { Family = new FamilyModelHeader { Name = "Policies", Category = FamilyCategory.GenericModels,
            Template = "Generic Model", Placement = FamilyModelPlacement.OneLevelBased } };
        var patch = FamilyPatch.Parse("""{"patch":{},"run":{"clean":{"Enabled":true,"EnablePurgeParams":false,"EnablePurgeNestedFamilies":false,"EnablePurgeModelLines":false,"EnablePurgeReferencePlanes":false},"sort":{"ParamNameSortOrder":"Descending","ParamTypeSortOrder":"FamilyParamsFirst","ParamValueSortOrder":"ValuesFirst"}}}""");
        var plan = FamilyReconciler.Reconcile(model, model, UnitResolvers.Portable, patch.Run);
        var sort = plan.Queue.Operations.OfType<Pe.Revit.FamilyFoundry.Operations.SortParams>().Single().Settings;
        Assert.That(sort.ParamNameSortOrder, Is.EqualTo(Pe.Revit.FamilyFoundry.Operations.ParamNameSortOrder.Descending));
        Assert.That(sort.ParamTypeSortOrder, Is.EqualTo(Pe.Revit.FamilyFoundry.Operations.ParamTypeSortOrder.FamilyParamsFirst));
        Assert.That(sort.ParamValueSortOrder, Is.EqualTo(Pe.Revit.FamilyFoundry.Operations.ParamValueSortOrder.ValuesFirst));
        Assert.That(plan.Queue.Operations.Where(o => o.Name.StartsWith("Purge")).All(o => !o.Settings.Enabled), Is.True);
        var defaults = FamilyReconciler.Reconcile(model, model, UnitResolvers.Portable, new PatchRun { Clean = true, Sort = true });
        Assert.That(plan.PlanHash, Is.Not.EqualTo(defaults.PlanHash));
        Assert.Throws<Newtonsoft.Json.JsonSerializationException>(() => FamilyReconciler.Reconcile(model, model, UnitResolvers.Portable,
            FamilyPatch.Parse("""{"patch":{},"run":{"sort":{"MisspelledPolicy":true}}}""").Run));
    }

    private static readonly string[] Fixtures = ["a-box", "b-grd", "c-bath-shower", "d-bath-shower-refline"];

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
            var candidate = Path.Combine(probe.FullName, "Fixtures", "FamilyModel", $"{name}.family.json");
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
        var plan = FamilyReconciler.Reconcile(desired, template, UnitResolvers.Portable, new PatchRun { Sort = true, Clean = true });
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
    public void Connector_identity_is_domain_on_and_sorted_at() {
        var a = new FamilyModelConnector { Domain = ConnectorDomain.Pipe, SystemType = ConnectorSystemType.Sanitary, On = "top", At = ["x", "y"] };
        var b = new FamilyModelConnector { Domain = ConnectorDomain.Pipe, SystemType = ConnectorSystemType.Vent, On = "top", At = ["y", "x"] };
        Assert.That(FamilyReconciler.ConnectorKey(a), Is.EqualTo(FamilyReconciler.ConnectorKey(b)));
    }
}
