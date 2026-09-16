using Pe.Dev.RevitAutomation;
using Pe.Revit.Loader;
using Pe.Revit.ServiceClient;
using Pe.Shared.HostContracts.Scripting;
using Pe.Shared.HostContracts.Transport;
using Pe.Shared.Product;
using Pe.Shared.StorageRuntime;

namespace Pe.Revit.Tests;

[TestFixture]
public sealed class DeploymentRuntimeContractTests {
    [Test]
    public void Authored_and_runtime_paths_split_between_documents_and_local_app_data() {
        var documents = Path.Combine(Path.GetTempPath(), $"pe-documents-{Guid.NewGuid():N}");
        var localAppData = Path.Combine(Path.GetTempPath(), $"pe-localapp-{Guid.NewGuid():N}");

        try {
            var content = ProductUserContentLayout.ForCurrentUser(documents);
            Assert.That(
                content.PreferencesPath,
                Is.EqualTo(Path.Combine(documents, "Pe.Tools", "preferences.json"))
            );
            Assert.That(
                content.Scripting.RootPath,
                Is.EqualTo(Path.Combine(documents, "Pe.Tools", "Pods"))
            );
            Assert.That(
                content.InlineScripts.RootPath,
                Is.EqualTo(Path.Combine(documents, "Pe.Tools", "Pods", "default", "output", "inline"))
            );
            Assert.That(
                content.Output.RootPath,
                Is.EqualTo(Path.Combine(documents, "Pe.Tools", "Pods", "default", "output"))
            );
            var runtime = ProductRuntimeLayout.ForCurrentUser(localAppData);
            Assert.That(
                runtime.State.RootPath,
                Is.EqualTo(Path.Combine(localAppData, "Positive Energy", "Pe.Tools", "state"))
            );
            Assert.That(
                runtime.Logs.RootPath,
                Is.EqualTo(Path.Combine(localAppData, "Positive Energy", "Pe.Tools", "logs"))
            );
            Assert.That(
                runtime.Logs.HostLogPath,
                Is.EqualTo(Path.Combine(localAppData, "Positive Energy", "Pe.Tools", "logs", "host.log.txt"))
            );
            Assert.That(
                runtime.Logs.RevitAppLogPath,
                Is.EqualTo(Path.Combine(localAppData, "Positive Energy", "Pe.Tools", "logs", "revit.log.txt"))
            );
            Assert.That(
                runtime.State.ApsCredentialsPath,
                Is.EqualTo(Path.Combine(localAppData, "Positive Energy", "Pe.Tools", "state", "aps-auth", "credentials.json"))
            );
        } finally {
            TryDeleteDirectory(documents);
            TryDeleteDirectory(localAppData);
        }
    }

    [Test]
    public void Scripting_workspace_layout_accepts_only_single_slug_workspace_keys() {
        var rootPath = Path.Combine(Path.GetTempPath(), $"pe-workspaces-{Guid.NewGuid():N}");
        var layout = new ScriptingWorkspaceLayout(rootPath);

        Assert.That(layout.ResolveWorkspaceRoot(null), Is.EqualTo(Path.Combine(rootPath, ScriptingWorkspaceLayout.DefaultWorkspaceKey)));
        Assert.That(layout.ResolveWorkspaceRoot(""), Is.EqualTo(Path.Combine(rootPath, ScriptingWorkspaceLayout.DefaultWorkspaceKey)));
        Assert.That(layout.ResolveWorkspaceRoot("default"), Is.EqualTo(Path.Combine(rootPath, "default")));
        Assert.That(layout.ResolveWorkspaceRoot("connector-audit-25"), Is.EqualTo(Path.Combine(rootPath, "connector-audit-25")));
        Assert.That(layout.ResolvePodManifestPath("connector-audit-25"), Is.EqualTo(Path.Combine(rootPath, "connector-audit-25", "pod.json")));

        foreach (var invalidWorkspaceKey in new[] {
            "ConnectorAudit",
            "connector_audit",
            "connector audit",
            "connector.audit",
            "connector/audit",
            "connector\\audit",
            "connector--audit",
            "-connector",
            "connector-",
            "..",
            Path.Combine(rootPath, "connector")
        }) {
            var exception = Assert.Throws<ArgumentException>(() => layout.ResolveWorkspaceRoot(invalidWorkspaceKey));
            Assert.That(exception?.ParamName, Is.EqualTo("workspaceKey"));
        }
    }

    [Test]
    public void Revit_log_paths_resolve_to_local_app_data_runtime_logs() {
        var localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);

        var logs = ProductRuntimeLayout.ForCurrentUser().Logs;
        Assert.That(DevLogPathResolver.HostLogPath, Is.EqualTo(logs.HostLogPath));
        Assert.That(DevLogPathResolver.RevitAppLogPath, Is.EqualTo(logs.RevitAppLogPath));
        Assert.That(
            DevLogPathResolver.HostLogPath.StartsWith(Path.Combine(localAppData, "Positive Energy", "Pe.Tools", "logs"), StringComparison.OrdinalIgnoreCase),
            Is.True
        );
    }

    [Test]
    public void Host_service_identity_is_installed_global_and_dev_checkout_scoped() {
        const string sourceRoot = @"C:\Users\Alice\Repo\source\pe-tools\";

        Assert.Multiple(() => {
            Assert.That(
                HostEndpoint.ResolveServiceName("installed", null),
                Is.EqualTo("host")
            );
            Assert.That(
                HostEndpoint.ResolveServiceName("dev", sourceRoot),
                Is.EqualTo("host-source-a3684ea655f3")
            );
            Assert.That(
                HostEndpoint.SourceServiceName(sourceRoot.ToLowerInvariant()),
                Is.EqualTo(HostEndpoint.SourceServiceName(sourceRoot))
            );
        });
    }

    [Test]
    public void Vendored_service_discovery_reads_current_schema_three_receipts() {
        var appBase = Path.Combine(Path.GetTempPath(), $"pe-service-discovery-{Guid.NewGuid():N}");
        const string serviceName = "host-source-test";
        var serviceFile = PeServiceDiscovery.ServiceFilePath(appBase, serviceName);

        try {
            Directory.CreateDirectory(Path.GetDirectoryName(serviceFile)!);
            File.WriteAllText(
                serviceFile,
                $$"""
                {
                  "schemaVersion": 3,
                  "pid": {{Environment.ProcessId}},
                  "port": 58040,
                  "version": "dev",
                  "lane": "dev",
                  "health": "/host/status",
                  "sessionId": "tooling-proof"
                }
                """
            );

            var discovered = PeServiceDiscovery.TryDiscover(appBase, serviceName);

            Assert.Multiple(() => {
                Assert.That(discovered, Is.Not.Null);
                Assert.That(discovered!.Port, Is.EqualTo(58040));
                Assert.That(discovered.Health, Is.EqualTo("/host/status"));
                Assert.That(discovered.SessionId, Is.EqualTo("tooling-proof"));
            });
        } finally {
            TryDeleteDirectory(appBase);
        }
    }

    private static void TryDeleteDirectory(string path) {
        try {
            if (Directory.Exists(path))
                Directory.Delete(path, true);
        } catch {
            // Best-effort test cleanup.
        }
    }
}
