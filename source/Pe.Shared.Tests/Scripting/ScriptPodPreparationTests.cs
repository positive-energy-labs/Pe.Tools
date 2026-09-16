using Pe.Revit.Scripting.Pods;

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
