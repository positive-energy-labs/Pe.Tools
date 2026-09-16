using Newtonsoft.Json.Linq;
using Pe.Revit.Scripting.Bootstrap;
using Pe.Revit.Scripting.Context;
using Pe.Revit.Scripting.Pods;
using Pe.Revit.Scripting.References;
using Pe.Shared.HostContracts.Scripting;
using System.IO.Compression;

namespace Pe.Revit.Tests;

[TestFixture]
public sealed class PortablePodArchiveTests {
    private string _root = null!;
    private ScriptPodArchiveService _service = null!;
    private ScriptPodPreparationService _preparation = null!;
    private Func<string, string> _resolve = null!;

    [SetUp]
    public void SetUp() {
        this._root = Path.Combine(Path.GetTempPath(), "portable-pod-archive-tests", Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(this._root);
        string Resolve(string id) => Path.Combine(this._root, "workspaces", id);
        this._resolve = Resolve;
        var generator = new ScriptProjectGenerator(new CsProjReader());
        var bootstrap = new ScriptWorkspaceBootstrapService(generator, Resolve, Path.Combine(this._root, "product"));
        this._service = new ScriptPodArchiveService(bootstrap, generator, Resolve);
        this._preparation = new ScriptPodPreparationService(Resolve);
    }

    [TearDown]
    public void TearDown() => Directory.Delete(this._root, true);

    [Test]
    public void Export_import_verifies_content_excludes_outputs_and_preserves_release_identity() {
        var workspace = Path.Combine(this._root, "workspaces", "portable");
        Write(workspace, "pod.json", """
            {"schemaVersion":2,"id":"portable","name":"Portable","version":"1.2.3","entrypoints":[]}
            """);
        Write(workspace, "settings/main.settings.json", "{\"value\":1}");
        Write(workspace, "output/useful.json", "{\"result\":true}");
        var archivePath = Path.Combine(this._root, "portable.zip");

        var exported = this._service.Export(new ScriptPodExportRequest("portable", archivePath), "net8.0-windows", "2025");
        Assert.That(exported.Status, Is.EqualTo(ScriptPodTransferStatus.Succeeded),
            string.Join("; ", exported.Diagnostics.Select(diagnostic => diagnostic.Message)));
        using (var archive = ZipFile.OpenRead(archivePath)) {
            Assert.That(archive.GetEntry("release.json"), Is.Not.Null);
            Assert.That(archive.GetEntry("settings/main.settings.json"), Is.Not.Null);
            Assert.That(archive.GetEntry("composed/main.settings.json"), Is.Not.Null);
            Assert.That(archive.Entries.Select(entry => entry.FullName), Has.None.StartsWith("output/"));
        }

        Directory.Delete(workspace, true);
        var imported = this._service.Import(
            new ScriptPodImportRequest(archivePath),
            "2025",
            "net8.0-windows",
            typeof(PeScriptContainer).Assembly.Location
        );
        var manifest = JObject.Parse(File.ReadAllText(Path.Combine(workspace, "pod.json")));
        var prepared = this._preparation.Prepare("portable");
        Assert.Multiple(() => {
            Assert.That(imported.Status, Is.EqualTo(ScriptPodTransferStatus.Succeeded));
            Assert.That(manifest["parent"], Is.Null);
            Assert.That(prepared.ContentHash, Is.EqualTo(exported.Release!.ContentHash));
            Assert.That(prepared.Manifest.Parent, Is.Null);
        });
    }

    [Test]
    public void Import_rejects_tampered_release_content() {
        var workspace = Path.Combine(this._root, "workspaces", "portable");
        Write(workspace, "pod.json", """
            {"schemaVersion":2,"id":"portable","name":"Portable","version":"1.0.0","entrypoints":[]}
            """);
        Write(workspace, "settings/main.settings.json", "{\"value\":1}");
        var archivePath = Path.Combine(this._root, "portable.zip");
        var exported = this._service.Export(new ScriptPodExportRequest("portable", archivePath), "net8.0-windows");
        Assert.That(exported.Status, Is.EqualTo(ScriptPodTransferStatus.Succeeded),
            string.Join("; ", exported.Diagnostics.Select(diagnostic => diagnostic.Message)));
        Directory.Delete(workspace, true);

        using (var archive = ZipFile.Open(archivePath, ZipArchiveMode.Update)) {
            archive.GetEntry("settings/main.settings.json")!.Delete();
            using var writer = new StreamWriter(archive.CreateEntry("settings/main.settings.json").Open());
            writer.Write("{\"value\":2}");
        }
        var imported = this._service.Import(
            new ScriptPodImportRequest(archivePath),
            "2025",
            "net8.0-windows",
            typeof(PeScriptContainer).Assembly.Location
        );

        Assert.That(imported.Status, Is.EqualTo(ScriptPodTransferStatus.Rejected));
        Assert.That(imported.Diagnostics.Select(diagnostic => diagnostic.Message), Has.Some.Contain("hash mismatch"));
        Assert.That(Directory.Exists(workspace), Is.False);
    }

    [Test]
    public void Imported_composed_release_prepares_without_author_dependencies_and_edits_never_use_stale_composed_bytes() {
        var library = this._resolve("library");
        Write(library, "pod.json", """
            {"schemaVersion":2,"id":"library","name":"Library","version":"1.0.0","entrypoints":[]}
            """);
        Write(library, "settings/base.settings.json", "{\"library\":1}");
        var libraryHash = this._preparation.Prepare("library").ContentHash;
        var consumer = this._resolve("consumer");
        Write(consumer, "pod.json", $$"""
            {"schemaVersion":2,"id":"consumer","name":"Consumer","version":"1.0.0","entrypoints":[],"requires":[{"id":"library","releaseHash":"{{libraryHash}}"}]}
            """);
        Write(consumer, "settings/main.settings.json", "{\"$preset\":\"@library/base.settings.json\",\"consumer\":1}");
        var archivePath = Path.Combine(this._root, "consumer.zip");
        var exported = this._service.Export(new ScriptPodExportRequest("consumer", archivePath), "net8.0-windows", "2025");
        Assert.That(exported.Status, Is.EqualTo(ScriptPodTransferStatus.Succeeded));

        Directory.Delete(Path.Combine(this._root, "workspaces"), true);
        var imported = this._service.Import(new ScriptPodImportRequest(archivePath), "2025", "net8.0-windows",
            typeof(PeScriptContainer).Assembly.Location);
        Assert.That(imported.Status, Is.EqualTo(ScriptPodTransferStatus.Succeeded));
        var unchanged = this._preparation.Prepare("consumer");
        Assert.Multiple(() => {
            Assert.That(unchanged.Success, Is.True, string.Join("; ", unchanged.Outcomes.Select(outcome => outcome.Reason)));
            Assert.That(unchanged.ContentHash, Is.EqualTo(exported.Release!.ContentHash));
            Assert.That(unchanged.ComposedSettings["composed/main.settings.json"].Content, Does.Contain("\"library\": 1"));
        });

        File.WriteAllText(Path.Combine(consumer, "composed", "main.settings.json"), "{\"tampered\":true}");
        var tampered = this._preparation.Prepare("consumer");
        Assert.That(tampered.Success, Is.False);
        Assert.That(tampered.Outcomes.Select(outcome => outcome.Code), Does.Contain("pod.release.integrity"));

        using (var archive = ZipFile.OpenRead(archivePath)) {
            var composed = archive.GetEntry("composed/main.settings.json")!;
            composed.ExtractToFile(Path.Combine(consumer, "composed", "main.settings.json"), true);
        }
        File.WriteAllText(Path.Combine(consumer, "settings", "main.settings.json"), "{\"$preset\":\"@library/base.settings.json\",\"consumer\":2}");
        var editedWithoutDependency = this._preparation.Prepare("consumer");
        Assert.That(editedWithoutDependency.Success, Is.False);
        Assert.That(editedWithoutDependency.Outcomes.Select(outcome => outcome.Code), Does.Contain("pod.dependency.missing-after-release-edit"));
        Assert.That(editedWithoutDependency.ComposedSettings, Is.Empty);

        Write(library, "pod.json", """
            {"schemaVersion":2,"id":"library","name":"Library","version":"1.0.0","entrypoints":[]}
            """);
        Write(library, "settings/base.settings.json", "{\"library\":1}");
        var edited = this._preparation.Prepare("consumer");
        Assert.Multiple(() => {
            Assert.That(edited.Success, Is.True, string.Join("; ", edited.Outcomes.Select(outcome => outcome.Reason)));
            Assert.That(edited.ContentHash, Is.Not.EqualTo(exported.Release!.ContentHash));
            Assert.That(edited.Manifest.Parent?.ReleaseHash, Is.EqualTo(exported.Release.ContentHash));
            Assert.That(edited.ComposedSettings["composed/main.settings.json"].Content, Does.Contain("\"consumer\": 2"));
        });
    }

    private static void Write(string root, string relative, string content) {
        var path = Path.Combine(root, relative.Replace('/', Path.DirectorySeparatorChar));
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        File.WriteAllText(path, content);
    }
}
