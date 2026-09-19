using Newtonsoft.Json.Linq;
using Pe.Revit.FamilyFoundry.OperationSettings;
using Pe.Revit.FamilyFoundry.Operations;
using Pe.Shared.RevitData.Families;
using Pe.Shared.StorageRuntime.Json;

namespace Pe.Shared.Tests;

/// <summary>
///     The `family.json` contract proved without Revit: the four showcase fixtures parse clean and roundtrip,
///     the s-pea §2.4 silent errors are caught (or listed as deliberately silent), a patch merges, macros
///     expand to exactly what r2-schema §5 names, and the slot grammar accepts Revit's feet-inches form.
/// </summary>
[TestFixture]
public sealed class FamilyModelContractTests {
    private const string Head = """{"name":"x","category":"GenericModels","template":"Generic Model","placement":"OneLevelBased"}""";
    private const string Datums = """{"Ref. Level":{"normal":"Z","isLevel":true},"Center (Left/Right)":{"normal":"X"},"Center (Front/Back)":{"normal":"Y"}}""";
    private const string Box = """{"kind":"Prism","center":["Center (Left/Right)","Center (Front/Back)"],"bottom":"Ref. Level","width":"6in","depth":"1in","height":"1in"}""";

    /// <summary>Wraps a `{...}` fragment of sections into a document with a header and the three stock datums.</summary>
    private static string Doc(string sections) => "{\"family\":" + Head + ",\"datums\":" + Datums + "," + sections.Substring(1);

    [TestCase(false, false, false)]
    [TestCase(true, false, true)]
    [TestCase(false, true, true)]
    public void Exported_source_condition_is_evaluated_per_family(bool source, bool destination, bool expected) {
        var current = FamilyModelJson.Parse(Doc("{\"parameters\":{" + (source ? "\"Source\":{\"dataType\":\"Text\"}" :
            destination ? "\"Target\":{\"dataType\":\"Text\"}" : "") + "}}")).Value!;
        const string json = """{"patch":{},"run":{"parametersIfSourceExists":{"Target":{"dataType":"Text","wasNamed":["Source"]}}}}""";
        var patch = FamilyPatch.Parse(json);
        Assert.That(patch.ResolveParameterRules(current)["parameters"]?["Target"] is not null, Is.EqualTo(expected));
        Assert.That(patch.Run!.ParametersIfSourceExists!.ContainsKey("Target"), Is.True, "Resolution must not erase exported rules.");
        var roundtrip = FamilyPatch.Parse(Newtonsoft.Json.JsonConvert.SerializeObject(patch));
        Assert.That(JToken.DeepEquals(roundtrip.ResolveParameterRules(current), patch.ResolveParameterRules(current)), Is.True);
    }

    [Test]
    public void Explicit_parameter_state_and_deletion_override_conditional_defaults() {
        var current = FamilyModelJson.Parse(Doc("""{"parameters":{"Source":{"dataType":"Text"}}}""")).Value!;
        var patch = FamilyPatch.Parse("""{"patch":{"parameters":{"Target":{"value":"explicit"}}},"run":{"parametersIfSourceExists":{"Target":{"dataType":"Text","value":"default","wasNamed":["Source"]}}}}""");
        Assert.That((string?)patch.ResolveParameterRules(current)["parameters"]?["Target"]?["value"], Is.EqualTo("explicit"));
        patch.Patch["parameters"]!["Target"] = JValue.CreateNull();
        Assert.That(patch.ResolveParameterRules(current)["parameters"]!["Target"]!.Type, Is.EqualTo(JTokenType.Null));
    }

    [Test]
    public void Run_failures_names_actions_and_omits_them_by_default() {
        var run = FamilyPatch.Parse("""{"patch":{},"run":{"failures":{"constraintsNotSatisfied":"resolve","cantKeepJoined":"delete"}}}""").Run!;
        Assert.Multiple(() => {
            Assert.That(run.Failures!["constraintsNotSatisfied"], Is.EqualTo(FailureAction.Resolve));
            Assert.That(run.Failures["cantKeepJoined"], Is.EqualTo(FailureAction.Delete));
            Assert.That(FamilyPatch.Parse("""{"patch":{},"run":{"clean":true}}""").Run!.Failures, Is.Null);
            Assert.That(FamilyPatch.Parse("""{"patch":{},"run":{"clean":true}}""").Run!.BacklinkBuiltIns, Is.True);
            Assert.That(FamilyPatch.Parse("""{"patch":{},"run":{"backlinkBuiltIns":false}}""").Run!.BacklinkBuiltIns, Is.False);
        });
    }

    [Test]
    public void Run_clean_and_sort_accept_boolean_shorthand_and_strict_typed_settings() {
        var defaults = FamilyPatch.Parse("""{"patch":{},"run":{"clean":true,"sort":true}}""").Run!;
        var disabled = FamilyPatch.Parse("""{"patch":{},"run":{"clean":false,"sort":false}}""").Run!;
        var partial = FamilyPatch.Parse("""{"patch":{},"run":{"clean":{"EnablePurgeParams":false},"sort":{"ParamNameSortOrder":"Descending"}}}""").Run!;
        Assert.Multiple(() => {
            Assert.That(defaults.Clean!.EnablePurgeParams, Is.True);
            Assert.That(defaults.Sort!.ParamTypeSortOrder, Is.EqualTo(ParamTypeSortOrder.SharedParamsFirst));
            Assert.That(disabled.Clean!.Enabled, Is.False);
            Assert.That(disabled.Sort!.Enabled, Is.False);
            Assert.That(partial.Clean!.EnablePurgeParams, Is.False);
            Assert.That(partial.Clean.EnablePurgeNestedFamilies, Is.True);
            Assert.That(partial.Sort!.ParamNameSortOrder, Is.EqualTo(ParamNameSortOrder.Descending));
            Assert.That(partial.Sort.ParamTypeSortOrder, Is.EqualTo(ParamTypeSortOrder.SharedParamsFirst));
        });
        Assert.Throws<Newtonsoft.Json.JsonSerializationException>(() =>
            FamilyPatch.Parse("""{"patch":{},"run":{"clean":{"PurgeParamsSettings":{"Unknown":true}}}}"""));
        Assert.That(typeof(ExcludeSharedParameter).GetProperties()
                .Select(p => p.GetCustomAttributes(typeof(IncludableAttribute), false).SingleOrDefault())
                .OfType<IncludableAttribute>().Select(a => a.FragmentSchemaName),
            Is.EqualTo(Enumerable.Repeat("shared-parameter-names", 3)), "Clean exclusions retain fragment composition metadata.");
    }

    [Test]
    public void Explicit_uniform_value_replaces_captured_cells_but_keeps_explicit_type_override() {
        var current = Doc("""{"parameters":{"W":{"dataType":"Length"},"Keep":{"dataType":"Text"}},"types":{"A":{"W":"1ft","Keep":"unchanged"},"B":{"W":"2ft"}}}""");
        var result = FamilyPatch.Apply(current, """{"parameters":{"W":{"value":"3ft"}},"types":{"B":{"W":"4ft"}}}""");
        Assert.That(result.Diagnostics, Is.Empty);
        Assert.Multiple(() => {
            Assert.That(result.Value!.Parameters["W"].Value!.Value.Text, Is.EqualTo("3ft"));
            Assert.That(result.Value.Types["A"].ContainsKey("W"), Is.False);
            Assert.That(result.Value.Types["A"]["Keep"].Text, Is.EqualTo("unchanged"));
            Assert.That(result.Value.Types["B"]["W"].Text, Is.EqualTo("4ft"));
        });
    }

    [TestCase("""{"value":"3ft"}""", false)]
    [TestCase("""{"formula":"2 * 1'"}""", true)]
    public void Explicit_formula_or_value_replaces_inherited_opposite(string authored, bool formula) {
        var current = Doc("""{"parameters":{"W":{"dataType":"Length","formula":"1'"}},"types":{"A":{}}}""");
        var result = FamilyPatch.Apply(current, "{\"parameters\":{\"W\":" + authored + "}}");
        Assert.That(result.Diagnostics, Is.Empty);
        Assert.That(result.Value!.Parameters["W"].Formula is not null, Is.EqualTo(formula));
    }

    [Test]
    public void Shared_mapping_fields_roundtrip_and_local_conversion_clears_identity() {
        var current = Doc("""{"parameters":{"W":{"dataType":"Length","tooltip":"old"}},"types":{"A":{}}}""");
        var result = FamilyPatch.Apply(current, """{"parameters":{"W":{"shared":true,"sharedGuid":"692091cc-1e3d-47e6-a7c5-9336c3149419","wasNamed":["Width"],"fillBlanksFromSources":true,"mappingStrategy":"Strict"}}}""");
        Assert.That(result.Diagnostics, Is.Empty);
        var parameter = result.Value!.Parameters["W"];
        Assert.Multiple(() => {
            Assert.That(parameter.SharedGuid, Is.EqualTo(Guid.Parse("692091cc-1e3d-47e6-a7c5-9336c3149419")));
            Assert.That(parameter.FillBlanksFromSources, Is.True);
            Assert.That(parameter.MappingStrategy, Is.EqualTo("Strict"));
            Assert.That(parameter.DataType, Is.Null);
            Assert.That(parameter.Tooltip, Is.Null);
        });
        var serialized = FamilyModelJson.Serialize(result.Value);
        var roundtrip = FamilyModelJson.Parse(serialized);
        Assert.That(roundtrip.Diagnostics, Is.Empty);
        Assert.That(FamilyModelJson.Serialize(roundtrip.Value!), Is.EqualTo(serialized));
        var local = FamilyPatch.Apply(serialized, """{"parameters":{"W":{"shared":false,"dataType":"Length"}}}""");
        Assert.That(local.Diagnostics, Is.Empty);
        Assert.That(local.Value!.Parameters["W"].SharedGuid, Is.Null);
    }

    [TestCase("1.23456789012345E-12ft", 1.23456789012345E-12)]
    [TestCase("1.23456789012345E-12deg", 1.23456789012345E-12)]
    public void Exact_capture_literals_preserve_scientific_notation(string text, double expected) {
        Assert.That(PortableScalar.TryParse(text, out var value), Is.True);
        Assert.That(value.Value, Is.EqualTo(expected));
        if (value.Kind == PortableScalarKind.Length)
            Assert.That(PortableLength.Parse(PortableLength.FromFeet(expected).Text).Feet, Is.EqualTo(expected));
    }

    [TestCase("480", false)]
    [TestCase("1e3", false)]
    [TestCase("1/2", false)]
    [TestCase("480 V", true)]
    [TestCase("3ft", true)]
    public void Authored_measurable_literals_require_units(string value, bool accepted) {
        var patch = new JObject { ["parameters"] = new JObject {
            ["Voltage"] = new JObject { ["value"] = value },
            ["Number"] = new JObject { ["value"] = 3 },
            ["Formula"] = new JObject { ["formula"] = "480" }
        } };
        Assert.That(FamilyValueUnits.Validate(patch, name => name != "Number").Count, Is.EqualTo(accepted ? 0 : 1));
        Assert.That(FamilyValueUnits.Validate(new JObject(), _ => true), Is.Empty, "Captured unmentioned values are not authored literals.");
    }

    [Test]
    public void Embedded_shared_definition_is_portable_without_service_name_resolution() {
        var result = FamilyModelJson.Parse(Doc("""{"parameters":{"Offline":{"shared":true,"sharedGuid":"692091cc-1e3d-47e6-a7c5-9336c3149419","sharedSpecId":"autodesk.spec.aec:length-2.0.0","sharedVisible":false,"sharedUserModifiable":false,"tooltip":"Exact definition description"}},"types":{"A":{}}}"""));
        Assert.That(result.Diagnostics, Is.Empty);
        var serialized = FamilyModelJson.Serialize(result.Value!);
        Assert.That(FamilyModelJson.Serialize(FamilyModelJson.Parse(serialized).Value!), Is.EqualTo(serialized));
        var local = FamilyPatch.Apply(serialized, """{"parameters":{"Offline":{"shared":false,"dataType":"Length"}}}""");
        Assert.That(local.Diagnostics, Is.Empty);
        Assert.That(local.Value!.Parameters["Offline"].SharedSpecId, Is.Null);
        Assert.That(local.Value.Parameters["Offline"].SharedVisible, Is.Null);
    }

    [Test]
    public void Company_corpus_retains_original_bytes_and_all_saved_equipment() {
        var root = Path.GetFullPath(Path.Combine(FixtureDir, "..", "Profiles", "company-20260906"));
        var manifest = JObject.Parse(File.ReadAllText(Path.Combine(root, "manifest.json")));
        var files = manifest["files"]!.Children<JObject>().ToList();
        Assert.That(files.Count, Is.EqualTo(52));
        Assert.That(files.Count(f => ((string)f["path"]!).Contains("/SavedEquip/", StringComparison.Ordinal)), Is.EqualTo(14));
        foreach (var file in files) {
            var bytes = File.ReadAllBytes(Path.Combine(root, (string)file["path"]!));
            Assert.That(Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(bytes)).ToLowerInvariant(), Is.EqualTo((string)file["sha256"]!), (string)file["path"]!);
        }
        Assert.That(manifest["unresolved"]!.Count(), Is.EqualTo(2), "The original census remains unchanged after reconstruction and resolver repairs.");
    }

    [Test]
    public void Composed_company_corpus_covers_every_original_profile() {
        var root = Path.GetFullPath(Path.Combine(FixtureDir, "..", "Profiles"));
        var original = JObject.Parse(File.ReadAllText(Path.Combine(root, "company-20260906", "manifest.json")));
        var expected = original["files"]!.Select(x => (string)x["path"]!).Where(p => p.Contains("/profiles/"));
        var composed = JArray.Parse(File.ReadAllText(Path.Combine(root, "company-composed-20260906.json")));
        Assert.That(composed.Select(x => (string)x["source"]!), Is.EquivalentTo(expected));
        Assert.That(composed.Count, Is.EqualTo(45));
        Assert.That(composed.Descendants().OfType<JProperty>().Where(p => p.Name is "$include" or "$preset"), Is.Empty);
        foreach (var profile in composed) {
            var source = JObject.Parse(File.ReadAllText(Path.Combine(root, "company-20260906", (string)profile["source"]!)));
            Assert.That(((JObject)profile["settings"]!).Properties().Select(p => p.Name), Is.EquivalentTo(source.Properties().Select(p => p.Name)), (string)profile["source"]!);
        }
    }

    [Test]
    public void AprilAire_inline_fields_override_preset_and_preserve_other_fields() {
        var root = Path.GetFullPath(Path.Combine(FixtureDir, "..", "Profiles"));
        const string path = "CmdFFManager/profiles/SavedEquip/AprilAire E-Series.json";
        var original = JObject.Parse(File.ReadAllText(Path.Combine(root, "company-20260906", path)))["FilterApsParams"]!;
        var composed = JArray.Parse(File.ReadAllText(Path.Combine(root, "company-composed-20260906.json")));
        var actual = composed.Single(p => (string)p["source"]! == path)["settings"]!["FilterApsParams"]!;
        var preset = composed.Single(p => (string)p["source"]! == "CmdFFMigrator/profiles/MechEquip/DH.json")["settings"]!["FilterApsParams"]!;
        Assert.Multiple(() => {
            Assert.That(JToken.DeepEquals(actual["IncludeNames"]!["Equaling"], original["IncludeNames"]!["Equaling"]), Is.True);
            Assert.That(JToken.DeepEquals(actual["IncludeNames"]!["StartingWith"], preset["IncludeNames"]!["StartingWith"]), Is.True);
            Assert.That(JToken.DeepEquals(actual["ExcludeNames"], preset["ExcludeNames"]), Is.True);
        });
    }

    [Test]
    public void Reconstructed_dehumidifier_filter_retains_both_profiles_parameter_requirements() {
        var root = Path.GetFullPath(Path.Combine(FixtureDir, "..", "Profiles"));
        var composed = JArray.Parse(File.ReadAllText(Path.Combine(root, "company-composed-20260906.json")));
        var dh = composed.Single(p => (string)p["source"]! == "CmdFFMigrator/profiles/MechEquip/DH.json")["settings"]!;
        var filter = dh["FilterApsParams"]!;
        bool Matches(string name, string part) =>
            filter[part]!["Equaling"]!.Values<string>().Contains(name, StringComparer.Ordinal) ||
            (filter[part]!["StartingWith"]?.Values<string>() ?? []).Any(prefix => name.StartsWith(prefix!, StringComparison.Ordinal));
        var saved = JObject.Parse(File.ReadAllText(Path.Combine(root, "company-20260906", "CmdFFManager", "profiles", "SavedEquip", "AprilAire E-Series.json")));
        var requirements = saved["SetKnownParams"]!["GlobalAssignments"]!.Concat(saved["SetKnownParams"]!["PerTypeAssignmentsTable"]!)
            .Concat(dh["SetKnownParams"]!["GlobalAssignments"]!).Select(p => (string)p["Parameter"]!)
            .Concat(["PE_M___DehuPintsPerDayDesign", "PE_M___DehuPintsPerDayRated", "PE_G___RefrigerantType"]);
        foreach (var name in requirements.Distinct(StringComparer.Ordinal)) {
            Assert.That(Matches(name, "IncludeNames"), Is.True, name);
            Assert.That(Matches(name, "ExcludeNames"), Is.False, name);
        }
        Assert.That(Matches("PE_E___MainBreakerRating", "ExcludeNames"), Is.True, "Existing panel exclusion include is retained.");
        Assert.That(Matches("PE_M___HuGallonsPerHour", "ExcludeNames"), Is.True, "Humidifier-only field stays excluded.");
    }

    public static string FixtureDir {
        get {
            var dir = new DirectoryInfo(AppContext.BaseDirectory);
            while (dir != null && !Directory.Exists(Path.Combine(dir.FullName, "source", "Pe.Revit.Tests"))) dir = dir.Parent;
            return Path.Combine(dir!.FullName, "source", "Pe.Revit.Tests", "Fixtures", "FamilyModel");
        }
    }

    public static IEnumerable<string> Fixtures => Directory.GetFiles(FixtureDir, "*.json").Where(path => !path.EndsWith(".captured.json", StringComparison.Ordinal) && !path.EndsWith(".patch.json", StringComparison.Ordinal)).Select(Path.GetFileName)!;

    [Test]
    public void Nested_model_resolves_by_schema_and_family_name_not_filename() {
        const string schema = "/schemas/settings/FamilyFoundry/models.json";
        var directory = Directory.CreateTempSubdirectory("pe-nested-").FullName;
        try {
            File.WriteAllText(Path.Combine(directory, "anything.json"), $$"""{ "$schema": "http://127.0.0.1:5180{{schema}}", "family": { "name": "leaf" } }""");
            File.WriteAllText(Path.Combine(directory, "leaf.json"), """{ "family": { "name": "leaf" } }"""); // no $schema: plain data
            File.WriteAllText(Path.Combine(directory, "other.json"), $$"""{ "$schema": "{{schema}}", "family": { "name": "other" } }""");
            File.WriteAllText(Path.Combine(directory, "broken.json"), "not json");
            Assert.That(FamilyModelJson.FindModel(directory, "leaf", schema), Is.EqualTo(Path.Combine(directory, "anything.json")));
            Assert.That(FamilyModelJson.FindModel(directory, "absent", schema), Is.Null, "no match falls to the .rfa");
            File.WriteAllText(Path.Combine(directory, "twin.json"), $$"""{ "$schema": "{{schema}}", "family": { "name": "leaf" } }""");
            Assert.That(Assert.Throws<InvalidOperationException>(() => FamilyModelJson.FindModel(directory, "leaf", schema))!.Message,
                Does.Contain("anything.json").And.Contain("twin.json"));
        } finally {
            Directory.Delete(directory, true);
        }
    }

    [TestCaseSource(nameof(Fixtures))]
    public void Showcase_fixture_parses_clean_and_roundtrips(string file) {
        var result = FamilyModelJson.Parse(File.ReadAllText(Path.Combine(FixtureDir, file)));
        Assert.That(result.Diagnostics, Is.Empty, string.Join("\n", result.Diagnostics.Select(d => $"[{d.Code}] {d.Path}: {d.Message}")));
        var once = FamilyModelJson.Serialize(result.Value!);
        var again = FamilyModelJson.Parse(once);
        Assert.That(again.Diagnostics, Is.Empty);
        Assert.That(FamilyModelJson.Serialize(again.Value!), Is.EqualTo(once));
        Assert.That(again.Value!.Forms.Values.Select(f => f.Kind), Has.All.EqualTo(FormKind.Extrusion));
    }

    // Gotcha 18: a value that names a parameter is a formula; it is refused, never written as a literal. Measured
    // specs already refuse any text; unit-carrying specs admit text for Revit units, so they need the name check.
    // A text-like parameter's value is a string, so a name there is literal text, exactly as Revit stores it.
    [TestCase("AirFlow", "Supply * 2", "value-names-parameter")]
    [TestCase("AirFlow", "Supply", "value-names-parameter")]
    [TestCase("Area", "Width * Depth", "value-names-parameter")]
    [TestCase("Length", "Width * 2", "value-datatype-mismatch")]
    [TestCase("AirFlow", "280 CFM", null)]
    [TestCase("Text", "Width", null)]
    public void A_value_naming_a_parameter_is_refused_as_a_formula(string dataType, string cell, string? code) {
        var declared = """{"Supply":{"dataType":"AirFlow"},"Width":{"dataType":"Length"},"Depth":{"dataType":"Length"},"V":{"dataType":"DT"}}"""
            .Replace("DT", dataType);
        var cellJson = Newtonsoft.Json.JsonConvert.ToString(cell);
        var perType = FamilyModelJson.Parse(Doc("{\"parameters\":" + declared + ",\"types\":{\"A\":{\"V\":" + cellJson + "}}}"));
        var single = FamilyModelJson.Parse(Doc("{\"parameters\":" + declared.Replace("\"V\":{", "\"V\":{\"value\":" + cellJson + ",") + "}"));
        Assert.Multiple(() => {
            Assert.That(perType.Diagnostics.Select(x => x.Code), code == null ? Is.Empty : Does.Contain(code), "per-type cell");
            Assert.That(single.Diagnostics.Select(x => x.Code), code == null ? Is.Empty : Does.Contain(code), "parameter value");
        });
    }

    // s-pea §2.4 numbering. Deliberately silent: #7 wasNamed (names the current family), #12 bowtie (plane loops cannot self-intersect).
    // Dead by construction: #3 wall-hosted solid, #22 connector direction. Product-only: #2 template, #13 nested type, #14 associate key, #16 array plane direction.
    [TestCase(1, """{"family":{"name":"x","category":"Not A Revit Category","template":"t","placement":"OneLevelBased"}}""", "invalid-json")]
    [TestCase(4, """{"parameters":{"W":{"dataType":"Sasquatch"}}}""", "invalid-json")]
    [TestCase(5, """{"parameters":{"W":{"dataType":"Length","value":"purple"}}}""", "value-datatype-mismatch")]
    [TestCase(6, """{"parameters":{"W":{"dataType":"Length","formula":"Nonexistent Parameter * 2"}}}""", "formula-unknown-name")]
    [TestCase(8, """{"parameters":{"W":{"dataType":"Length"}},"types":{"S":{"W":"12 furlongs"}}}""", "value-datatype-mismatch")]
    [TestCase(9, """{"dimensions":{"d":{"between":["ThisPlaneDoesNotExist","Center (Left/Right)"],"locked":"1in"}}}""", "unknown-reference")]
    [TestCase(10, """{"connectors":{"c":{"domain":"Duct","systemType":"SupplyAir","on":"AlsoFake","at":["Center (Left/Right)","Center (Front/Back)"]}}}""", "unknown-reference")]
    [TestCase(11, """{"refLines":{"line-1":{"on":"Ref. Level","from":["Center (Left/Right)","Center (Left/Right)"],"length":"1in"}}}""", "refline-from-parallel")]
    [TestCase(15, """{"parameters":{"n":{"dataType":"Integer","value":-7}},"nested":{"m":{"family":"f","type":"t","host":"Ref. Level"}},"arrays":{"a":{"member":"m","direction":"PlusY","label":"param:n","moveTo":"Last","spacingPlane":"Center (Front/Back)"}}}""", "array-count-below-two")]
    [TestCase(17, """{"connectors":{"c":{"domain":"Duct","systemType":"NotAnActualSystemType","on":"Ref. Level","at":["Center (Left/Right)","Center (Front/Back)"]}}}""", "invalid-json")]
    [TestCase(18, """{"connectors":{"c":{"domain":"Duct","systemType":"SupplyAir","on":"Ref. Level","at":["Center (Left/Right)","Center (Front/Back)"],"flowDirection":"Sideways"}}}""", "invalid-json")]
    [TestCase(19, """{"forms":{"b":{"kind":"Prism","center":["Center (Left/Right)","Center (Front/Back)"],"bottom":"Ref. Level","width":"-9in","depth":"1in","height":"1in"}}}""", "length-not-positive")]
    [TestCase(20, """{"connectors":{"c":{"domain":"Duct","systemType":"SupplyAir","on":"Ref. Level","at":["Center (Left/Right)","Center (Front/Back)"]},"d":{"domain":"Duct","systemType":"ReturnAir","on":"Ref. Level","at":["Center (Front/Back)","Center (Left/Right)"]}}}""", "connector-position-duplicate")]
    [TestCase(21, """{"lookupTables":{"t":{"csv":"a,b\n1,2"}}}""", "lookup-table-header")]
    [TestCase(23, """{"forms":{"b":{"kind":"Prism","center":["Center (Left/Right)","Center (Front/Back)"],"bottom":"Ref. Level","width":"6","depth":"1in","height":"1in"}}}""", "invalid-json")]
    [TestCase(24, """{"parameters":{"W":{"dataType":"Length","value":"1in"},"W":{"dataType":"Length"}}}""", "invalid-json")]
    [TestCase(25, """{"parameters":{"W":{"dataType":"Length"}},"nonsense":{}}""", "invalid-json")]
    [TestCase(26, """{"parameters":{"S":{"shared":true,"dataType":"Length"}}}""", "shared-owns-datatype")]
    [TestCase(27, """{"parameters":{"W":{"value":"1in"}}}""", "required")]
    [TestCase(28, """{"coverage":{"frames":"Read"}}""", "coverage-section-unknown")]
    // kaitpw rulings 2026-09-06: reference lines key positionally.
    [TestCase(101, """{"refLines":{"conn swing (left)":{"on":"Ref. Level","from":["Center (Left/Right)","Center (Front/Back)"],"length":"1in"}}}""", "refline-key-positional")]
    [TestCase(102, """{"family":{"name":"x","category":"AirTerminals","template":"t","placement":"OneLevelBased"},"datums":{"Center (Front/Back)":{"normal":"MinusY"}}}""", "datum-normal-unsigned")]
    [TestCase(103, """{"refPlanes":{"neck (Back)":{"normal":"Y","at":"2in"}}}""", "refplane-normal-signed")]
    public void Silent_error_is_caught(int probe, string body, string code) {
        var json = body.Contains("\"family\":{") ? body : Doc(body);
        var result = FamilyModelJson.Parse(json);
        Assert.That(result.Diagnostics.Select(d => d.Code), Does.Contain(code),
            $"#{probe}: {string.Join("\n", result.Diagnostics.Select(d => $"[{d.Code}] {d.Path}: {d.Message}"))}");
    }

    [Test]
    public void Patch_merges_with_omit_null_and_object_rules() {
        var current = File.ReadAllText(Path.Combine(FixtureDir, "a-box.json"));
        var patch = FamilyPatch.Parse("""
            { "select": { "categories": ["Electrical Equipment"], "placedOnly": true },
              "patch": { "connectors": { "aux": { "domain": "Electrical", "systemType": "PowerCircuit", "on": "body.top", "at": ["body.left", "Center (Front/Back)"] } },
                         "types": { "Wide": null, "Narrow": {} },
                         "parameters": { "Depth": { "value": "10in" } } },
              "run": { "blanksBecome": [ { "specs": ["Number", "AirFlow"], "value": "-1" } ], "clean": true } }
            """);
        Assert.That(patch.Select.Categories, Is.EqualTo(new[] { FamilyCategory.ElectricalEquipment }));
        Assert.That(patch.Run!.BlanksBecome![0].Specs, Does.Contain(DataType.AirFlow));

        var merged = FamilyPatch.Apply(current, patch.Patch.ToString());
        Assert.That(merged.Diagnostics, Is.Empty, string.Join("\n", merged.Diagnostics.Select(d => $"[{d.Code}] {d.Path}: {d.Message}")));
        var m = merged.Value!;
        Assert.That(m.Types.Keys, Is.EqualTo(new[] { "Standard", "Narrow" }));
        Assert.That(m.Parameters["Depth"].Value!.Value.Text, Is.EqualTo("10in"));
        Assert.That(m.Parameters["Depth"].DataType, Is.EqualTo(DataType.Length), "omission inside the object left dataType unchanged");
        Assert.That(m.Connectors.Keys, Is.EquivalentTo(new[] { "power", "aux" }));
    }

    [Test]
    public void Prism_macro_expands_to_exactly_five_planes_five_dims_one_extrusion() {
        var result = FamilyModelJson.Parse(Doc("""{"parameters":{"W":{"dataType":"Length","value":"2ft"}},"forms":{"body":""" + Box.Replace("\"width\":\"6in\"", "\"width\":\"param:W\"") + "}}"));
        Assert.That(result.Diagnostics, Is.Empty, string.Join("\n", result.Diagnostics.Select(d => d.Message)));
        var m = result.Value!;
        Assert.That(m.RefPlanes.Keys, Is.EquivalentTo(new[] { "body.left", "body.right", "body.front", "body.back", "body.top" }));
        Assert.That(m.RefPlanes["body.left"].At.Feet, Is.EqualTo(-1.0).Within(1e-9), "seed from the parameter's uniform value");
        Assert.That(m.RefPlanes["body.top"].Normal, Is.EqualTo(Axis.PlusZ));
        Assert.That(m.Dimensions.Keys, Is.EquivalentTo(new[] { "body.eq-lr", "body.eq-fb", "body.width", "body.depth", "body.height" }));
        Assert.That(m.Dimensions["body.eq-lr"].Between, Is.EqualTo(new[] { "body.left", "Center (Left/Right)", "body.right" }));
        Assert.That(m.Dimensions["body.eq-lr"].Equality, Is.True);
        Assert.That(m.Dimensions["body.width"].Label, Is.EqualTo("W"));
        Assert.That(m.Dimensions["body.depth"].Locked!.Value.Text, Is.EqualTo("1in"));
        Assert.That(m.Dimensions["body.height"].Between, Is.EqualTo(new[] { "Ref. Level", "body.top" }));
        Assert.That(m.Dimensions["body.height"].View, Is.EqualTo(StockView.Front));
        var form = m.Forms["body"];
        Assert.That(m.Forms.Count, Is.EqualTo(1));
        Assert.That(form.Kind, Is.EqualTo(FormKind.Extrusion));
        Assert.That((form.SketchPlane, form.Start, form.End), Is.EqualTo(("Ref. Level", "Ref. Level", "body.top")));
        Assert.That(form.Profile![0].Curves.Select(c => c.On), Is.EqualTo(new[] { "body.left", "body.back", "body.right", "body.front" }));
        var reapplied = FamilyPatch.Apply(FamilyModelJson.Serialize(m), "{\"forms\":{\"body\":" + Box.Replace("\"width\":\"6in\"", "\"width\":\"param:W\"") + "}}");
        Assert.That(reapplied.Diagnostics, Is.Empty);
        Assert.That(JToken.DeepEquals(JToken.Parse(FamilyModelJson.Serialize(m)), JToken.Parse(FamilyModelJson.Serialize(reapplied.Value!))), Is.True);
    }

    [Test]
    public void Cylinder_macro_expands_to_top_plane_height_dim_and_a_circle_extrusion() {
        var result = FamilyModelJson.Parse(Doc("""{"forms":{"drum":{"kind":"Cylinder","center":["Center (Left/Right)","Center (Front/Back)"],"bottom":"Ref. Level","diameter":"8in","height":"1' - 6\"","void":true}}}"""));
        Assert.That(result.Diagnostics, Is.Empty, string.Join("\n", result.Diagnostics.Select(d => d.Message)));
        var m = result.Value!;
        Assert.That(m.RefPlanes.Keys, Is.EquivalentTo(new[] { "drum.top" }));
        Assert.That(m.RefPlanes["drum.top"].At.Feet, Is.EqualTo(1.5).Within(1e-9));
        Assert.That(m.Dimensions.Keys, Is.EquivalentTo(new[] { "drum.height" }));
        var circle = m.Forms["drum"].Profile![0].Curves.Single();
        Assert.That(circle.Kind, Is.EqualTo(CurveKind.Circle));
        Assert.That(circle.Diameter!.Value.Text, Is.EqualTo("8in"));
        Assert.That(m.Forms["drum"].Void, Is.True, "extra form properties ride on the extrusion");
    }

    [Test]
    public void Macro_slot_from_another_kind_and_name_collision_are_refused() {
        Assert.That(FamilyModelJson.Parse(Doc("""{"forms":{"b":""" + Box.Replace("\"width\":\"6in\"", "\"width\":\"6in\",\"sketchPlane\":\"Ref. Level\"") + "}}")).Diagnostics.Select(d => d.Code), Does.Contain("slot-not-legal-for-kind"));
        Assert.That(FamilyModelJson.Parse(Doc("""{"refPlanes":{"b.top":{"normal":"PlusZ","at":"1in"}},"forms":{"b":""" + Box + "}}")).Diagnostics.Select(d => d.Code), Does.Contain("macro-name-collision"));
    }

    [TestCase("1/2in", 0.5 / 12)]
    [TestCase("-2.25ft", -2.25)]
    [TestCase("150mm", 150 / 304.8)]
    [TestCase("1' - 0 1/2\"", 1 + 0.5 / 12)]
    [TestCase("1'-6\"", 1.5)]
    [TestCase("2\"", 2 / 12.0)]
    [TestCase("3'", 3.0)]
    [TestCase("21.2\"", 21.2 / 12)]
    [TestCase("0' - 0 1/2\"", 0.5 / 12)]
    public void Length_grammar_accepts_suffixed_and_feet_inches(string text, double feet) {
        Assert.That(PortableScalar.TryParse(text, out var scalar), Is.True);
        Assert.That(scalar.Kind, Is.EqualTo(PortableScalarKind.Length));
        Assert.That(scalar.Feet, Is.EqualTo(feet).Within(1e-9));
    }

    [TestCase("6")]
    [TestCase("12 furlongs")]
    [TestCase("10 inches")]
    [TestCase("'")]
    public void Length_grammar_refuses(string text) => Assert.That(PortableScalar.TryParse(text, out _), Is.False);

    [TestCase("Length", DataType.Length)]
    [TestCase("Length (Common)", DataType.Length)]
    [TestCase("autodesk.spec.aec:length-2.0.1", DataType.Length)]
    [TestCase("Yes/No", DataType.YesNo)]
    [TestCase("autodesk.spec:spec.bool-1.0.0", DataType.YesNo)]
    [TestCase("Electrical Potential", DataType.ElectricalPotential)]
    [TestCase("autodesk.spec.aec.electrical:potential-2.0.0", DataType.ElectricalPotential)]
    [TestCase("Air Flow", DataType.AirFlow)]
    public void DataType_accepts_token_label_and_forge_id_and_emits_the_token(string input, DataType expected) {
        var result = FamilyModelJson.Parse(Doc("{\"parameters\":{\"p\":{\"dataType\":\"" + input + "\"}}}"));
        Assert.That(result.Value!.Parameters["p"].DataType, Is.EqualTo(expected));
        Assert.That(JObject.Parse(FamilyModelJson.Serialize(result.Value!))["parameters"]!["p"]!["dataType"]!.ToString(), Is.EqualTo(expected.ToString()));
    }

    [Test]
    public void Category_accepts_the_revit_label_and_placement_mirrors_FamilyPlacementType() {
        var result = FamilyModelJson.Parse("""{"family":{"name":"x","category":"Generic Models","template":"Generic Model","placement":"WorkPlaneBased"}}""");
        Assert.That(result.Diagnostics, Is.Empty);
        Assert.That(result.Value!.Family.Category, Is.EqualTo(FamilyCategory.GenericModels));
        Assert.That(result.Value.Family.Placement, Is.EqualTo(FamilyModelPlacement.WorkPlaneBased));
    }

    [TestCase("Unhosted", FamilyModelPlacement.OneLevelBased)]
    [TestCase("FaceHosted", FamilyModelPlacement.WorkPlaneBased)]
    [TestCase("WallHosted", FamilyModelPlacement.OneLevelBasedHosted)]
    public void Placement_accepts_author_facing_host_labels(string input, FamilyModelPlacement expected) {
        var result = FamilyModelJson.Parse("{\"family\":{\"name\":\"x\",\"category\":\"Generic Models\",\"template\":\"Generic Model\",\"placement\":\"" + input + "\"}}");
        Assert.That(result.Diagnostics, Is.Empty);
        Assert.That(result.Value!.Family.Placement, Is.EqualTo(expected));
    }

    [Test]
    public void Settings_closed_key_set_and_lookup_tables_parse_and_an_unknown_key_is_refused() {
        var ok = FamilyModelJson.Parse(Doc("""{"settings":{"alwaysVertical":false,"shared":true,"cutWithVoidsWhenLoaded":true,"partType":"MultiPort","omniClass":"23.80.20.11.14"},"lookupTables":{"FF Sizes":{"csv":",Width##length##feet\nSmall,1\nLarge,2\n"}},"roomCalculationPoint":{"enabled":true,"offset":"2ft"}}"""));
        Assert.That(ok.Diagnostics, Is.Empty, string.Join("\n", ok.Diagnostics.Select(d => d.Message)));
        Assert.That(ok.Value!.Settings!.PartType, Is.EqualTo(FamilyPartType.MultiPort));
        Assert.That(FamilyModelJson.Parse(Doc("""{"settings":{"alwaysUpright":true}}""")).Diagnostics.Select(d => d.Code), Does.Contain("invalid-json"));
    }

    [Test]
    public void Formula_names_strip_string_literals_and_built_ins() {
        var names = FamilyModelValidator.FormulaNames("if(_vane spacing = 0mm, 0, roundup((Open Width / 2) / _vane spacing)) + size_lookup(\"tbl\", \"2024-01-01\", 1)").ToList();
        Assert.That(names, Is.EqualTo(new[] { "_vane spacing", "Open Width", "_vane spacing" }));
    }

    [Test]
    public void Connector_rule_creates_only_when_the_patch_asks_for_it() {
        var silent = FamilyPatch.Parse("""{"patch":{},"run":{"electricalConnectorParameters":{"voltage":"V","numberOfPoles":"P","apparentPower":"A","minimumCircuitAmpacity":"M"}}}""");
        var explicitly = FamilyPatch.Parse("""{"patch":{},"run":{"electricalConnectorParameters":{"voltage":"V","numberOfPoles":"P","apparentPower":"A","minimumCircuitAmpacity":"M","createIfAbsent":true}}}""");
        Assert.Multiple(() => {
            Assert.That(silent.Run!.ElectricalConnectorParameters!.CreateIfAbsent, Is.False);
            Assert.That(explicitly.Run!.ElectricalConnectorParameters!.CreateIfAbsent, Is.True);
        });
    }

    [Test]
    public void Patch_schema_derivation_makes_every_property_nullable_and_drops_required() {
        var model = JObject.Parse("""{"type":"object","required":["family"],"properties":{"family":{"type":"object","required":["name"],"properties":{"name":{"type":"string"}}},"types":{"type":"object","additionalProperties":{"type":"object","required":["x"]}}}}""");
        var patch = FamilyPatchSchema.Derive(model);
        Assert.That(patch["required"], Is.Null);
        Assert.That(patch["properties"]!["family"]!["anyOf"]![0]!["type"]!.ToString(), Is.EqualTo("null"));
        Assert.That(patch["properties"]!["family"]!["anyOf"]![1]!["required"], Is.Null);
        Assert.That(patch["properties"]!["types"]!["anyOf"]![1]!["additionalProperties"]!["anyOf"]![1]!["required"], Is.Null);
    }
}
