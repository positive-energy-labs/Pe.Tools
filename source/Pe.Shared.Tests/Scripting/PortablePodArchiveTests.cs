using Newtonsoft.Json.Linq;
using Pe.Revit.Scripting.Bootstrap;
using Pe.Revit.Scripting.Context;
using Pe.Revit.Scripting.Execution;
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
    public void Independent_import_flattens_settings_and_keeps_identity_when_folder_changes() {
        var workspace = this._resolve("author");
        Write(workspace, "pod.json", """{"schemaVersion":2,"id":"lineage","name":"Example","version":"1"}""");
        Write(workspace, "settings/base.settings.json", "{\"value\":1}");
        Write(workspace, "settings/main.settings.json", "{\"$preset\":\"@local/base.settings.json\",\"other\":2}");
        var archivePath = Path.Combine(this._root, "independent.zip");
        var exported = this._service.Export(new ScriptPodExportRequest("author", archivePath), "net8.0-windows");
        Assert.That(exported.Status, Is.EqualTo(ScriptPodTransferStatus.Succeeded));
        var imported = this._service.Import(new ScriptPodImportRequest(archivePath, "My Office Copy", Independent: true),
            "2025", "net8.0-windows", typeof(PeScriptContainer).Assembly.Location);
        Assert.That(imported.Status, Is.EqualTo(ScriptPodTransferStatus.Succeeded), string.Join("; ", imported.Diagnostics.Select(d => d.Message)));
        var copy = this._resolve("My Office Copy");
        Assert.That(File.ReadAllText(Path.Combine(copy, "settings/main.settings.json")), Does.Not.Contain("$preset"));
        Assert.That(File.ReadAllText(Path.Combine(copy, "inspection/ancestor/settings/main.settings.json")), Does.Contain("$preset"));
        Directory.Move(copy, this._resolve("Renamed Again"));
        Write(this._resolve("Renamed Again"), "settings/main.settings.json", "{\"value\":99}");
        var prepared = this._preparation.Prepare("Renamed Again");
        Assert.That(prepared.Success, Is.True, string.Join("; ", prepared.Outcomes.Select(o => o.Reason)));
        Assert.That(((PreparedPod)prepared).Manifest.Id, Is.EqualTo("lineage"));
        Assert.That(((PreparedPod)prepared).Manifest.Parent!.ReleaseHash, Is.EqualTo(exported.Release!.ContentHash));
        Assert.That(((PreparedPod)prepared).ReleaseHash, Is.Null);
        Assert.That(((PreparedPod)prepared).ComposedSettings["composed/main.settings.json"].Content, Does.Contain("99"));
    }

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
            Assert.That(((PreparedPod)prepared).ContentHash, Is.EqualTo(exported.Release!.ContentHash));
            Assert.That(((PreparedPod)prepared).Manifest.Parent, Is.Null);
        });
        var republishedPath = Path.Combine(this._root, "republished.zip");
        var republished = this._service.Export(new ScriptPodExportRequest("portable", republishedPath), "net8.0-windows");
        Assert.That(republished.Status, Is.EqualTo(ScriptPodTransferStatus.Succeeded));
        var secondCopy = this._service.Import(new ScriptPodImportRequest(republishedPath, "Another Copy"), "2025", "net8.0-windows", typeof(PeScriptContainer).Assembly.Location);
        Assert.That(secondCopy.Status, Is.EqualTo(ScriptPodTransferStatus.Succeeded), string.Join("; ", secondCopy.Diagnostics.Select(d => d.Message)));
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
        var libraryHash = ((PreparedPod)this._preparation.Prepare("library")).ContentHash;
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
            Assert.That(((PreparedPod)unchanged).ContentHash, Is.EqualTo(exported.Release!.ContentHash));
            Assert.That(((PreparedPod)unchanged).ReleaseHash, Is.EqualTo(exported.Release.ContentHash));
            Assert.That(((PreparedPod)unchanged).ComposedSettings["composed/main.settings.json"].Content, Does.Contain("\"library\": 1"));
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
        Assert.That(editedWithoutDependency, Is.TypeOf<RejectedPod>());

        Write(library, "pod.json", """
            {"schemaVersion":2,"id":"library","name":"Library","version":"1.0.0","entrypoints":[]}
            """);
        Write(library, "settings/base.settings.json", "{\"library\":1}");
        var edited = this._preparation.Prepare("consumer");
        Assert.Multiple(() => {
            Assert.That(edited.Success, Is.True, string.Join("; ", edited.Outcomes.Select(outcome => outcome.Reason)));
            Assert.That(((PreparedPod)edited).ContentHash, Is.Not.EqualTo(exported.Release!.ContentHash));
            Assert.That(((PreparedPod)edited).ReleaseHash, Is.Null);
            Assert.That(((PreparedPod)edited).Manifest.Parent?.ReleaseHash, Is.EqualTo(exported.Release.ContentHash));
            Assert.That(((PreparedPod)edited).ComposedSettings["composed/main.settings.json"].Content, Does.Contain("\"consumer\": 2"));
        });
    }

    [Test]
    public void Native_capture_skips_an_installed_incompatible_sibling_for_an_exact_release() {
        var library = this._resolve("library");
        Write(library, "pod.json", """
            {"schemaVersion":2,"id":"library","name":"Library","version":"1.0.0","entrypoints":[]}
            """);
        Write(library, "settings/base.settings.json", "{\"library\":1}");
        var libraryHash = ((PreparedPod)this._preparation.Prepare("library")).ContentHash;
        var consumer = this._resolve("consumer");
        Write(consumer, "pod.json", $$"""
            {"schemaVersion":2,"id":"consumer","name":"Consumer","version":"1.0.0","entrypoints":[{"id":"main","sourcePath":"src/Main.cs"}],"requires":[{"id":"library","releaseHash":"{{libraryHash}}"}]}
            """);
        Write(consumer, "src/Main.cs", "public sealed class Main : PeScriptContainer { public override void Execute() { } }");
        Write(consumer, "settings/main.settings.json", "{\"$preset\":\"@library/base.settings.json\"}");
        var archivePath = Path.Combine(this._root, "native-capture.zip");
        var exported = this._service.Export(new ScriptPodExportRequest("consumer", archivePath), "net8.0-windows", "2025");
        Assert.That(exported.Status, Is.EqualTo(ScriptPodTransferStatus.Succeeded));
        Directory.Delete(Path.Combine(this._root, "workspaces"), true);
        Assert.That(this._service.Import(new ScriptPodImportRequest(archivePath), "2025", "net8.0-windows",
            typeof(PeScriptContainer).Assembly.Location).Status, Is.EqualTo(ScriptPodTransferStatus.Succeeded));
        Write(library, "pod.json", "not json");

        var bundle = RevitScriptExecutionService.CapturePodSource("consumer", "src/Main.cs", this._resolve);
        var prepared = this._preparation.Prepare("consumer", bundle);

        Assert.Multiple(() => {
            Assert.That(bundle.Dependencies, Is.Empty);
            Assert.That(prepared.Success, Is.True, string.Join("; ", prepared.Outcomes.Select(outcome => outcome.Reason)));
            Assert.That(((PreparedPod)prepared).ReleaseHash, Is.EqualTo(exported.Release!.ContentHash));
        });
    }

    [Test]
    public void Imported_release_version_and_workspace_identity_edits_create_derivatives() {
        var workspace = this._resolve("portable");
        Write(workspace, "pod.json", """
            {"schemaVersion":2,"id":"portable","name":"Portable","version":"1.0.0","entrypoints":[]}
            """);
        Write(workspace, "settings/main.settings.json", "{\"value\":1}");
        var archivePath = Path.Combine(this._root, "derivative.zip");
        var exported = this._service.Export(new ScriptPodExportRequest("portable", archivePath), "net8.0-windows", "2025");
        Assert.That(exported.Status, Is.EqualTo(ScriptPodTransferStatus.Succeeded));
        Directory.Delete(workspace, true);
        Assert.That(this._service.Import(new ScriptPodImportRequest(archivePath), "2025", "net8.0-windows",
            typeof(PeScriptContainer).Assembly.Location).Status, Is.EqualTo(ScriptPodTransferStatus.Succeeded));

        var manifestPath = Path.Combine(workspace, "pod.json");
        var versionEdit = JObject.Parse(File.ReadAllText(manifestPath));
        versionEdit["version"] = "2.0.0";
        File.WriteAllText(manifestPath, versionEdit.ToString());
        var versioned = this._preparation.Prepare("portable");
        Assert.Multiple(() => {
            Assert.That(versioned.Success, Is.True, string.Join("; ", versioned.Outcomes.Select(outcome => outcome.Reason)));
            Assert.That(((PreparedPod)versioned).ReleaseHash, Is.Null);
            Assert.That(((PreparedPod)versioned).Manifest.Parent?.ReleaseHash, Is.EqualTo(exported.Release!.ContentHash));
            Assert.That(((PreparedPod)versioned).Manifest.Version, Is.EqualTo("2.0.0"));
        });

        var renamedWorkspace = this._resolve("portable-copy");
        Directory.Move(workspace, renamedWorkspace);
        var idEdit = JObject.Parse(File.ReadAllText(Path.Combine(renamedWorkspace, "pod.json")));
        idEdit["id"] = "portable-copy";
        File.WriteAllText(Path.Combine(renamedWorkspace, "pod.json"), idEdit.ToString());
        var renamed = this._preparation.Prepare("portable-copy");
        Assert.Multiple(() => {
            Assert.That(renamed.Success, Is.True, string.Join("; ", renamed.Outcomes.Select(outcome => outcome.Reason)));
            Assert.That(((PreparedPod)renamed).ReleaseHash, Is.Null);
            Assert.That(((PreparedPod)renamed).Manifest.Parent?.Id, Is.EqualTo("portable"));
            Assert.That(((PreparedPod)renamed).Manifest.Parent?.ReleaseHash, Is.EqualTo(exported.Release!.ContentHash));
        });
    }

    private static void Write(string root, string relative, string content) {
        var path = Path.Combine(root, relative.Replace('/', Path.DirectorySeparatorChar));
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        File.WriteAllText(path, content);
    }
}
