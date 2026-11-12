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
            var content = ProductUserContentLayout.ForCurrentUser(Path.Combine(documents, "Pe.Tools"));
            Assert.That(
                content.Scripting.RootPath,
                Is.EqualTo(Path.Combine(documents, "Pe.Tools", "Pods"))
            );
            var runtime = ProductRuntimeLayout.For(ProductLane.Installed, Path.Combine(localAppData, "Positive Energy", "Pe.Tools"), null);
            // Run output and the agent guide are machine state under state\, never under Documents.
            Assert.That(
                runtime.State.PodlessRunsPath,
                Is.EqualTo(Path.Combine(localAppData, "Positive Energy", "Pe.Tools", "state", "Runs", "_no-pod"))
            );
            Assert.That(
                runtime.State.AgentInstructionsPath,
                Is.EqualTo(Path.Combine(localAppData, "Positive Energy", "Pe.Tools", "state", "Agent", "AGENTS.md"))
            );
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

    // F6 (acceptance round 3): Revit-side script output landed in the owner's OneDrive Pods because
    // this side ignored the override the host honoured. One variable names the whole home. Since ADR 0037
    // the home holds authored content only, so output and inline traces are checked out of it instead.
    [Test, NonParallelizable]
    public void Product_home_override_roots_every_user_content_path() {
        var home = Path.Combine(Path.GetTempPath(), $"pe-home-{Guid.NewGuid():N}", "Pe.Tools");
        var previous = Environment.GetEnvironmentVariable(ProductPathNames.ProductHomeVariable);
        Environment.SetEnvironmentVariable(ProductPathNames.ProductHomeVariable, home);
        try {
            var content = ProductUserContentLayout.ForCurrentUser();
            var paths = new[] {
                content.RootPath,
                content.Scripting.RootPath,
                ScriptingWorkspaceLocations.ResolveWorkspaceRoot("accept-r3-snowdon")
            };
            Assert.That(content.RootPath, Is.EqualTo(home));
            Assert.That(content.Scripting.RootPath, Is.EqualTo(Path.Combine(home, "Pods")));
            foreach (var path in paths) {
                Assert.That(path.StartsWith(home, StringComparison.OrdinalIgnoreCase), Is.True, path);
            }
            // Mutant, run red once: point ModuleStorage.Output back at the user home fails both lines.
            var state = ProductRuntimeLayout.Current.State.RootPath;
            // Module output is not run-shaped, so it sits beside the pod-less runs, never among them.
            Assert.That(new ModuleStorage("census").Output().DirectoryPath, Is.EqualTo(Path.Combine(state, "Runs", "_modules", "census")));
            foreach (var path in new[] {
                         new ModuleStorage("census").Output().DirectoryPath,
                         Pe.Revit.Scripting.Storage.RevitScriptingStorageLocations.ResolveInlineTraceDirectory()
                     }) {
                Assert.That(path.StartsWith(state, StringComparison.OrdinalIgnoreCase), Is.True, path);
                Assert.That(path.StartsWith(home, StringComparison.OrdinalIgnoreCase), Is.False, path);
            }
        } finally {
            Environment.SetEnvironmentVariable(ProductPathNames.ProductHomeVariable, previous);
            TryDeleteDirectory(Path.GetDirectoryName(home)!);
        }
    }

    // ADR 0037: the dev override names the firm home and never moves machine state; the user home stays under
    // Documents unless an isolated home replaces it.
    [Test, NonParallelizable]
    public void The_firm_override_never_moves_machine_state_or_the_user_home() {
        const string sharedVariable = "PE_TOOLS_SHARED_ROOT";
        var shared = Path.Combine(Path.GetTempPath(), $"pe-shared-{Guid.NewGuid():N}");
        var isolated = Path.Combine(Path.GetTempPath(), $"pe-isolated-{Guid.NewGuid():N}");
        var previousHome = Environment.GetEnvironmentVariable(ProductPathNames.ProductHomeVariable);
        var previousShared = Environment.GetEnvironmentVariable(sharedVariable);
        var documents = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments), "Pe.Tools");
        Environment.SetEnvironmentVariable(ProductPathNames.ProductHomeVariable, null);
        Environment.SetEnvironmentVariable(sharedVariable, shared);
        try {
            Assert.That(ProductPathNames.SharedRootVariable, Is.EqualTo(sharedVariable));
            var content = ProductUserContentLayout.ForCurrentUser();
            Assert.That(content.RootPath, Is.EqualTo(documents));
            Assert.That(content.Scripting.RootPath, Is.EqualTo(Path.Combine(documents, "Pods")));
            // The override is read from the environment and still needs its marker: none, so no firm home.
            Assert.That(ProductPathing.Homes().List, Is.EqualTo(new[] { documents }));
            Directory.CreateDirectory(shared);
            File.WriteAllText(Path.Combine(shared, ProductPathNames.HomeMarkerFileName), "{\"tier\":\"firm\"}");
            Assert.That(ProductPathing.Homes().List, Is.EqualTo(new[] { documents, shared }));
            Assert.That(ProductPathing.Homes().FirmSettingsDir, Is.EqualTo(Path.Combine(shared, "Settings")));
            Assert.That(ProductRuntimeLayout.For(ProductLane.Dev, @"C:\src\Pe.Tools", null).RootPath, Is.EqualTo(@"C:\src\Pe.Tools\.artifacts\pe-tools"));
            Assert.That(() => ProductRuntimeLayout.For(ProductLane.Dev, Path.Combine(documents, "checkout"), null),
                Throws.ArgumentException.With.Message.Contains("the user content root"));
            Environment.SetEnvironmentVariable(ProductPathNames.ProductHomeVariable, isolated);
            Assert.That(ProductUserContentLayout.ForCurrentUser().RootPath, Is.EqualTo(isolated));
            Assert.That(ProductRuntimeLayout.For(ProductLane.Dev, @"C:\src\Pe.Tools", isolated).RootPath, Is.EqualTo(Path.Combine(isolated, ".local-state")));
        } finally {
            Environment.SetEnvironmentVariable(ProductPathNames.ProductHomeVariable, previousHome);
            Environment.SetEnvironmentVariable(sharedVariable, previousShared);
            if (Directory.Exists(shared)) Directory.Delete(shared, true);
        }
    }

    // ADV2-S4: acceptance hosts on worktrees shared the owner's %LOCALAPPDATA% state. The one
    // override roots machine-local state too, under <home>\.local-state, matching the host's productRoot.
    [Test]
    public void Product_home_override_roots_machine_local_state_and_logs_and_nothing_resolves_under_local_app_data() {
        var home = Path.Combine(Path.GetTempPath(), $"pe-home-{Guid.NewGuid():N}", "Pe.Tools");
        var ownerRoot = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Positive Energy", "Pe.Tools");
        var runtime = ProductRuntimeLayout.For(ProductLane.Dev, @"C:\src\Pe.Tools", home);
        var state = Path.Combine(home, ".local-state");
        Assert.That(runtime.RootPath, Is.EqualTo(state));
        var paths = new[] {
            runtime.State.RootPath,
            runtime.State.ApsCredentialsPath,
            runtime.State.ApsTokenStorePath,
            runtime.Logs.HostLogPath,
            runtime.Cache.ResolveModuleCachePath("census"),
            PeServiceDiscovery.ServiceFilePath(runtime.RootPath, "pe-host-source-test")
        };
        foreach (var path in paths) {
            Assert.That(path.StartsWith(state, StringComparison.OrdinalIgnoreCase), Is.True, path);
            Assert.That(path.StartsWith(ownerRoot, StringComparison.OrdinalIgnoreCase), Is.False, path);
        }
    }

    // Libraries never resolve their own root: storage, the bridge supervisor's lease and the dev logs all
    // follow the one runtime the shell configured (this assembly's TestRuntime).
    [Test]
    public void Library_storage_and_the_bridge_supervisor_follow_the_configured_runtime() {
        var root = ProductRuntimeLayout.Current.RootPath;
        foreach (var path in new[] {
                     new GlobalStorage().DirectoryPath,
                     new ModuleStorage("census").State().DirectoryPath,
                     Pe.App.Host.TsHostLauncher.ServiceAppBase,
                     DevLogPathResolver.HostLogPath,
                     DevLogPathResolver.RevitAppLogPath
                 })
            Assert.That(path.StartsWith(root, StringComparison.OrdinalIgnoreCase), Is.True, path);
    }

    [Test]
    public void Scripting_workspace_layout_accepts_local_names_and_refuses_path_escape() {
        var rootPath = Path.Combine(Path.GetTempPath(), $"pe-workspaces-{Guid.NewGuid():N}");
        var layout = new ScriptingWorkspaceLayout(rootPath);

        Assert.That(layout.ResolveWorkspaceRoot(null), Is.EqualTo(Path.Combine(rootPath, ScriptingWorkspaceLayout.DefaultWorkspaceKey)));
        Assert.That(layout.ResolveWorkspaceRoot(""), Is.EqualTo(Path.Combine(rootPath, ScriptingWorkspaceLayout.DefaultWorkspaceKey)));
        Assert.That(layout.ResolveWorkspaceRoot("default"), Is.EqualTo(Path.Combine(rootPath, "default")));
        Assert.That(layout.ResolveWorkspaceRoot("connector-audit-25"), Is.EqualTo(Path.Combine(rootPath, "connector-audit-25")));
        Assert.That(layout.ResolvePodManifestPath("connector-audit-25"), Is.EqualTo(Path.Combine(rootPath, "connector-audit-25", "pod.json")));

        Assert.That(layout.ResolveWorkspaceRoot("Office Standards"), Is.EqualTo(Path.Combine(rootPath, "Office Standards")));

        foreach (var invalidWorkspaceKey in new[] {
            "connector/audit",
            "connector\\audit",
            "..",
            Path.Combine(rootPath, "connector")
        }) {
            var exception = Assert.Throws<ArgumentException>(() => layout.ResolveWorkspaceRoot(invalidWorkspaceKey));
            Assert.That(exception?.ParamName, Is.EqualTo("workspaceKey"));
        }
    }

    [Test]
    public void Host_service_identity_is_installed_global_and_dev_checkout_scoped() {
        const string sourceRoot = @"C:\Users\Alice\Repo\";

        Assert.Multiple(() => {
            Assert.That(
                HostEndpoint.ResolveServiceName(ProductRuntimeLayout.For(ProductLane.Installed, @"C:\Users\Alice\AppData\Local\Positive Energy\Pe.Tools", null)),
                Is.EqualTo("host")
            );
            Assert.That(
                HostEndpoint.ResolveServiceName(ProductRuntimeLayout.For(ProductLane.Dev, sourceRoot, null)),
                Is.EqualTo("host-source-56fd8a189f7e")
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
