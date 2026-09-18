using Newtonsoft.Json.Linq;
using Pe.Revit.Scripting.Bootstrap;
using Pe.Revit.Scripting.Context;
using Pe.Revit.Scripting.Pods;
using Pe.Revit.Scripting.References;
using Pe.Shared.HostContracts.Scripting;
using Pe.Shared.Scripting.Pods;
using System.IO.Compression;
using System.Text;

namespace Pe.Revit.Tests;

[TestFixture]
public sealed class PodTests {
    private string _root = null!;
    private string _pods = null!;
    private ScriptPodPreparationService _service = null!;

    [SetUp]
    public void SetUp() {
        this._root = Path.Combine(Path.GetTempPath(), "pod-tests", Guid.NewGuid().ToString("N"));
        this._pods = Path.Combine(this._root, "Pods");
        Directory.CreateDirectory(this._pods);
        this._service = new ScriptPodPreparationService(this._pods);
    }

    [TearDown]
    public void TearDown() => Directory.Delete(this._root, true);

    [TestCase("requires", "[]")]
    [TestCase("parent", "{}")]
    [TestCase("origin", "{}")]
    [TestCase("externalRequirements", "[]")]
    public void Manifest_rejects_removed_fields_as_unknown(string field, string value) {
        var result = PodManifestValidator.ValidateJson($$"""{"schemaVersion":2,"id":"a","name":"A","version":"1","{{field}}":{{value}}}""");
        Assert.That(result.Success, Is.False);
        Assert.That(result.Diagnostics.Select(diagnostic => diagnostic.Message), Has.Some.Contains($"Unknown field '{field}'"));
    }

    [Test]
    public void Preparation_lists_every_member_and_one_malformed_member_hides_nothing() {
        var folder = this.WritePod("Office", "office", new() {
            ["settings/good.json"] = """{"$schema":"https://pe.tools/schemas/family.json","a":1}""",
            ["settings/broken.json"] = "{ not json",
            ["settings/plain.json"] = "{\"b\":2}",
            ["output/run/receipt.json"] = "{}"
        });

        var pod = ScriptPodPreparationService.Prepare(folder);

        Assert.Multiple(() => {
            Assert.That(pod, Is.TypeOf<PreparedPod>(), string.Join("; ", pod.Diagnostics.Select(d => d.Message)));
            Assert.That(pod.Members.Select(member => member.Path),
                Is.EqualTo(new[] { "pod.json", "settings/broken.json", "settings/good.json", "settings/plain.json" }));
            Assert.That(pod.Members.Single(member => member.Path == "settings/good.json").Schema, Is.EqualTo("https://pe.tools/schemas/family.json"));
            Assert.That(pod.Members.Single(member => member.Path == "settings/plain.json").Schema, Is.Null);
            Assert.That(pod.Members.Single(member => member.Path == "settings/plain.json").Sha256,
                Is.EqualTo(ScriptPodPreparationService.Sha256(Encoding.UTF8.GetBytes("{\"b\":2}"))));
            Assert.That(this._service.List().Single().Members, Has.Count.EqualTo(4));
        });
    }

    [Test]
    public void Preparation_gates_entrypoint_source() {
        var folder = this.WritePod("scripts", "scripts",
            new() { ["src/Two.cs"] = "public sealed class A : PeScriptContainer {} public sealed class B : PeScriptContainer {}" },
            ""","entrypoints":[{"id":"missing","sourcePath":"src/Missing.cs"},{"id":"two","sourcePath":"src/Two.cs"}]""");

        var pod = ScriptPodPreparationService.Prepare(folder);

        Assert.That(pod, Is.TypeOf<RefusedPod>());
        Assert.That(pod.Diagnostics.Select(diagnostic => diagnostic.Source), Is.SupersetOf(new[] { "src/Missing.cs", "src/Two.cs" }));
    }

    [Test]
    public void Compose_resolves_foreign_ids_after_a_folder_rename_and_scopes_their_local_references() {
        this.WritePod("Global", "global", new() {
            ["settings/_fields/Header.json"] = "{\"$include\":\"@local/_fields/Title\"}",
            ["settings/_fields/Title.json"] = "{\"title\":\"from-global\"}"
        });
        Directory.Move(Path.Combine(this._pods, "Global"), Path.Combine(this._pods, "Renamed In Explorer"));
        this.WritePod("Office", "office", new() {
            ["settings/family.json"] = "{\"$preset\":\"@global/_fields/Header\",\"local\":{\"$include\":\"@local/part\"}}",
            ["settings/part.json"] = "[1]"
        });

        var saved = this._service.Compose("office", "settings/family.json", null);
        var draft = this._service.Compose("office", "settings/family.json", "{\"$include\":\"@local/part\"}");

        Assert.Multiple(() => {
            Assert.That(saved.Diagnostics, Is.Empty);
            Assert.That(JObject.Parse(saved.Composed!)["title"]!.Value<string>(), Is.EqualTo("from-global"));
            Assert.That(saved.Dependencies.Select(d => (d.PodId, d.Path)), Is.EquivalentTo(new[] {
                ("global", "settings/_fields/Header.json"), ("global", "settings/_fields/Title.json"), ("office", "settings/part.json")
            }));
            Assert.That(draft.Diagnostics, Is.Empty);
            Assert.That(draft.Composed, Does.Contain("1"));
        });
    }

    [Test]
    public void Compose_retains_exact_source_and_consumed_dependency_bytes_on_failure() {
        this.WritePod("Office", "office", new() {
            ["settings/family.json"] = "{\"items\":[{\"$include\":\"@local/part\"},{\"$include\":\"@local/missing\"}]}",
            ["settings/part.json"] = "placeholder"
        });
        var bytes = new byte[] { (byte)'[', (byte)'\"', 0xff, (byte)'\"', (byte)']' };
        File.WriteAllBytes(Path.Combine(this._pods, "Office", "settings", "part.json"), bytes);

        var result = this._service.Compose("office", "settings/family.json", null);

        Assert.Multiple(() => {
            Assert.That(result.Composed, Is.Null);
            Assert.That(result.Source.Id, Is.EqualTo("office"));
            Assert.That(result.Dependencies, Has.Count.EqualTo(1));
            Assert.That(result.Dependencies[0].Bytes, Is.EqualTo(bytes));
            Assert.That(result.Dependencies[0].Sha256, Is.EqualTo(ScriptPodPreparationService.Sha256(bytes)));
        });
    }

    [Test]
    public void Compose_captures_saved_or_draft_root_and_ordered_nested_dependencies_once() {
        var global = this.WritePod("Global", "global", new() {
            ["settings/Header.json"] = "placeholder",
            ["settings/Title.json"] = "placeholder"
        });
        var office = this.WritePod("Office", "office", new() { ["settings/family.json"] = "placeholder" });
        var rootBytes = WithBom("{\r\n  \"$preset\": \"@global/Header\", \"note\": \"café\"  \r\n}");
        var headerBytes = Encoding.UTF8.GetBytes("{ \"$include\": \"@local/Title\" }  \n");
        var titleBytes = WithBom("{ \"title\": \"Δ\" }\r\n");
        File.WriteAllBytes(Path.Combine(office, "settings", "family.json"), rootBytes);
        File.WriteAllBytes(Path.Combine(global, "settings", "Header.json"), headerBytes);
        File.WriteAllBytes(Path.Combine(global, "settings", "Title.json"), titleBytes);

        var saved = this._service.Compose("office", "settings/family.json", null);
        var reviewedBytes = WithBom("{ \"$include\": \"@global/Header\" }");
        var reviewedContent = Encoding.UTF8.GetString(reviewedBytes);
        var supplied = ScriptPodPreparationService.CaptureComposeSource(new PodMemberComposeRequest(
            "office",
            "settings/family.json",
            reviewedContent,
            new PodCapturedSourceData(
                "office",
                "settings/family.json",
                ScriptPodPreparationService.Sha256(reviewedBytes),
                Convert.ToBase64String(reviewedBytes),
                PodSourceOrigin.SuppliedDraft)));
        var bridged = this._service.Compose("office", "settings/family.json", reviewedContent, supplied);
        File.WriteAllText(Path.Combine(global, "settings", "Title.json"), "{}");
        const string draftText = "{ \"draft\": \"yes\" }";
        var draft = this._service.Compose("office", "settings/family.json", draftText);

        Assert.Multiple(() => {
            Assert.That(saved.Diagnostics, Is.Empty);
            Assert.That(saved.Source.Id, Is.EqualTo("office"));
            Assert.That(saved.Source.Origin, Is.EqualTo(PodSourceOrigin.SavedMember));
            Assert.That(saved.Source.Bytes, Is.EqualTo(rootBytes));
            Assert.That(saved.Source.Sha256, Is.EqualTo(ScriptPodPreparationService.Sha256(rootBytes)));
            Assert.That(saved.Dependencies.Select(dependency => dependency.Path),
                Is.EqualTo(new[] { "settings/Header.json", "settings/Title.json" }));
            Assert.That(saved.Dependencies[0].Bytes, Is.EqualTo(headerBytes));
            Assert.That(saved.Dependencies[1].Bytes, Is.EqualTo(titleBytes));
            Assert.That(bridged.Diagnostics, Is.Empty);
            Assert.That(bridged.Source.Id, Is.EqualTo("office"));
            Assert.That(bridged.Source.Origin, Is.EqualTo(PodSourceOrigin.SuppliedDraft));
            Assert.That(bridged.Source.Bytes, Is.EqualTo(reviewedBytes));
            Assert.That(bridged.Dependencies[1].Bytes, Is.EqualTo(titleBytes));
            Assert.That(draft.Source.Id, Is.EqualTo("office"));
            Assert.That(draft.Source.Origin, Is.EqualTo(PodSourceOrigin.SuppliedDraft));
            Assert.That(draft.Source.Bytes, Is.EqualTo(Encoding.UTF8.GetBytes(draftText)));
            Assert.That(draft.Source.Bytes, Is.Not.EqualTo(rootBytes));
        });
    }

    private static byte[] WithBom(string content) => new UTF8Encoding(true).GetPreamble()
        .Concat(Encoding.UTF8.GetBytes(content)).ToArray();

    [Test]
    public void Duplicate_ids_fail_and_name_both_folders() {
        this.WritePod("One", "global");
        this.WritePod("Two", "global");
        this.WritePod("Office", "office", new() { ["settings/family.json"] = "{\"$include\":\"@global/x\"}" });

        var result = this._service.Compose("office", "settings/family.json", null);

        Assert.That(result.Composed, Is.Null);
        Assert.That(result.Diagnostics.Single().Message,
            Does.Contain(Path.Combine(this._pods, "One")).And.Contain(Path.Combine(this._pods, "Two")));
    }

    [Test]
    public void Member_write_creates_and_refuses_an_existing_path() {
        this.WritePod("Office", "office");

        var sha = this._service.WriteMember("office", "settings/captured.json", "{}");

        var saved = this._service.Compose("office", "settings/captured.json", null).Source;
        Assert.That((saved.Content, saved.Sha256, saved.Origin), Is.EqualTo(("{}", sha, PodSourceOrigin.SavedMember)));
        Assert.Throws<IOException>(() => this._service.WriteMember("office", "settings/captured.json", "{\"x\":1}"));
        Assert.Throws<InvalidDataException>(() => this._service.WriteMember("office", "output/x.json", "{}"));
        Assert.Throws<InvalidDataException>(() => this._service.WriteMember("office", "settings/../pod.json", "{}"));
    }

    [Test]
    public void Export_vendors_foreign_fragments_and_import_composes_without_the_foreign_pod() {
        const string header = "{\n  \"title\": \"header\"\n}";
        this.WritePod("Global", "global", new() { ["settings/_fields/Header.json"] = header });
        this.WritePod("Office", "office", new() {
            ["settings/family.json"] = "{\"$preset\":\"@global/_fields/Header\",\"x\":1}",
            ["settings/leaf.json"] = "{ \"untouched\": true }"
        });
        File.WriteAllText(Path.Combine(this._pods, "Office", ScriptPodPreparationService.ImportedFileName), "{}");
        var archivePath = Path.Combine(this._root, "office.zip");

        var exported = Archive(this._service).Export(new PodExportRequest("office", archivePath), "net8.0-windows");
        var consumerPods = Path.Combine(this._root, "Other Machine");
        Directory.CreateDirectory(consumerPods);
        var consumer = new ScriptPodPreparationService(consumerPods);
        var imported = Archive(consumer).Import(new PodImportRequest(archivePath), "2025", "net8.0-windows", typeof(PeScriptContainer).Assembly.Location);
        var composed = consumer.Compose("office", "settings/family.json", null);

        Assert.Multiple(() => {
            Assert.That(exported.Vendored.Select(d => (d.Id, d.Path)), Is.EqualTo(new[] { ("global", "settings/_fields/Header.json") }));
            Assert.That(imported, Is.EqualTo(new PodImportData("office", Path.Combine(consumerPods, "office"))));
            Assert.That(File.ReadAllText(Path.Combine(imported.Folder, "settings", "_vendor", "global", "_fields", "Header.json")), Is.EqualTo(header));
            Assert.That(File.ReadAllText(Path.Combine(imported.Folder, "settings", "family.json")), Does.Contain("@local/_vendor/global/_fields/Header.json"));
            Assert.That(File.ReadAllText(Path.Combine(imported.Folder, "settings", "leaf.json")), Is.EqualTo("{ \"untouched\": true }"));
            Assert.That(composed.Diagnostics, Is.Empty);
            Assert.That(JObject.Parse(composed.Composed!)["title"]!.Value<string>(), Is.EqualTo("header"));
            Assert.That(composed.Dependencies.Single().PodId, Is.EqualTo("office"));
            var provenance = JObject.Parse(File.ReadAllText(Path.Combine(imported.Folder, ScriptPodPreparationService.ImportedFileName)));
            Assert.That(provenance["locator"]!.Value<string>(), Is.EqualTo(archivePath));
            Assert.That(provenance["archiveSha256"]!.Value<string>(), Has.Length.EqualTo(64));
        });
        using (var archive = ZipFile.OpenRead(archivePath))
            Assert.That(archive.Entries.Select(entry => entry.FullName), Has.None.EqualTo(ScriptPodPreparationService.ImportedFileName));
        Assert.Throws<InvalidDataException>(() => Archive(consumer).Import(
            new PodImportRequest(archivePath), "2025", "net8.0-windows", typeof(PeScriptContainer).Assembly.Location));
    }

    [Test]
    public void Run_input_keeps_the_exact_composed_root_and_ordered_dependency_bytes() {
        var global = this.WritePod("Global", "global", new() { ["settings/Header.json"] = "placeholder" });
        var office = this.WritePod("Office", "office", new() { ["settings/family.json"] = "placeholder" });
        var rootBytes = WithBom("{\r\n  \"$preset\": \"@global/Header\", \"note\": \"café\"  \r\n}");
        var headerBytes = Encoding.UTF8.GetBytes("{ \"title\": \"Δ\" }  \n");
        File.WriteAllBytes(Path.Combine(office, "settings", "family.json"), rootBytes);
        File.WriteAllBytes(Path.Combine(global, "settings", "Header.json"), headerBytes);
        var composition = this._service.Compose("office", "settings/family.json", null);
        var source = composition.ToSource();
        // A later disk edit changes nothing the run keeps: it never rereads.
        File.WriteAllText(Path.Combine(office, "settings", "family.json"), "{}");
        File.WriteAllText(Path.Combine(global, "settings", "Header.json"), "{}");

        var run = PodRuns.NewRunFolder(office);
        var written = PodRuns.WriteInputIn(run, new { operation = "test" }, PodRuns.ComposedInput(source, composition.Composed!));
        var input = JObject.Parse(File.ReadAllText(Path.Combine(run, "input.json")));

        Assert.Multiple(() => {
            Assert.That(written, Is.EqualTo(new[] { "input.json", "effective-input.json", "source/00-family.json", "source/01-Header.json" }));
            Assert.That(File.ReadAllBytes(Path.Combine(run, "effective-input.json")), Is.EqualTo(Encoding.UTF8.GetBytes(composition.Composed!)));
            Assert.That(File.ReadAllBytes(Path.Combine(run, "source", "00-family.json")), Is.EqualTo(rootBytes));
            Assert.That(File.ReadAllBytes(Path.Combine(run, "source", "01-Header.json")), Is.EqualTo(headerBytes));
            Assert.That(input["files"]!.Select(file => (string)file["role"]!), Is.EqualTo(new[] { "effective", "saved-member", "dependency" }));
            Assert.That(input["files"]![1]!["pod"]!.Value<string>(), Is.EqualTo("office"));
            Assert.That(input["files"]![1]!["sha256"]!.Value<string>(), Is.EqualTo(ScriptPodPreparationService.Sha256(rootBytes)));
            Assert.That(input["files"]![2]!["pod"]!.Value<string>(), Is.EqualTo("global"));
            Assert.That(input["files"]![2]!["address"]!.Value<string>(), Is.EqualTo("settings/Header.json"));
        });
    }

    [Test]
    public void Run_input_refuses_bytes_that_disagree_with_their_hash_and_leaves_no_partial_input() {
        var office = this.WritePod("Office", "office", new() { ["settings/family.json"] = "{\"a\":1}" });
        var source = this._service.Compose("office", "settings/family.json", null).ToSource();
        var forged = source with { Root = source.Root with { BytesBase64 = Convert.ToBase64String(Encoding.UTF8.GetBytes("{\"a\":2}")) } };
        Assert.Throws<InvalidDataException>(() => PodRuns.ComposedInput(forged, "{}"));

        var run = PodRuns.NewRunFolder(office);
        Directory.CreateDirectory(Path.Combine(run, "source", "00-family.json"));
        Assert.Throws<UnauthorizedAccessException>(() => PodRuns.WriteInputIn(run, new { operation = "test" }, PodRuns.ComposedInput(source, "{}")));
        Assert.That(Directory.EnumerateFiles(run, "*", SearchOption.AllDirectories), Is.Empty);
    }

    [Test]
    public void Receipt_that_cannot_be_saved_after_an_effect_returns_its_reason_instead_of_throwing() {
        var office = this.WritePod("Office", "office");
        var run = PodRuns.NewRunFolder(office);
        Directory.CreateDirectory(Path.Combine(run, "receipt.json"));

        var (path, unsaved) = PodRuns.SettleReceiptIn(run, new PodReceipt("office", "settings/a.json", "sha", "schedule.apply", null, "Succeeded", [], null), []);

        Assert.That(path, Is.Null);
        Assert.That(unsaved, Does.Contain("native outcome stands"));
    }

    [Test]
    public void Output_read_that_fails_after_the_effect_leaves_the_outcome_standing() {
        var office = this.WritePod("Office", "office");
        var run = PodRuns.NewRunFolder(office);
        // The family apply edge passes its artifact reads lazily; the first one fails here, after the effect.
        IEnumerable<(string, byte[])> Outputs() {
            yield return ("apply.json", [1]);
            throw new FileNotFoundException("artifact vanished");
        }

        var (path, unsaved) = PodRuns.SettleReceiptIn(run, new PodReceipt("office", "settings/a.json", "sha", "family.apply", null, "Succeeded", [], null), Outputs());

        Assert.That(path, Is.Null);
        Assert.That(unsaved, Does.Contain("artifact vanished"));
    }

    [Test]
    public void Output_named_like_the_receipt_is_refused_in_any_case() {
        var office = this.WritePod("Office", "office");
        var run = PodRuns.NewRunFolder(office);
        foreach (var name in new[] { "receipt.json", "Receipt.json", "RECEIPT.JSON" })
            Assert.Throws<ArgumentException>(() => PodRuns.WriteReceiptIn(run,
                new PodReceipt("office", "settings/a.json", "sha", "family.apply", null, "Succeeded", [], null), [(name, [1])]), name);
    }

    [Test]
    public void Run_receipt_lands_in_the_pod_output_with_its_outputs() {
        var folder = this.WritePod("Office", "office");

        var path = PodRuns.WriteReceipt(folder,
            new PodReceipt("office", "settings/a.json", "sha", "schedule.apply", null, "Succeeded", ["schedule:123"], null),
            [("result.csv", Encoding.UTF8.GetBytes("a,b"))]);

        var receipt = JObject.Parse(File.ReadAllText(path));
        Assert.Multiple(() => {
            Assert.That(Path.GetFileName(path), Is.EqualTo("receipt.json"));
            Assert.That(Path.GetDirectoryName(Path.GetDirectoryName(path)), Is.EqualTo(Path.Combine(folder, "output")));
            Assert.That(File.ReadAllText(Path.Combine(Path.GetDirectoryName(path)!, "result.csv")), Is.EqualTo("a,b"));
            Assert.That(receipt["memberSha256"]!.Value<string>(), Is.EqualTo("sha"));
            Assert.That(receipt["outputs"]!.Values<string>(), Is.EqualTo(new[] { "schedule:123", "result.csv" }));
        });
    }

    [Test]
    public void Receipt_reason_is_null_on_success_and_the_failure_text_on_failure() {
        var folder = this.WritePod("Office", "office");
        // `scripting.execute` joins zero error diagnostics into "" (w6-revit claim 6); the receipt still says null.
        var succeeded = new PodReceipt("office", "src/Run.cs", "sha", "scripting.execute", null, "Pending", [], null) with { Outcome = "Succeeded", Reason = string.Join("; ", Array.Empty<string>()) };
        var failed = new PodReceipt("office", "settings/a.json", "sha", "schedule.apply", null, "Failed", [], "Apply Schedule 'A' did not commit.");
        var saved = (PodReceipt r) => JObject.Parse(File.ReadAllText(PodRuns.WriteReceipt(folder, r, [])))["reason"]!;
        Assert.Multiple(() => {
            Assert.That(saved(succeeded).Type, Is.EqualTo(JTokenType.Null));
            Assert.That(saved(new PodReceipt("office", "settings/a.json", "sha", "schedule.apply", null, "Succeeded", [], "")).Type, Is.EqualTo(JTokenType.Null));
            Assert.That(saved(failed).Value<string>(), Is.EqualTo("Apply Schedule 'A' did not commit."));
        });
    }

    // An `_fields` fragment is `{ "$schema"?, "Items": [...] }`; in array position its items splice in order.
    [Test]
    public void Array_include_of_an_Items_fragment_splices_its_items_in_order() {
        this.WritePod("Office", "office", new() {
            ["settings/member.json"] = """{"Fields":[{"A":1},{"$include":"@local/_fields/X"},{"B":2}]}""",
            ["settings/_fields/X.json"] = """{"$schema":"../schemas/fragment.json","Items":[{"X":1},{"Y":2}]}"""
        });

        var composed = this._service.Compose("office", "settings/member.json", null);

        Assert.That(composed.Diagnostics, Is.Empty);
        Assert.That(JObject.Parse(composed.Composed!)["Fields"]!.ToString(Newtonsoft.Json.Formatting.None),
            Is.EqualTo("""[{"A":1},{"X":1},{"Y":2},{"B":2}]"""));
    }

    [Test]
    public void A_nested_Items_fragment_splices_inside_the_fragment_that_includes_it() {
        this.WritePod("Office", "office", new() {
            ["settings/member.json"] = """{"Fields":[{"A":1},{"$include":"@local/_fields/X"},{"B":2}]}""",
            ["settings/_fields/X.json"] = """{"Items":[{"X":1},{"$include":"@local/_fields/Y"}]}""",
            ["settings/_fields/Y.json"] = """{"Items":[{"Y":1},{"Y":2}]}"""
        });

        var composed = this._service.Compose("office", "settings/member.json", null);

        Assert.That(composed.Diagnostics, Is.Empty);
        Assert.That(JObject.Parse(composed.Composed!)["Fields"]!.ToString(Newtonsoft.Json.Formatting.None),
            Is.EqualTo("""[{"A":1},{"X":1},{"Y":1},{"Y":2},{"B":2}]"""));
        Assert.That(composed.Dependencies.Select(d => d.Path), Is.EqualTo(new[] { "settings/_fields/X.json", "settings/_fields/Y.json" }));
    }

    [Test]
    public void Array_include_of_any_other_shape_is_a_named_include_error() {
        this.WritePod("Office", "office", new() {
            ["settings/member.json"] = """{"Fields":[{"$include":"@local/_fields/X"}]}""",
            ["settings/_fields/X.json"] = """{"Name":"not a fragment"}"""
        });

        var composed = this._service.Compose("office", "settings/member.json", null);

        Assert.That(composed.Composed, Is.Null);
        var error = composed.Diagnostics.Single();
        Assert.That(error.Stage, Is.EqualTo("pod.settings.include"));
        Assert.That(error.Message, Does.Contain("@local/_fields/X").And.Contain("Name"));
    }

    // The proof-3a shape: a schedule profile whose Fields include `_fields` fragments.
    [Test]
    public void A_MechEquip_shaped_profile_composes_to_field_specs_not_an_Items_wrapper() {
        this.WritePod("Standards", "pe-standards", new() {
            ["settings/schedules/MechEquip.json"] = """
                {"Name":"Mechanical Equipment","CategoryName":"Mechanical Equipment",
                 "Fields":[{"$include":"@local/schedules/_fields/Header"},{"ParameterName":"Comments"}]}
                """,
            ["settings/schedules/_fields/Header.json"] = """
                {"$schema":"../../schemas/fields.json","Items":[{"Parameter":{"Name":"Mark"}},{"Parameter":{"Name":"Type Mark"}}]}
                """
        });

        var composed = this._service.Compose("pe-standards", "settings/schedules/MechEquip.json", null);
        var profile = JObject.Parse(composed.Composed!).ToObject<Pe.Shared.RevitData.Schedules.ScheduleProfile>()!;

        Assert.That(composed.Diagnostics, Is.Empty);
        Assert.That(JObject.Parse(composed.Composed!)["Fields"]!.Children<JObject>().Select(field => field.ContainsKey("Items")), Has.None.True);
        Assert.That(profile.Fields.Select(field => field.Parameter.Name).Take(2), Is.EqualTo(new[] { "Mark", "Type Mark" }));
        Assert.That(profile.Fields, Has.Count.EqualTo(3));
    }

    [Test]
    public void Composer_rejects_malformed_directives() {
        foreach (var malformed in new[] { "{\"$preset\":null}", "{\"$preset\":3}", "{\"$include\":[]}", "{\"$include\":\"@local/a\",\"b\":1}" }) {
            var rejected = PodComposer.Compose("settings/main.json", malformed, AlwaysResolve);
            Assert.That(rejected.Content, Is.Null, malformed);
            Assert.That(rejected.Diagnostics, Is.Not.Empty, malformed);
        }

        static bool AlwaysResolve(string reference, out PodConsumedDependency dependency, out string reason) {
            dependency = new PodConsumedDependency("local", "settings/a.json", string.Empty, Encoding.UTF8.GetBytes("{}"), "{}");
            reason = string.Empty;
            return true;
        }
    }

    [Test]
    public void Capture_enforces_the_file_count_bound() {
        var folder = this.WritePod("Bounded", "bounded");
        Directory.CreateDirectory(Path.Combine(folder, "assets"));
        for (var index = 0; index < 200; index++)
            File.WriteAllText(Path.Combine(folder, "assets", $"{index:D3}.txt"), string.Empty);

        Assert.That(ScriptPodPreparationService.Prepare(folder), Is.TypeOf<RefusedPod>());
    }

    private static ScriptPodArchiveService Archive(ScriptPodPreparationService pods) {
        var generator = new ScriptProjectGenerator(new CsProjReader());
        var bootstrap = new ScriptWorkspaceBootstrapService(generator, key => Path.Combine(pods.PodsRoot, key), Path.Combine(pods.PodsRoot, "..", "product"));
        return new ScriptPodArchiveService(bootstrap, generator, pods);
    }

    private string WritePod(string folderName, string id, Dictionary<string, string>? files = null, string extraManifest = "") {
        var folder = Path.Combine(this._pods, folderName);
        Directory.CreateDirectory(folder);
        File.WriteAllText(Path.Combine(folder, "pod.json"), $$"""{"schemaVersion":2,"id":"{{id}}","name":"{{id}}","version":"1"{{extraManifest}}}""");
        foreach (var file in files ?? []) {
            var path = Path.Combine(folder, file.Key.Replace('/', Path.DirectorySeparatorChar));
            Directory.CreateDirectory(Path.GetDirectoryName(path)!);
            File.WriteAllText(path, file.Value);
        }
        return folder;
    }
}
