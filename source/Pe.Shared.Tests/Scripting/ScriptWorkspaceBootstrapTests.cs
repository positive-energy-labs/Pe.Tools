using Pe.Revit.Scripting.Bootstrap;
using Pe.Revit.Scripting.References;
using Pe.Shared.Product;

namespace Pe.Revit.Tests;

/// <summary>
///     Bootstrap owns exactly one rewritten file. Everything else it writes is the user's to edit,
///     and a second bootstrap must leave those edits alone.
/// </summary>
[TestFixture]
public sealed class ScriptWorkspaceBootstrapTests {
    [Test]
    public void Second_bootstrap_rewrites_only_the_root_agents_file() {
        var root = Path.Combine(Path.GetTempPath(), $"pe-bootstrap-{Guid.NewGuid():N}");
        var productHome = Path.Combine(root, "Pe.Tools");
        var podRoot = Path.Combine(productHome, ProductPathNames.PodsDirectoryName, "sample-pod");
        var service = new ScriptWorkspaceBootstrapService(
            new ScriptProjectGenerator(new CsProjReader()),
            _ => podRoot,
            productHome
        );

        try {
            _ = Bootstrap(service);

            var rootAgentsPath = Path.Combine(productHome, ProductPathNames.AgentInstructionsFileName);
            var rootReadmePath = Path.Combine(productHome, ProductPathNames.ReadmeFileName);
            var podAgentsPath = Path.Combine(podRoot, ProductPathNames.AgentInstructionsFileName);
            var podReadmePath = Path.Combine(podRoot, ProductPathNames.ReadmeFileName);

            File.WriteAllText(rootAgentsPath, "stale guidance from an older build");
            File.WriteAllText(podAgentsPath, "# My pod\n\nNotes I wrote by hand.");
            File.WriteAllText(podReadmePath, "My own README.");
            var rootReadmeBefore = File.ReadAllText(rootReadmePath);

            var second = Bootstrap(service);
            var rootAgents = File.ReadAllText(rootAgentsPath);
            var podAgents = File.ReadAllText(podAgentsPath);

            Assert.Multiple(() => {
                Assert.That(rootAgents, Is.Not.EqualTo("stale guidance from an older build"));
                Assert.That(podAgents, Is.EqualTo("# My pod\n\nNotes I wrote by hand."));
                Assert.That(File.ReadAllText(podReadmePath), Is.EqualTo("My own README."));
                Assert.That(File.ReadAllText(rootReadmePath), Is.EqualTo(rootReadmeBefore));

                Assert.That(second.GeneratedFiles, Does.Contain(rootAgentsPath));
                Assert.That(second.GeneratedFiles, Does.Not.Contain(podAgentsPath));
                Assert.That(second.GeneratedFiles, Does.Not.Contain(podReadmePath));
                Assert.That(second.GeneratedFiles, Does.Not.Contain(rootReadmePath));

                Assert.That(
                    Directory.EnumerateFiles(productHome, "JOIN_GUIDE.md", SearchOption.AllDirectories),
                    Is.Empty
                );

                // The root file is the one high-level guide: concepts, pointers, and the bootstrap contract.
                Assert.That(rootAgents, Does.Contain("## Bootstrap"));
                Assert.That(rootAgents, Does.Contain("pea script execute"));
                Assert.That(rootAgents, Does.Contain("/pods"));
                Assert.That(rootAgents, Does.Contain(".agents/skills/"));
                Assert.That(rootAgents, Does.Contain("$schema"));
                Assert.That(rootAgents, Does.Contain(ScriptingWorkspaceLayout.ProjectFileName));
                Assert.That(rootAgents, Does.Not.Contain("workspace"));
            });
        } finally {
            TryDeleteDirectory(root);
        }
    }

    [Test]
    public void Bootstrap_creates_the_pod_shape_and_no_join_guide() {
        var root = Path.Combine(Path.GetTempPath(), $"pe-bootstrap-{Guid.NewGuid():N}");
        var productHome = Path.Combine(root, "Pe.Tools");
        var podRoot = Path.Combine(productHome, ProductPathNames.PodsDirectoryName, "sample-pod");
        var service = new ScriptWorkspaceBootstrapService(
            new ScriptProjectGenerator(new CsProjReader()),
            _ => podRoot,
            productHome
        );

        try {
            _ = Bootstrap(service);
            var podAgents = File.ReadAllText(Path.Combine(podRoot, ProductPathNames.AgentInstructionsFileName));

            Assert.Multiple(() => {
                foreach (var directoryName in new[] {
                    ScriptingWorkspaceLayout.SourceDirectoryName,
                    ProductPathNames.SettingsDirectoryName,
                    ProductPathNames.AssetsDirectoryName,
                    ProductPathNames.OutputDirectoryName,
                    ScriptingWorkspaceLayout.VsCodeDirectoryName
                })
                    Assert.That(Directory.Exists(Path.Combine(podRoot, directoryName)), Is.True, directoryName);

                Assert.That(File.Exists(Path.Combine(podRoot, ProductPathNames.PodManifestFileName)), Is.True);
                Assert.That(File.Exists(Path.Combine(podRoot, ScriptingWorkspaceLayout.ProjectFileName)), Is.True);
                Assert.That(File.Exists(Path.Combine(podRoot, "JOIN_GUIDE.md")), Is.False);

                // The pod file is local only; the concepts live one level up.
                Assert.That(podAgents, Does.Contain($"../../{ProductPathNames.AgentInstructionsFileName}"));
                Assert.That(podAgents, Does.Not.Contain("workspace"));
            });
        } finally {
            TryDeleteDirectory(root);
        }
    }

    private static Pe.Shared.HostContracts.Scripting.ScriptWorkspaceBootstrapData Bootstrap(
        ScriptWorkspaceBootstrapService service
    ) =>
        service.Bootstrap(
            "sample-pod",
            createSampleScript: true,
            revitVersion: "2026",
            targetFramework: "net8.0-windows",
            runtimeAssemblyPath: Path.Combine(Path.GetTempPath(), "Pe.Revit.Scripting.dll")
        );

    private static void TryDeleteDirectory(string path) {
        try {
            if (Directory.Exists(path))
                Directory.Delete(path, true);
        } catch (IOException) {
            // A locked temp file is not a test failure.
        }
    }
}
