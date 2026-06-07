using Pe.Revit.Scripting.Bootstrap;
using Pe.Revit.Scripting.Context;
using Pe.Revit.Scripting.Pods;
using Pe.Revit.Scripting.References;
using Pe.Revit.Scripting.Storage;
using Pe.Shared.HostContracts.Scripting;
using System.IO.Compression;

namespace Pe.Revit.Tests;

[TestFixture]
public sealed class RevitScriptingPodArchiveTests {
    [Test]
    public void Import_rejects_existing_workspace_with_diagnostics() {
        var workspaceKey = $"pod-{Guid.NewGuid():N}";
        var workspaceRoot = RevitScriptingStorageLocations.ResolveWorkspaceRoot(workspaceKey);
        var archivePath = CreateArchivePath();

        try {
            Directory.CreateDirectory(workspaceRoot);
            CreatePodArchive(archivePath, workspaceKey);

            var result = CreateArchiveService().Import(
                new ScriptPodImportRequest(archivePath),
                "2025",
                "net8.0-windows",
                typeof(PeScriptContainer).Assembly.Location
            );

            Assert.That(result.Status, Is.EqualTo(ScriptPodTransferStatus.Rejected));
            Assert.That(result.Diagnostics.Select(diagnostic => diagnostic.Message), Has.Some.Contain("already exists"));
        } finally {
            DeleteWorkspace(workspaceRoot);
            DeleteFile(archivePath);
        }
    }

    [Test]
    public void Import_rejects_unsafe_archive_paths_with_diagnostics() {
        var workspaceKey = $"pod-{Guid.NewGuid():N}";
        var workspaceRoot = RevitScriptingStorageLocations.ResolveWorkspaceRoot(workspaceKey);
        var archivePath = CreateArchivePath();

        try {
            using (var archive = ZipFile.Open(archivePath, ZipArchiveMode.Create)) {
                WriteEntry(archive, "pod.json", CreatePodManifest(workspaceKey));
                WriteEntry(archive, "src/Main.cs", "public sealed class MainScript : PeScriptContainer { public override void Execute() { } }");
                WriteEntry(archive, "../escape.txt", "nope");
            }

            var result = CreateArchiveService().Import(
                new ScriptPodImportRequest(archivePath),
                "2025",
                "net8.0-windows",
                typeof(PeScriptContainer).Assembly.Location
            );

            Assert.That(result.Status, Is.EqualTo(ScriptPodTransferStatus.Rejected));
            Assert.That(result.Diagnostics.Select(diagnostic => diagnostic.Message), Has.Some.Contain("unsafe path segment"));
            Assert.That(Directory.Exists(workspaceRoot), Is.False);
        } finally {
            DeleteWorkspace(workspaceRoot);
            DeleteFile(archivePath);
        }
    }

    [Test]
    public void Import_rejects_archive_entry_count_limit_with_diagnostics() {
        var workspaceKey = $"pod-{Guid.NewGuid():N}";
        var workspaceRoot = RevitScriptingStorageLocations.ResolveWorkspaceRoot(workspaceKey);
        var archivePath = CreateArchivePath();

        try {
            using (var archive = ZipFile.Open(archivePath, ZipArchiveMode.Create)) {
                WriteEntry(archive, "pod.json", CreatePodManifest(workspaceKey));
                WriteEntry(archive, "src/Main.cs", "public sealed class MainScript : PeScriptContainer { public override void Execute() { } }");
                for (var i = 0; i < 1000; i++)
                    WriteEntry(archive, $"data/{i}.txt", "x");
            }

            var result = CreateArchiveService().Import(
                new ScriptPodImportRequest(archivePath),
                "2025",
                "net8.0-windows",
                typeof(PeScriptContainer).Assembly.Location
            );

            Assert.That(result.Status, Is.EqualTo(ScriptPodTransferStatus.Rejected));
            Assert.That(result.Diagnostics.Select(diagnostic => diagnostic.Message), Has.Some.Contain("limit is 1000"));
            Assert.That(Directory.Exists(workspaceRoot), Is.False);
        } finally {
            DeleteWorkspace(workspaceRoot);
            DeleteFile(archivePath);
        }
    }

    [Test]
    public void Import_rejects_origin_version_mismatch_with_diagnostics() {
        var workspaceKey = $"pod-{Guid.NewGuid():N}";
        var workspaceRoot = RevitScriptingStorageLocations.ResolveWorkspaceRoot(workspaceKey);
        var originRoot = Path.Combine(Path.GetTempPath(), $"pod-origin-{Guid.NewGuid():N}");
        var archivePath = CreateArchivePath();

        try {
            Directory.CreateDirectory(originRoot);
            File.WriteAllText(Path.Combine(originRoot, "pod.json"), CreatePodManifest(workspaceKey, version: "2.0.0"));
            using (var archive = ZipFile.Open(archivePath, ZipArchiveMode.Create)) {
                WriteEntry(archive, "pod.json", CreatePodManifest(workspaceKey, version: "1.0.0", originPath: originRoot));
                WriteEntry(archive, "src/Main.cs", "public sealed class MainScript : PeScriptContainer { public override void Execute() { } }");
            }

            var result = CreateArchiveService().Import(
                new ScriptPodImportRequest(archivePath),
                "2025",
                "net8.0-windows",
                typeof(PeScriptContainer).Assembly.Location
            );

            Assert.That(result.Status, Is.EqualTo(ScriptPodTransferStatus.Rejected));
            Assert.That(result.Diagnostics.Select(diagnostic => diagnostic.Message), Has.Some.Contain("Reimport the Pod"));
            Assert.That(Directory.Exists(workspaceRoot), Is.False);
        } finally {
            DeleteWorkspace(workspaceRoot);
            DeleteWorkspace(originRoot);
            DeleteFile(archivePath);
        }
    }

    [Test]
    public void Export_rejects_origin_version_mismatch_with_diagnostics() {
        var workspaceKey = $"pod-{Guid.NewGuid():N}";
        var workspaceRoot = RevitScriptingStorageLocations.ResolveWorkspaceRoot(workspaceKey);
        var originRoot = Path.Combine(Path.GetTempPath(), $"pod-origin-{Guid.NewGuid():N}");
        var archivePath = CreateArchivePath();

        try {
            Directory.CreateDirectory(RevitScriptingStorageLocations.ResolveSourceDirectory(workspaceKey));
            Directory.CreateDirectory(originRoot);
            File.WriteAllText(Path.Combine(originRoot, "pod.json"), CreatePodManifest(workspaceKey, version: "2.0.0"));
            File.WriteAllText(RevitScriptingStorageLocations.ResolvePodManifestPath(workspaceKey), CreatePodManifest(workspaceKey, version: "1.0.0", originPath: originRoot));
            File.WriteAllText(
                Path.Combine(RevitScriptingStorageLocations.ResolveSourceDirectory(workspaceKey), "Main.cs"),
                "public sealed class MainScript : PeScriptContainer { public override void Execute() { } }"
            );
            File.WriteAllText(RevitScriptingStorageLocations.ResolveProjectFilePath(workspaceKey), "<Project></Project>");

            var result = CreateArchiveService().Export(new ScriptPodExportRequest(workspaceKey, archivePath), "net8.0-windows", "2025");

            Assert.That(result.Status, Is.EqualTo(ScriptPodTransferStatus.Rejected));
            Assert.That(result.Diagnostics.Select(diagnostic => diagnostic.Message), Has.Some.Contain("Reimport the Pod"));
            Assert.That(File.Exists(archivePath), Is.False);
        } finally {
            DeleteWorkspace(workspaceRoot);
            DeleteWorkspace(originRoot);
            DeleteFile(archivePath);
        }
    }

    [Test]
    public void Export_archive_excludes_generated_runtime_payloads_and_machine_references() {
        var workspaceKey = $"pod-{Guid.NewGuid():N}";
        var workspaceRoot = RevitScriptingStorageLocations.ResolveWorkspaceRoot(workspaceKey);
        var archivePath = CreateArchivePath();

        try {
            Directory.CreateDirectory(RevitScriptingStorageLocations.ResolveSourceDirectory(workspaceKey));
            Directory.CreateDirectory(Path.Combine(workspaceRoot, "data"));
            Directory.CreateDirectory(Path.Combine(workspaceRoot, ".vscode"));
            Directory.CreateDirectory(Path.Combine(workspaceRoot, "bin"));
            Directory.CreateDirectory(Path.Combine(workspaceRoot, "obj"));
            Directory.CreateDirectory(Path.Combine(workspaceRoot, "lib"));

            File.WriteAllText(RevitScriptingStorageLocations.ResolvePodManifestPath(workspaceKey), CreatePodManifest(workspaceKey));
            File.WriteAllText(RevitScriptingStorageLocations.ResolveReadmePath(workspaceKey), "# Pod");
            File.WriteAllText(RevitScriptingStorageLocations.ResolveAgentsPath(workspaceKey), "# Guidance");
            File.WriteAllText(
                Path.Combine(RevitScriptingStorageLocations.ResolveSourceDirectory(workspaceKey), "Main.cs"),
                "public sealed class MainScript : PeScriptContainer { public override void Execute() { } }"
            );
            File.WriteAllText(Path.Combine(workspaceRoot, "data", "input.json"), "{}");
            File.WriteAllText(Path.Combine(workspaceRoot, ".vscode", "settings.json"), "{}");
            File.WriteAllText(Path.Combine(workspaceRoot, "bin", "runtime.txt"), "generated");
            File.WriteAllText(Path.Combine(workspaceRoot, "obj", "runtime.txt"), "generated");
            File.WriteAllText(Path.Combine(workspaceRoot, "lib", "payload.dll"), "nope");
            File.WriteAllText(
                RevitScriptingStorageLocations.ResolveProjectFilePath(workspaceKey),
                """
                <Project Sdk="Microsoft.NET.Sdk">
                  <PropertyGroup>
                    <TargetFramework>net8.0-windows</TargetFramework>
                  </PropertyGroup>
                  <ItemGroup>
                    <Reference Include="MachineSpecific">
                      <HintPath>C:\temp\machine-specific.dll</HintPath>
                    </Reference>
                    <PackageReference Include="Example.Package" Version="1.2.3" />
                  </ItemGroup>
                </Project>
                """
            );

            var result = CreateArchiveService().Export(new ScriptPodExportRequest(workspaceKey, archivePath), "net8.0-windows", "2025");

            Assert.That(result.Status, Is.EqualTo(ScriptPodTransferStatus.Succeeded));
            Assert.That(result.ArchiveEntries, Does.Contain("pod.json"));
            Assert.That(result.ArchiveEntries, Does.Contain("PeScripts.csproj"));
            Assert.That(result.ArchiveEntries, Does.Contain("src/Main.cs"));
            Assert.That(result.ArchiveEntries, Does.Contain("data/input.json"));
            Assert.That(result.ArchiveEntries.Any(entry => entry.StartsWith(".vscode/", StringComparison.OrdinalIgnoreCase)), Is.False);
            Assert.That(result.ArchiveEntries.Any(entry => entry.StartsWith("bin/", StringComparison.OrdinalIgnoreCase)), Is.False);
            Assert.That(result.ArchiveEntries.Any(entry => entry.StartsWith("obj/", StringComparison.OrdinalIgnoreCase)), Is.False);
            Assert.That(result.ArchiveEntries.Any(entry => entry.EndsWith(".dll", StringComparison.OrdinalIgnoreCase)), Is.False);

            using var archive = ZipFile.OpenRead(archivePath);
            var projectEntry = archive.GetEntry("PeScripts.csproj");
            Assert.That(projectEntry, Is.Not.Null);
            var projectContent = ReadEntry(projectEntry!);
            Assert.That(projectContent, Does.Contain("""<Compile Include="src/**/*.cs" />"""));
            Assert.That(projectContent, Does.Contain("""<PackageReference Include="Example.Package" Version="1.2.3" />"""));
            Assert.That(projectContent, Does.Not.Contain("machine-specific.dll"));
            Assert.That(projectContent, Does.Not.Contain("<Reference Include=\"MachineSpecific\">"));
        } finally {
            DeleteWorkspace(workspaceRoot);
            DeleteFile(archivePath);
        }
    }

    [Test]
    public void Export_preserves_existing_archive_when_replacement_fails() {
        var workspaceKey = $"pod-{Guid.NewGuid():N}";
        var workspaceRoot = RevitScriptingStorageLocations.ResolveWorkspaceRoot(workspaceKey);
        var archivePath = CreateArchivePath();
        const string previousArchive = "previous archive content";

        try {
            Directory.CreateDirectory(RevitScriptingStorageLocations.ResolveSourceDirectory(workspaceKey));
            File.WriteAllText(RevitScriptingStorageLocations.ResolvePodManifestPath(workspaceKey), CreatePodManifest(workspaceKey));
            File.WriteAllText(
                Path.Combine(RevitScriptingStorageLocations.ResolveSourceDirectory(workspaceKey), "Main.cs"),
                "public sealed class MainScript : PeScriptContainer { public override void Execute() { } }"
            );
            File.WriteAllText(RevitScriptingStorageLocations.ResolveProjectFilePath(workspaceKey), "<Project>");
            File.WriteAllText(archivePath, previousArchive);

            var result = CreateArchiveService().Export(new ScriptPodExportRequest(workspaceKey, archivePath), "net8.0-windows", "2025");

            Assert.That(result.Status, Is.EqualTo(ScriptPodTransferStatus.Rejected));
            Assert.That(File.ReadAllText(archivePath), Is.EqualTo(previousArchive));
        } finally {
            DeleteWorkspace(workspaceRoot);
            DeleteFile(archivePath);
        }
    }

    private static ScriptPodArchiveService CreateArchiveService() {
        var csProjReader = new CsProjReader();
        var projectGenerator = new ScriptProjectGenerator(csProjReader);
        return new ScriptPodArchiveService(new ScriptWorkspaceBootstrapService(projectGenerator), projectGenerator);
    }

    private static void CreatePodArchive(string archivePath, string workspaceKey) {
        using var archive = ZipFile.Open(archivePath, ZipArchiveMode.Create);
        WriteEntry(archive, "pod.json", CreatePodManifest(workspaceKey));
        WriteEntry(archive, "src/Main.cs", "public sealed class MainScript : PeScriptContainer { public override void Execute() { } }");
    }

    private static string CreatePodManifest(string workspaceKey, string version = "1.0.0", string? originPath = null) {
        var originJson = originPath is null
            ? string.Empty
            : $$"""
              "origin": {
                "path": "{{originPath.Replace("\\", "\\\\")}}"
              },
        """;

        return $$"""
        {
          "schemaVersion": 1,
          "id": "{{workspaceKey}}",
          "name": "{{workspaceKey}}",
          "version": "{{version}}",
        {{originJson}}
          "entrypoints": [
            { "id": "main", "sourcePath": "src/Main.cs" }
          ]
        }
        """;
    }

    private static void WriteEntry(ZipArchive archive, string name, string content) {
        var entry = archive.CreateEntry(name);
        using var stream = entry.Open();
        using var writer = new StreamWriter(stream);
        writer.Write(content);
    }

    private static string ReadEntry(ZipArchiveEntry entry) {
        using var stream = entry.Open();
        using var reader = new StreamReader(stream);
        return reader.ReadToEnd();
    }

    private static string CreateArchivePath() =>
        Path.Combine(Path.GetTempPath(), $"pod-{Guid.NewGuid():N}.zip");

    private static void DeleteWorkspace(string workspaceRoot) {
        try {
            if (Directory.Exists(workspaceRoot))
                Directory.Delete(workspaceRoot, true);
        } catch {
            // Best effort temp cleanup.
        }
    }

    private static void DeleteFile(string path) {
        try {
            if (File.Exists(path))
                File.Delete(path);
        } catch {
            // Best effort temp cleanup.
        }
    }
}
