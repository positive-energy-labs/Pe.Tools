using Newtonsoft.Json.Linq;
using Pe.Revit.Scripting.Bootstrap;
using Pe.Revit.Scripting.Context;
using Pe.Revit.Scripting.Pods;
using Pe.Revit.Scripting.References;
using Pe.Shared.HostContracts.Scripting;
using Pe.Shared.Scripting.Pods;
using Pe.Shared.Scripting.Execution;
using System.Text;

namespace Pe.Revit.Tests;

[TestFixture]
public sealed class PodTests {
    private string _root = null!;
    private string _pods = null!;
    private ScriptPodPreparationService _service = null!;
    private readonly Dictionary<string, string> _folders = new();

    [SetUp]
    public void SetUp() {
        this._root = Path.Combine(Path.GetTempPath(), "pod-tests", Guid.NewGuid().ToString("N"));
        this._pods = Path.Combine(this._root, "Pods");
        Directory.CreateDirectory(this._pods);
        this._folders.Clear();
        this._service = new ScriptPodPreparationService(this.Admission);
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

        var pod = ScriptPodPreparationService.Prepare(folder, Bundle(folder));

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
    public void Preparation_reads_a_utf8_bom_manifest_like_the_plain_one_and_keeps_its_exact_bytes() {
        var json = Encoding.UTF8.GetBytes("""{"schemaVersion":2,"id":"bom","name":"Bom","version":"1","entrypoints":[{"sourcePath":"src/Run.cs"}]}""");
        var bom = new byte[] { 0xEF, 0xBB, 0xBF };
        byte[] Join(params byte[][] parts) => parts.SelectMany(part => part).ToArray();
        PodPreparation PrepareRaw(string name, byte[] manifest) {
            var folder = Path.Combine(this._pods, name);
            Directory.CreateDirectory(Path.Combine(folder, "src"));
            File.WriteAllBytes(Path.Combine(folder, "pod.json"), manifest);
            File.WriteAllText(Path.Combine(folder, "src", "Run.cs"), "public sealed class Run : PeScriptContainer { public override void Execute() {} }");
            return ScriptPodPreparationService.Prepare(folder, Bundle(folder));
        }

        var plain = PrepareRaw("plain", json);
        var withBom = PrepareRaw("with-bom", Join(bom, json));

        Assert.Multiple(() => {
            Assert.That(withBom, Is.TypeOf<PreparedPod>(), string.Join("; ", withBom.Diagnostics.Select(d => d.Message)));
            Assert.That(((PreparedPod)withBom).Manifest.Id, Is.EqualTo(((PreparedPod)plain).Manifest.Id));
            Assert.That(((PreparedPod)withBom).Manifest.Entrypoints, Is.EqualTo(((PreparedPod)plain).Manifest.Entrypoints));
            Assert.That(withBom.Diagnostics.Select(d => d.Message), Is.EqualTo(plain.Diagnostics.Select(d => d.Message)));
            // The member identity is the exact on-disk bytes, BOM included; nothing is rewritten.
            Assert.That(withBom.Members.Single(member => member.Path == "pod.json").Sha256,
                Is.EqualTo(ScriptPodPreparationService.Sha256(Join(bom, json))));
            // Only one standard UTF-8 BOM is framing; everything else stays a JSON or encoding error.
            Assert.That(PrepareRaw("bom-malformed", Join(bom, "{ not json"u8.ToArray())), Is.TypeOf<RefusedPod>());
            Assert.That(PrepareRaw("double-bom", Join(bom, bom, json)), Is.TypeOf<RefusedPod>());
            var invalid = PrepareRaw("bad-utf8", Join("{\"schemaVersion\":2,\"id\":\"x\",\"name\":\""u8.ToArray(), [0xFF], "\",\"version\":\"1\"}"u8.ToArray()));
            Assert.That(invalid, Is.TypeOf<RefusedPod>());
            Assert.That(invalid.Diagnostics.Select(d => d.Message), Has.Some.Contains("not valid UTF-8"));
        });
    }

    [Test]
    public void Preparation_gates_entrypoint_source() {
        var folder = this.WritePod("scripts", "scripts",
            new() { ["src/Two.cs"] = "public sealed class A : PeScriptContainer {} public sealed class B : PeScriptContainer {}" },
            ""","entrypoints":[{"sourcePath":"src/Missing.cs"},{"sourcePath":"src/Two.cs"}]""");

        var pod = ScriptPodPreparationService.Prepare(folder, Bundle(folder));

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
        this._folders["Global"] = Path.Combine(this._pods, "Renamed In Explorer");
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
                PodRunOrigin.SuppliedDraft)));
        var bridged = this._service.Compose("office", "settings/family.json", reviewedContent, supplied);
        File.WriteAllText(Path.Combine(global, "settings", "Title.json"), "{}");
        const string draftText = "{ \"draft\": \"yes\" }";
        var draft = this._service.Compose("office", "settings/family.json", draftText);

        Assert.Multiple(() => {
            Assert.That(saved.Diagnostics, Is.Empty);
            Assert.That(saved.Source.Id, Is.EqualTo("office"));
            Assert.That(saved.Source.Origin, Is.EqualTo(PodRunOrigin.SavedMember));
            Assert.That(saved.Source.Bytes, Is.EqualTo(rootBytes));
            Assert.That(saved.Source.Sha256, Is.EqualTo(ScriptPodPreparationService.Sha256(rootBytes)));
            Assert.That(saved.Dependencies.Select(dependency => dependency.Path),
                Is.EqualTo(new[] { "settings/Header.json", "settings/Title.json" }));
            Assert.That(saved.Dependencies[0].Bytes, Is.EqualTo(headerBytes));
            Assert.That(saved.Dependencies[1].Bytes, Is.EqualTo(titleBytes));
            Assert.That(bridged.Diagnostics, Is.Empty);
            Assert.That(bridged.Source.Id, Is.EqualTo("office"));
            Assert.That(bridged.Source.Origin, Is.EqualTo(PodRunOrigin.SuppliedDraft));
            Assert.That(bridged.Source.Bytes, Is.EqualTo(reviewedBytes));
            Assert.That(bridged.Dependencies[1].Bytes, Is.EqualTo(titleBytes));
            Assert.That(draft.Source.Id, Is.EqualTo("office"));
            Assert.That(draft.Source.Origin, Is.EqualTo(PodRunOrigin.SuppliedDraft));
            Assert.That(draft.Source.Bytes, Is.EqualTo(Encoding.UTF8.GetBytes(draftText)));
            Assert.That(draft.Source.Bytes, Is.Not.EqualTo(rootBytes));
        });
    }

    [Test]
    public void Podless_draft_composes_explicit_pod_dependencies_and_refuses_local_references() {
        this.WritePod("Global", "global", new() { ["settings/Header.json"] = "{ \"title\": \"global\" }" });

        var explicitDependency = this._service.Compose(null, "staged/family.json", "{ \"$include\": \"@global/Header\" }");
        var localDependency = this._service.Compose(null, "staged/family.json", "{ \"$include\": \"@local/Header\" }");

        Assert.Multiple(() => {
            Assert.That(explicitDependency.Source.Id, Is.Null);
            Assert.That(explicitDependency.Source.Origin, Is.EqualTo(PodRunOrigin.SuppliedDraft));
            Assert.That(explicitDependency.Dependencies.Single().PodId, Is.EqualTo("global"));
            Assert.That(explicitDependency.Composed, Does.Contain("global"));
            Assert.That(localDependency.Composed, Is.Null);
            Assert.That(localDependency.Diagnostics.Single().Message, Does.Contain("needs a pod context"));
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
            Does.Contain("One").And.Contain("Two"));
    }

    [Test]
    public void Member_write_creates_and_refuses_an_existing_path() {
        this.WritePod("Office", "office");

        var sha = this._service.WriteSettingsMember("office", "settings/captured.json", "{}");

        var saved = this._service.Compose("office", "settings/captured.json", null).Source;
        Assert.That((saved.Content, saved.Sha256, saved.Origin), Is.EqualTo(("{}", sha, PodRunOrigin.SavedMember)));
        Assert.Throws<IOException>(() => this._service.WriteSettingsMember("office", "settings/captured.json", "{\"x\":1}"));
        Assert.Throws<InvalidDataException>(() => this._service.WriteSettingsMember("office", "output/x.json", "{}"));
        Assert.Throws<InvalidDataException>(() => this._service.WriteSettingsMember("office", "settings/../pod.json", "{}"));
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

        var run = PodRuns.NewRunFolder("office");
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

        var run = PodRuns.NewRunFolder("office");
        Directory.CreateDirectory(Path.Combine(run, "source", "00-family.json"));
        Assert.Throws<UnauthorizedAccessException>(() => PodRuns.WriteInputIn(run, new { operation = "test" }, PodRuns.ComposedInput(source, "{}")));
        Assert.That(Directory.EnumerateFiles(run, "*", SearchOption.AllDirectories), Is.Empty);
    }

    [Test]
    public void Receipt_that_cannot_be_saved_after_an_effect_returns_its_reason_instead_of_throwing() {
        var office = this.WritePod("Office", "office");
        var run = PodRuns.NewRunFolder("office");
        Directory.CreateDirectory(Path.Combine(run, "receipt.json"));

        var (path, unsaved) = PodRuns.SettleReceiptIn(run, PodReceipt.ForSavedMember("office", "settings/a.json", "sha", "schedule.apply", null, PodRunOutcome.Succeeded, [], null), []);

        Assert.That(path, Is.Null);
        Assert.That(unsaved, Does.Contain("native outcome stands"));
    }

    [Test]
    public void Output_read_that_fails_after_the_effect_leaves_the_outcome_standing() {
        var office = this.WritePod("Office", "office");
        var run = PodRuns.NewRunFolder("office");
        // The family apply edge passes its artifact reads lazily; the first one fails here, after the effect.
        IEnumerable<(string, byte[])> Outputs() {
            yield return ("apply.json", [1]);
            throw new FileNotFoundException("artifact vanished");
        }

        var (path, unsaved) = PodRuns.SettleReceiptIn(run, PodReceipt.ForSavedMember("office", "settings/a.json", "sha", "family.apply", null, PodRunOutcome.Succeeded, [], null), Outputs());

        Assert.That(path, Is.Null);
        Assert.That(unsaved, Does.Contain("artifact vanished"));
    }

    [Test]
    public void Output_named_like_the_receipt_is_refused_in_any_case() {
        var office = this.WritePod("Office", "office");
        var run = PodRuns.NewRunFolder("office");
        foreach (var name in new[] { "receipt.json", "Receipt.json", "RECEIPT.JSON" })
            Assert.Throws<ArgumentException>(() => PodRuns.WriteReceiptIn(run,
                PodReceipt.ForSavedMember("office", "settings/a.json", "sha", "family.apply", null, PodRunOutcome.Succeeded, [], null), [(name, [1])]), name);
    }

    [Test]
    public void A_draft_run_receipt_never_claims_a_saved_member() {
        var office = this.WritePod("Office", "office", new() { ["settings/family.json"] = "{\"saved\":1}" });
        var draftBytes = Encoding.UTF8.GetBytes("{\"draft\":1}");
        var draft = new PodCapturedSourceData("office", "settings/family.json", ScriptPodPreparationService.Sha256(draftBytes),
            Convert.ToBase64String(draftBytes), PodRunOrigin.SuppliedDraft);
        var saved = this._service.Compose("office", "settings/family.json", null).ToSource().Root;

        var draftReceipt = JObject.Parse(File.ReadAllText(PodRuns.WriteReceipt("office",
            PodReceipt.ForSource(draft, "family.apply", null, PodRunOutcome.Cancelled, [], null), [])));
        var savedReceipt = PodReceipt.ForSource(saved, "family.apply", null, PodRunOutcome.Succeeded, [], null);

        Assert.Multiple(() => {
            Assert.That(draftReceipt["origin"]!.Value<string>(), Is.EqualTo("SuppliedDraft"));
            Assert.That(draftReceipt["memberPath"]!.Type, Is.EqualTo(JTokenType.Null));
            Assert.That(draftReceipt["memberSha256"]!.Type, Is.EqualTo(JTokenType.Null));
            Assert.That(draftReceipt["outcome"]!.Value<string>(), Is.EqualTo("Cancelled"));
            Assert.That((savedReceipt.Origin, savedReceipt.MemberSha256), Is.EqualTo((PodRunOrigin.SavedMember, saved.Sha256)));
        });
    }

    [Test]
    public void Podless_draft_input_keeps_its_logical_path_bytes_and_hash() {
        const string content = "{ \"draft\": true }";
        var composition = this._service.Compose(null, "staged/family.json", content);
        var files = PodRuns.ComposedInput(composition.ToSource(), composition.Composed!);

        Assert.Multiple(() => {
            Assert.That(files[1].Role, Is.EqualTo("supplied-draft"));
            Assert.That(files[1].Pod, Is.Null);
            Assert.That(files[1].Address, Is.EqualTo("staged/family.json"));
            Assert.That(files[1].Bytes, Is.EqualTo(Encoding.UTF8.GetBytes(content)));
            var receipt = PodReceipt.ForSource(composition.ToSource().Root, "family.apply", null, PodRunOutcome.Succeeded, [], null);
            Assert.That((receipt.PodId, receipt.MemberPath, receipt.MemberSha256, receipt.Origin),
                Is.EqualTo(((string?)null, (string?)null, (string?)null, PodRunOrigin.SuppliedDraft)));
        });
    }

    [Test]
    public void Run_input_names_the_sealed_plan_or_the_explicit_review_gap() {
        var planned = PodRuns.WithReviewBasis(new JObject { ["operation"] = "family.apply" }, "plan-action-1");
        var direct = PodRuns.WithReviewBasis(new JObject { ["operation"] = "family.apply" }, null);

        Assert.Multiple(() => {
            Assert.That(planned["plan"]!["actionId"]!.Value<string>(), Is.EqualTo("plan-action-1"));
            Assert.That(planned["unavailableEvidence"]!.Values<string>(), Is.Empty);
            Assert.That(direct["plan"], Is.Null);
            Assert.That(direct["unavailableEvidence"]!.Values<string>(), Is.EqualTo(new[] { "reviewed Work revision" }));
        });
    }

    [Test]
    public void A_family_apply_request_carries_its_plan_action_id() {
        var request = Newtonsoft.Json.JsonConvert.DeserializeObject<Pe.Shared.HostContracts.Operations.FamilyApplyRequest>(
            """{"specJson":"{}","expectedPlanHashes":{},"plan":"plan-action-1","source":{"root":{"id":"p","path":"a.json","sha256":"s","bytesBase64":"e30=","origin":"SavedMember"},"dependencies":[]}}""")!;
        Assert.That(request.Plan, Is.EqualTo("plan-action-1"));
    }

    [Test]
    public void Cancelled_has_one_spelling() {
        Assert.That(Enum.GetNames(typeof(ScriptExecutionStatus)), Does.Contain("Cancelled").And.No.Contain("Canceled"));
        Assert.That(Enum.GetNames(typeof(PodRunOutcome)), Is.EqualTo(new[] { "Succeeded", "Failed", "Cancelled" }));
    }

    // ADR 0037 rule 6: a pod may sit in a home other people share, so a run writes no byte into it. The run is
    // keyed on the pod's manifest id under <state root>\state\Runs. Mutant, run red once: put the run back in a
    // pod folder (`NewRunFolder` to `Path.Combine(ProductPathing.UserRoot(), "Pods", podId, "output", RunId())`)
    // fails the state-path assert.
    [Test]
    public void A_run_of_a_shared_pod_lands_in_machine_state_and_writes_no_byte_into_the_pod() {
        var folder = this.WriteSharedPod("Shared Office", "shared-office", new() { ["settings/a.json"] = "{}" });
        Dictionary<string, string> Snapshot() => Directory.EnumerateFileSystemEntries(folder, "*", SearchOption.AllDirectories)
            .ToDictionary(path => Path.GetRelativePath(folder, path), path => File.Exists(path) ? Convert.ToHexString(File.ReadAllBytes(path)) : "<dir>");
        var before = Snapshot();
        var runs = Path.Combine(Pe.Shared.Product.ProductRuntimeLayout.Current.State.RunsPath, "shared-office");

        var path = PodRuns.WriteReceipt("shared-office",
            PodReceipt.ForSavedMember("shared-office", "settings/a.json", "sha", "schedule.apply", null, PodRunOutcome.Succeeded, ["schedule:123"], null),
            [("result.csv", Encoding.UTF8.GetBytes("a,b"))]);
        var writer = new Pe.Revit.Scripting.Storage.ScriptArtifactWriter("shared-office");
        writer.WriteInput(new { operation = "test" }, [new PodRunInputFile("bundle", "shared-office", "src/Run.cs", "source/00-Run.cs", [1, 2, 3])]);
        var artifact = writer.WriteText("report.txt", "from the script");
        var scriptReceipt = writer.WriteReceipt(PodReceipt.ForSavedMember("shared-office", "src/Run.cs", "sha", "scripting.execute", null, PodRunOutcome.Succeeded, [], null));

        var receipt = JObject.Parse(File.ReadAllText(path));
        Assert.Multiple(() => {
            Assert.That(Snapshot(), Is.EqualTo(before), "the shared pod is byte-identical after two runs");
            Assert.That(Directory.Exists(Path.Combine(folder, "output")), Is.False);
            Assert.That(Path.GetFileName(path), Is.EqualTo("receipt.json"));
            foreach (var written in new[] { path, artifact.FullPath, scriptReceipt.FullPath })
                Assert.That(Path.GetDirectoryName(Path.GetDirectoryName(written)), Is.EqualTo(runs), written);
            Assert.That(runs, Does.Contain(Path.Combine("state", "Runs")).And.Not.Contain(this._root));
            Assert.That(File.ReadAllText(Path.Combine(Path.GetDirectoryName(path)!, "result.csv")), Is.EqualTo("a,b"));
            Assert.That(receipt["memberSha256"]!.Value<string>(), Is.EqualTo("sha"));
            Assert.That(receipt["outputs"]!.Values<string>(), Is.EqualTo(new[] { "schedule:123", "result.csv" }));
        });
    }

    // The host names the pod's absolute folder; native code never joins a folder name onto the user's Pods.
    // Mutant, run red once: resolve by name under the user home (`ResolveFolder` to
    // `ScriptingWorkspaceLocations.ResolveWorkspaceRoot(capture.Folder)`) fails the folder assert and the write.
    [Test]
    public void A_pod_in_a_shared_home_is_found_and_written_where_the_host_says() {
        var folder = this.WriteSharedPod("Shared Office", "shared-office");

        Assert.That(this._service.ResolveFolder("shared-office"), Is.EqualTo(folder));
        Assert.That(this._service.ResolveBootstrapFolder("Shared Office"), Is.EqualTo(folder), "bootstrap seeds the admitted pod, by folder name");
        Assert.That(this._service.ResolveBootstrapFolder("shared-office"), Is.EqualTo(folder), "and by id, so it never mints a second pod with that id");
        var sha = this._service.WriteSettingsMember("shared-office", "settings/captured.json", "{}");
        Assert.That(File.ReadAllText(Path.Combine(folder, "settings", "captured.json")), Is.EqualTo("{}"));
        Assert.That(sha, Is.EqualTo(ScriptPodPreparationService.Sha256(Encoding.UTF8.GetBytes("{}"))));

        // The host's word is checked only for shape: an id that disagrees, or a folder that is not absolute, refuses.
        ScriptPodPreparationService Answering(object capture) => new((_, _) => JObject.FromObject(capture));
        var bundle = Bundle(folder);
        Assert.That(Answering(new { id = "other", folder = "Shared Office", directory = folder, contributions = Array.Empty<object>(), memberBundle = bundle })
            .Capture("shared-office").Code, Is.EqualTo("package.unavailable"));
        Assert.That(Answering(new { id = "shared-office", folder = "Shared Office", directory = "Shared Office", contributions = Array.Empty<object>(), memberBundle = bundle })
            .Capture("shared-office").Code, Is.EqualTo("package.unavailable"));
        Assert.Throws<InvalidDataException>(() => this._service.ResolveFolder("no-such-pod"));
    }

    [Test]
    public void Receipt_reason_is_null_on_success_and_the_failure_text_on_failure() {
        var folder = this.WritePod("Office", "office");
        // `scripting.execute` joins zero error diagnostics into "" (w6-revit claim 6); the receipt still says null.
        var succeeded = PodReceipt.ForSavedMember("office", "src/Run.cs", "sha", "scripting.execute", null, PodRunOutcome.Failed, [], null) with { Outcome = PodRunOutcome.Succeeded, Reason = string.Join("; ", Array.Empty<string>()) };
        var failed = PodReceipt.ForSavedMember("office", "settings/a.json", "sha", "schedule.apply", null, PodRunOutcome.Failed, [], "Apply Schedule 'A' did not commit.");
        var saved = (PodReceipt r) => JObject.Parse(File.ReadAllText(PodRuns.WriteReceipt("office", r, [])))["reason"]!;
        Assert.Multiple(() => {
            Assert.That(saved(succeeded).Type, Is.EqualTo(JTokenType.Null));
            Assert.That(saved(PodReceipt.ForSavedMember("office", "settings/a.json", "sha", "schedule.apply", null, PodRunOutcome.Succeeded, [], "")).Type, Is.EqualTo(JTokenType.Null));
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

    // A single object in array position is inserted as one element (the capability before ae9ce8c; ruling-ff-coercion audit #17).
    [Test]
    public void Array_include_of_a_single_object_inserts_that_object() {
        this.WritePod("Office", "office", new() {
            ["settings/member.json"] = """{"Fields":[{"A":1},{"$include":"@local/_fields/X"},{"B":2}]}""",
            ["settings/_fields/X.json"] = """{"Name":"one field spec"}"""
        });

        var composed = this._service.Compose("office", "settings/member.json", null);

        Assert.That(composed.Diagnostics, Is.Empty);
        Assert.That(JObject.Parse(composed.Composed!)["Fields"]!.ToString(Newtonsoft.Json.Formatting.None),
            Is.EqualTo("""[{"A":1},{"Name":"one field spec"},{"B":2}]"""));
    }

    [Test]
    public void Array_include_of_a_scalar_or_null_is_a_named_include_error() {
        foreach (var scalar in new[] { "3", "null", "\"text\"" }) {
            this.WritePod("Office", "office", new() {
                ["settings/member.json"] = """{"Fields":[{"$include":"@local/_fields/X"}]}""",
                ["settings/_fields/X.json"] = scalar
            });

            var composed = this._service.Compose("office", "settings/member.json", null);

            Assert.That(composed.Composed, Is.Null, scalar);
            var error = composed.Diagnostics.Single();
            Assert.That(error.Stage, Is.EqualTo("pod.settings.include"), scalar);
            Assert.That(error.Message, Does.Contain("@local/_fields/X"), scalar);
        }
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
        var bundle = Bundle(folder) with { Files = [.. Bundle(folder).Files,
            .. Enumerable.Range(0, ScriptPodMemberBounds.MaxFileCount).Select(i => new ScriptPodSourceFile($"assets/{i}.txt", ""))] };
        Assert.Throws<ArgumentException>(() => ScriptPodPreparationService.Prepare(folder, bundle));
    }

    [Test]
    public void Large_members_remain_listable_and_composable_under_membership_bounds() {
        var content = "{\"text\":\"" + new string('x', 614400) + "\"}";
        this.WritePod("Large", "large", new() {
            ["assets/image.bin"] = new string('a', 614400),
            ["settings/large.json"] = content,
            ["settings/root.json"] = "{\"$include\":\"@local/large\"}"
        });
        Assert.That(this._service.List().Single(), Is.TypeOf<PreparedPod>());
        var composed = this._service.Compose("large", "settings/root.json", null);
        Assert.That(composed.Diagnostics, Is.Empty);
        Assert.That(JObject.Parse(composed.Composed!)["text"]!.Value<string>(), Has.Length.EqualTo(614400));
    }

    private static ScriptPodSourceBundle Bundle(string folder) => new(Directory.EnumerateFiles(folder, "*", SearchOption.AllDirectories)
        .Where(path => !Path.GetRelativePath(folder, path).Replace('\\', '/').StartsWith("output/", StringComparison.Ordinal))
        .Select(path => new ScriptPodSourceFile(Path.GetRelativePath(folder, path).Replace('\\', '/'), Convert.ToBase64String(File.ReadAllBytes(path)))).ToList());

    private JObject Admission(string key, object request) {
        var rows = this._folders.Values.Select(folder => new {
            id = JObject.Parse(File.ReadAllText(Path.Combine(folder, "pod.json"))).Value<string>("id"),
            folder = Path.GetFileName(folder), directory = folder
        }).ToList();
        if (key == "pod.list") {
            var input = JObject.FromObject(request);
            if (input.Value<string>("projection") != "identity") return JObject.FromObject(new { pods = rows });
            var selected = rows.Single(row => row.folder == input.Value<string>("folder"));
            if (rows.Count(row => row.id == selected.id) != 1) throw new InvalidDataException("Duplicate Pod identity");
            return JObject.FromObject(new { projection = "identity", identity = new { selected.id, selected.folder } });
        }
        if (key != "pod.capture") throw new InvalidOperationException($"Unexpected native admission call: {key}");
        var id = JObject.FromObject(request).Value<string>("pod");
        var matches = rows.Where(item => item.id == id).ToList();
        if (matches.Count != 1) throw new InvalidDataException($"Pod id '{id}' is claimed by folders {string.Join(", ", matches.Select(item => item.folder))}.");
        var row = matches[0];
        return JObject.FromObject(new { row.id, row.folder, row.directory, contributions = Array.Empty<object>(), memberBundle = Bundle(row.directory) });
    }

    [Test]
    public void Admission_dependency_timeout_is_not_script_cancellation() {
        this.WritePod("Default", "default");
        var service = new ScriptPodPreparationService((_, _) => throw new OperationCanceledException("HTTP deadline"));
        var error = Assert.Throws<InvalidDataException>(() => service.ResolveBootstrapFolder("default"));
        Assert.That(error!.Message, Does.Contain("Host admission 'pod.list'").And.Contain("10s dependency deadline"));
        Assert.That(error.InnerException, Is.TypeOf<OperationCanceledException>());
    }

    // A script's `PodFile` (pods map, contract C1). Mutants, each run red once: drop the `NormalizeMemberPath` call
    // and the prefix check in `FullPath` (the `..` path answers the outside file); drop the reparse-point loop in
    // `MemberFile` (the junction answers the outside file); drop the `File.Exists` test (a missing file answers).
    [Test]
    public void A_scripts_pod_file_is_a_live_member_and_never_leaves_the_pod() {
        var folder = this.WritePod("Office", "office", new() { ["assets/note.txt"] = "carried" });
        var outside = Path.Combine(this._root, "outside");
        Directory.CreateDirectory(outside);
        File.WriteAllText(Path.Combine(outside, "secret.txt"), "not the pod's");
        // A junction needs no privilege, where a symbolic link does; both are reparse points.
        using (var link = System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo("cmd.exe",
                   $"/c mklink /J \"{Path.Combine(folder, "linked")}\" \"{outside}\"") { UseShellExecute = false, CreateNoWindow = true })!)
            link.WaitForExit();
        Assert.That(File.Exists(Path.Combine(folder, "linked", "secret.txt")), Is.True, "the junction was not made");
        try {
            Assert.That(ScriptPodPreparationService.MemberFile(folder, "assets/note.txt"), Is.EqualTo(Path.Combine(folder, "assets", "note.txt")));
            Assert.That(ScriptPodPreparationService.MemberFile(folder, @"assets\note.txt"), Is.EqualTo(Path.Combine(folder, "assets", "note.txt")));
            File.WriteAllText(Path.Combine(folder, "assets", "note.txt"), "edited after the run began");
            Assert.That(File.ReadAllText(ScriptPodPreparationService.MemberFile(folder, "assets/note.txt")), Is.EqualTo("edited after the run began"));
            foreach (var escape in new[] { "../outside/secret.txt", "assets/../../outside/secret.txt", Path.Combine(outside, "secret.txt"), "" })
                Assert.Throws<InvalidDataException>(() => ScriptPodPreparationService.MemberFile(folder, escape), escape);
            Assert.That(Assert.Throws<InvalidDataException>(() => ScriptPodPreparationService.MemberFile(folder, "linked/secret.txt"))!.Message,
                Does.Contain("cannot follow a link"));
            Assert.That(Assert.Throws<FileNotFoundException>(() => ScriptPodPreparationService.MemberFile(folder, "assets/missing.rfa"))!.Message,
                Is.EqualTo("This Pod has no file 'assets/missing.rfa'."));
        } finally { Directory.Delete(Path.Combine(folder, "linked")); }
    }

    // Mutant, run red once: raise `ScriptInputBounds.MaxInputBytes` (the oversized input is accepted).
    [Test]
    public void A_scripts_input_is_bounded_at_256_KiB() {
        Assert.DoesNotThrow(() => ScriptInputBounds.Require(null));
        Assert.DoesNotThrow(() => ScriptInputBounds.Require(new JObject { ["text"] = new string('a', 256 * 1024 - 11) }));
        Assert.That(Assert.Throws<ArgumentException>(() => ScriptInputBounds.Require(new JObject { ["text"] = new string('a', 256 * 1024 - 10) }))!.Message,
            Is.EqualTo("Script input may not exceed 256 KiB."));
    }

    [Test]
    public void Captured_support_files_are_retained_but_only_CSharp_sources_compile() {
        var folder = this.WritePod("Office", "office", new() {
            ["src/Run.cs"] = "public sealed class Run : PeScriptContainer {}",
            ["src/readme.txt"] = "Support", ["skills/inspect/SKILL.md"] = "Skill", ["README.md"] = "Guide"
        }, ""","entrypoints":[{"sourcePath":"src/Run.cs"}]""");
        var bundle = Bundle(folder);
        var prepared = ScriptPodPreparationService.Prepare(folder, bundle);
        File.WriteAllText(Path.Combine(folder, "src", "Run.cs"), "changed after capture");
        var normalized = ScriptPodSourceNormalizer.Normalize(bundle, "Office", "src/Run.cs");
        Assert.That(prepared, Is.TypeOf<PreparedPod>());
        Assert.That(prepared.Members.Select(member => member.Path), Does.Contain("skills/inspect/SKILL.md"));
        Assert.That(normalized.SourceSet.Files.Select(file => file.Name), Is.EqualTo(new[] { "src/Run.cs" }));
        Assert.That(normalized.SourceSet.Files[0].Content, Does.Contain("PeScriptContainer"));
    }

    [TestCase("src/../Run.cs")]
    [TestCase("src\\Run.cs")]
    [TestCase("/src/Run.cs")]
    [TestCase("assets/CON.txt")]
    public void Captured_paths_refuse_noncanonical_spelling(string path) {
        Assert.Throws<ArgumentException>(() => ScriptPodSourceNormalizer.DecodeFiles(new([new(path, "")] )));
    }

    [Test]
    public void Captured_paths_refuse_case_collisions() {
        Assert.Throws<ArgumentException>(() => ScriptPodSourceNormalizer.DecodeFiles(new([new("src/Run.cs", ""), new("src/run.cs", "")] )));
    }

    [Test]
    public void Host_admission_unavailable_is_a_typed_result_without_filesystem_fallback() {
        this.WritePod("Office", "office");
        var service = new ScriptPodPreparationService((_, _) => throw new IOException("Host unavailable"));
        var result = service.Capture("office");
        Assert.That(result.Capture, Is.Null);
        Assert.That(result.Code, Is.EqualTo("package.unavailable"));
        Assert.That(result.Reason, Does.Contain("Host unavailable"));
        Assert.That(service.List().Single(), Is.TypeOf<RefusedPod>());
        Assert.That(service.List().Single().Diagnostics.Single().Stage, Is.EqualTo("package.unavailable"));
    }

    /// <summary>A pod in a second home: nowhere under the user's Pods, so only the host's directory can find it.</summary>
    private string WriteSharedPod(string folderName, string id, Dictionary<string, string>? files = null) =>
        this.WritePod(folderName, id, files, podsRoot: Path.Combine(this._root, "shared drive", "04 PE Software Files", "Pe.Tools", "Pods"));

    private string WritePod(string folderName, string id, Dictionary<string, string>? files = null, string extraManifest = "", string? podsRoot = null) {
        var folder = Path.Combine(podsRoot ?? this._pods, folderName);
        Directory.CreateDirectory(folder);
        this._folders[folderName] = folder;
        File.WriteAllText(Path.Combine(folder, "pod.json"), $$"""{"schemaVersion":2,"id":"{{id}}","name":"{{id}}","version":"1"{{extraManifest}}}""");
        foreach (var file in files ?? []) {
            var path = Path.Combine(folder, file.Key.Replace('/', Path.DirectorySeparatorChar));
            Directory.CreateDirectory(Path.GetDirectoryName(path)!);
            File.WriteAllText(path, file.Value);
        }
        return folder;
    }
}
