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

    [SetUp]
    public void SetUp() {
        this._root = Path.Combine(Path.GetTempPath(), "portable-pod-archive-tests", Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(this._root);
        string Resolve(string id) => Path.Combine(this._root, "workspaces", id);
        var generator = new ScriptProjectGenerator(new CsProjReader());
        var bootstrap = new ScriptWorkspaceBootstrapService(generator, Resolve, Path.Combine(this._root, "product"));
        this._service = new ScriptPodArchiveService(bootstrap, generator, Resolve);
    }

    [TearDown]
    public void TearDown() => Directory.Delete(this._root, true);

    [Test]
    public void Export_import_verifies_content_excludes_outputs_and_records_parent_release() {
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
        Assert.Multiple(() => {
            Assert.That(imported.Status, Is.EqualTo(ScriptPodTransferStatus.Succeeded));
            Assert.That(manifest["parent"]?["id"]?.Value<string>(), Is.EqualTo("portable"));
            Assert.That(manifest["parent"]?["releaseHash"]?.Value<string>(), Is.EqualTo(exported.Release!.ContentHash));
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

    private static void Write(string root, string relative, string content) {
        var path = Path.Combine(root, relative.Replace('/', Path.DirectorySeparatorChar));
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        File.WriteAllText(path, content);
    }
}
