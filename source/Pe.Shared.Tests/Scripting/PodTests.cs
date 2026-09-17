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

        Assert.That(this._service.ReadMember("office", "settings/captured.json"), Is.EqualTo(("{}", sha)));
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
    public void Composer_rejects_malformed_directives() {
        foreach (var malformed in new[] { "{\"$preset\":null}", "{\"$preset\":3}", "{\"$include\":[]}", "{\"$include\":\"@local/a\",\"b\":1}" }) {
            var rejected = PodComposer.Compose("settings/main.json", malformed, AlwaysResolve);
            Assert.That(rejected.Document, Is.Null, malformed);
            Assert.That(rejected.Diagnostics, Is.Not.Empty, malformed);
        }

        static bool AlwaysResolve(string reference, out PodConsumedDependency dependency, out string reason) {
            dependency = new PodConsumedDependency("local", "settings/a.json", string.Empty, "{}");
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
