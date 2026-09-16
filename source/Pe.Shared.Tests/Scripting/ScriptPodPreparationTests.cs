using Pe.Revit.Scripting.Pods;
using Pe.Shared.HostContracts.Scripting;
using Pe.Shared.Scripting.Pods;
using System.Text;

namespace Pe.Revit.Tests;

[TestFixture]
public sealed class ScriptPodPreparationTests {
    private string _root = null!;
    private ScriptPodPreparationService _service = null!;

    [SetUp]
    public void SetUp() {
        this._root = Path.Combine(Path.GetTempPath(), "portable-pod-tests", Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(this._root);
        this._service = new ScriptPodPreparationService(id => Path.Combine(this._root, id));
    }

    [TearDown]
    public void TearDown() => Directory.Delete(this._root, true);

    [Test]
    public void Settings_only_source_edit_prepares_a_new_snapshot_and_excludes_outputs() {
        WritePod("settings-only", """
            {"schemaVersion":2,"id":"settings-only","name":"Settings","version":"1.0.0","entrypoints":[]}
            """, new Dictionary<string, string> {
                ["settings/default.settings.json"] = "{\"value\":1}",
                ["output/old-result.json"] = "{\"ignored\":true}"
            });

        var first = this._service.Prepare("settings-only");
        File.WriteAllText(Path.Combine(this._root, "settings-only", "settings", "default.settings.json"), "{\"value\":2}");
        var edited = this._service.Prepare("settings-only");
        File.WriteAllText(Path.Combine(this._root, "settings-only", "output", "old-result.json"), "{\"ignored\":false}");
        var outputEdited = this._service.Prepare("settings-only");

        Assert.Multiple(() => {
            Assert.That(first.Success, Is.True);
            Assert.That(first.ComposedSettings["composed/default.settings.json"].Content, Does.Contain("1"));
            Assert.That(edited.ContentHash, Is.Not.EqualTo(first.ContentHash));
            Assert.That(outputEdited.ContentHash, Is.EqualTo(edited.ContentHash));
            Assert.That(outputEdited.Files.Keys, Has.None.EqualTo("output/old-result.json"));
        });
    }

    [Test]
    public void Dependency_hash_is_exact_and_only_consumed_source_is_retained_for_inspection() {
        WritePod("library", """
            {"schemaVersion":2,"id":"library","name":"Library","version":"1.0.0","entrypoints":[]}
            """, new Dictionary<string, string> {
                ["settings/base.settings.json"] = "{\"base\":1}",
                ["settings/unused.settings.json"] = "{\"unused\":true}"
            });
        var releaseHash = this._service.Prepare("library").ContentHash;
        WritePod("consumer", $$"""
            {"schemaVersion":2,"id":"consumer","name":"Consumer","version":"1.0.0","entrypoints":[],"requires":[{"id":"library","releaseHash":"{{releaseHash}}"}]}
            """, new Dictionary<string, string> {
                ["settings/main.settings.json"] = "{\"$preset\":\"@library/base.settings.json\",\"local\":2}"
            });

        var prepared = this._service.Prepare("consumer");
        Assert.Multiple(() => {
            Assert.That(prepared.Success, Is.True);
            Assert.That(prepared.ComposedSettings["composed/main.settings.json"].Content, Does.Contain("base"));
            Assert.That(prepared.InspectionDependencies.Select(item => item.SourcePath), Is.EqualTo(new[] { "settings/base.settings.json" }));
        });

        File.WriteAllText(Path.Combine(this._root, "library", "settings", "base.settings.json"), "{\"base\":3}");
        var mismatch = this._service.Prepare("consumer");
        Assert.That(mismatch.Success, Is.False);
        Assert.That(mismatch.Outcomes.Select(outcome => outcome.Code), Does.Contain("pod.dependency.hash-mismatch"));
    }

    [Test]
    public void Foreign_composed_documents_keep_their_own_local_and_upstream_resolution() {
        WritePod("upstream", """
            {"schemaVersion":2,"id":"upstream","name":"Upstream","version":"1.0.0","entrypoints":[]}
            """, new Dictionary<string, string> { ["settings/nested.settings.json"] = "{\"upstream\":1}" });
        var upstreamHash = this._service.Prepare("upstream").ContentHash;
        WritePod("library", $$"""
            {"schemaVersion":2,"id":"library","name":"Library","version":"1.0.0","entrypoints":[],"requires":[{"id":"upstream","releaseHash":"{{upstreamHash}}"}]}
            """, new Dictionary<string, string> {
                ["settings/nested.settings.json"] = "{\"library\":1}",
                ["settings/base.settings.json"] = "{\"$preset\":\"@local/nested.settings.json\",\"fromUpstream\":{\"$include\":\"@upstream/nested.settings.json\"}}"
            });
        var libraryHash = this._service.Prepare("library").ContentHash;
        WritePod("consumer", $$"""
            {"schemaVersion":2,"id":"consumer","name":"Consumer","version":"1.0.0","entrypoints":[],"requires":[{"id":"library","releaseHash":"{{libraryHash}}"}]}
            """, new Dictionary<string, string> {
                ["settings/nested.settings.json"] = "{\"consumer\":1}",
                ["settings/main.settings.json"] = "{\"$preset\":\"@library/base.settings.json\"}"
            });

        var prepared = this._service.Prepare("consumer");
        var content = prepared.ComposedSettings["composed/main.settings.json"].Content;
        Assert.Multiple(() => {
            Assert.That(prepared.Success, Is.True, string.Join("; ", prepared.Outcomes.Select(outcome => outcome.Reason)));
            Assert.That(content, Does.Contain("\"library\": 1"));
            Assert.That(content, Does.Contain("\"upstream\": 1"));
            Assert.That(content, Does.Not.Contain("consumer"));
            Assert.That(prepared.InspectionDependencies.Select(item => (item.PodId, item.SourcePath)),
                Does.Contain(("library", "settings/base.settings.json")));
            Assert.That(prepared.InspectionDependencies.Select(item => (item.PodId, item.SourcePath)),
                Does.Contain(("library", "settings/nested.settings.json")));
            Assert.That(prepared.InspectionDependencies.Select(item => (item.PodId, item.SourcePath)),
                Does.Contain(("upstream", "settings/nested.settings.json")));
        });
    }

    [Test]
    public void Composer_rejects_malformed_directives_and_emits_stable_closed_json() {
        foreach (var malformed in new[] {
                     "{\"$preset\":null}", "{\"$preset\":3}", "{\"$preset\":[]}",
                     "{\"$include\":null}", "{\"$include\":3}", "{\"$include\":[]}"
                 }) {
            var rejected = PodComposer.Compose("settings/main.settings.json", malformed, NeverResolve);
            Assert.That(rejected.Document, Is.Null, malformed);
            Assert.That(rejected.Diagnostics, Is.Not.Empty, malformed);
        }

        var sources = new Dictionary<string, string>(StringComparer.Ordinal) {
            ["@local/base.settings.json"] = "{\"nested\":{\"a\":1,\"b\":1}}",
            ["@local/value.settings.json"] = "{\"fromInclude\":true}"
        };
        var composed = PodComposer.Compose("settings/main.settings.json",
            "{\"$preset\":\"@local/base.settings.json\",\"nested\":{\"b\":{\"$include\":\"@local/value.settings.json\"}}}", Resolve);
        Assert.Multiple(() => {
            Assert.That(composed.Diagnostics, Is.Empty);
            Assert.That(composed.Document!.Content, Does.EndWith("\n"));
            Assert.That(composed.Document.Content, Does.Not.Contain("\r\n"));
            Assert.That(composed.Document.Content, Does.Not.Contain("$preset"));
            Assert.That(composed.Document.Content, Does.Not.Contain("$include"));
            Assert.That(composed.Document.Content, Does.Contain("fromInclude"));
        });

        return;
        static bool NeverResolve(string reference, out PodConsumedDependency dependency, out string reason) {
            dependency = null!;
            reason = "unexpected";
            return false;
        }
        bool Resolve(string reference, out PodConsumedDependency dependency, out string reason) {
            reason = string.Empty;
            if (!sources.TryGetValue(reference, out var content)) {
                dependency = null!;
                reason = "missing";
                return false;
            }
            dependency = new PodConsumedDependency("local", string.Empty, reference[1..], content);
            return true;
        }
    }

    [Test]
    public void Bundle_rejects_a_dependency_that_overwrites_the_root_capture() {
        var manifest = Convert.ToBase64String(Encoding.UTF8.GetBytes(
            "{\"schemaVersion\":2,\"id\":\"sample\",\"name\":\"Sample\",\"version\":\"1.0.0\",\"entrypoints\":[]}"));
        var bundle = new ScriptPodSourceBundle([new ScriptPodSourceFile("pod.json", manifest)], [
            new ScriptPodDependencyBundle("sample", "hash", [new ScriptPodSourceFile("pod.json", manifest)])
        ]);
        Assert.That(() => this._service.Prepare("sample", bundle), Throws.TypeOf<InvalidDataException>()
            .With.Message.Contains("root"));
    }

    [Test]
    public void Capture_rejects_a_linked_positive_directory() {
        WritePod("linked", """
            {"schemaVersion":2,"id":"linked","name":"Linked","version":"1.0.0","entrypoints":[]}
            """);
        var outside = Path.Combine(this._root, "outside");
        Directory.CreateDirectory(outside);
        File.WriteAllText(Path.Combine(outside, "payload.bin"), "escape");
        var link = Path.Combine(this._root, "linked", "assets");
        try {
            Directory.CreateSymbolicLink(link, outside);
        } catch (Exception exception) when (exception is UnauthorizedAccessException or IOException or PlatformNotSupportedException) {
            Assert.Ignore($"Directory links are unavailable on this machine: {exception.Message}");
        }

        var prepared = this._service.Prepare("linked");
        Assert.That(prepared.Success, Is.False);
        Assert.That(prepared.Outcomes.Select(outcome => outcome.Code), Does.Contain("pod.directory.link"));
        Assert.That(prepared.Files.Keys, Has.None.EqualTo("assets/payload.bin"));
    }

    [Test]
    public void Capture_enforces_the_shared_file_count_bound() {
        WritePod("bounded", """
            {"schemaVersion":2,"id":"bounded","name":"Bounded","version":"1.0.0","entrypoints":[]}
            """);
        Directory.CreateDirectory(Path.Combine(this._root, "bounded", "assets"));
        for (var index = 0; index < 200; index++)
            File.WriteAllText(Path.Combine(this._root, "bounded", "assets", $"{index:D3}.txt"), string.Empty);

        var prepared = this._service.Prepare("bounded");

        Assert.That(prepared.Success, Is.False);
        Assert.That(prepared.Outcomes.Select(outcome => outcome.Code), Does.Contain("pod.file.limit"));
        Assert.That(prepared.Files.Count, Is.EqualTo(200));
    }

    [Test]
    public void External_authority_is_declared_without_bundling_definitions() {
        WritePod("external", """
            {"schemaVersion":2,"id":"external","name":"External","version":"1.0.0","entrypoints":[],"externalRequirements":[{"code":"aps.parameters","collectionId":"collection-a","resourceId":"parameter-a"}]}
            """);

        var prepared = this._service.Prepare("external");
        Assert.Multiple(() => {
            Assert.That(prepared.Success, Is.True);
            Assert.That(prepared.Outcomes.Select(outcome => outcome.Code), Does.Contain("pod.external.runtime-required"));
            Assert.That(prepared.Files.Keys, Has.None.Contains("parameter"));
        });
    }

    private void WritePod(string id, string manifest, IReadOnlyDictionary<string, string>? files = null) {
        var root = Path.Combine(this._root, id);
        Directory.CreateDirectory(root);
        File.WriteAllText(Path.Combine(root, "pod.json"), manifest);
        foreach (var file in files ?? new Dictionary<string, string>()) {
            var path = Path.Combine(root, file.Key.Replace('/', Path.DirectorySeparatorChar));
            Directory.CreateDirectory(Path.GetDirectoryName(path)!);
            File.WriteAllText(path, file.Value);
        }
    }
}
