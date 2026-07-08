using Pe.Dev.RevitAutomation;
using Pe.Revit.Loader;
using Pe.Shared.HostContracts.Scripting;
using Pe.Shared.Product;
using Pe.Shared.StorageRuntime;

namespace Pe.Revit.Tests;

[TestFixture]
public sealed class DeploymentRuntimeContractTests {
    [Test]
    public void Authored_and_runtime_paths_split_between_documents_and_local_app_data() {
        var localAppData = Path.Combine(Path.GetTempPath(), $"pe-localapp-{Guid.NewGuid():N}");

        try {
            Assert.That(
                SettingsStorageLocations.GetDefaultBasePath().EndsWith(Path.Combine("Pe.Tools", "settings"), StringComparison.OrdinalIgnoreCase),
                Is.True
            );
            Assert.That(
                ScriptingWorkspaceLocations.GetDefaultBasePath().EndsWith(Path.Combine("Pe.Tools", "workspaces"), StringComparison.OrdinalIgnoreCase),
                Is.True
            );
            Assert.That(
                ProductUserContentLayout.ForCurrentUser().InlineScripts.RootPath.EndsWith(Path.Combine("Pe.Tools", "inline-scripts"), StringComparison.OrdinalIgnoreCase),
                Is.True
            );
            Assert.That(
                ProductUserContentLayout.ForCurrentUser().Output.RootPath.EndsWith(Path.Combine("Pe.Tools", "output"), StringComparison.OrdinalIgnoreCase),
                Is.True
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
        } finally {
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
    public void Storage_runtime_splits_settings_state_and_output_roots() {
        var moduleKey = $"TestModule-{Guid.NewGuid():N}";
        var settingsBasePath = Path.Combine(Path.GetTempPath(), $"pe-settings-{Guid.NewGuid():N}");
        var moduleStorage = new ModuleStorage(moduleKey, settingsBasePath);

        try {
            Assert.That(
                moduleStorage.DirectoryPath,
                Is.EqualTo(Path.Combine(Path.GetFullPath(settingsBasePath), moduleKey))
            );
            Assert.That(
                moduleStorage.State().DirectoryPath,
                Is.EqualTo(ProductRuntimeLayout.ForCurrentUser().State.ResolveModuleStatePath(moduleKey))
            );
            Assert.That(
                moduleStorage.Output().DirectoryPath,
                Is.EqualTo(ProductUserContentLayout.ForCurrentUser().Output.ResolveModuleOutputPath(moduleKey))
            );
            Assert.That(
                new GlobalStorage(settingsBasePath).Output().DirectoryPath,
                Is.EqualTo(ProductUserContentLayout.ForCurrentUser().Output.GlobalOutputPath)
            );
        } finally {
            TryDeleteDirectory(settingsBasePath);
            TryDeleteDirectory(ProductRuntimeLayout.ForCurrentUser().State.ResolveModuleStatePath(moduleKey));
            TryDeleteDirectory(ProductUserContentLayout.ForCurrentUser().Output.ResolveModuleOutputPath(moduleKey));
        }
    }

    [Test]
    public void State_storage_exact_dir_migrates_legacy_directory_once() {
        var rootPath = Path.Combine(Path.GetTempPath(), $"pe-state-migrate-{Guid.NewGuid():N}");
        var legacyDirectoryPath = Path.Combine(rootPath, "legacy");
        var destinationDirectoryPath = Path.Combine(rootPath, "destination");
        Directory.CreateDirectory(Path.Combine(legacyDirectoryPath, "nested"));
        File.WriteAllText(Path.Combine(legacyDirectoryPath, "nested", "state.json"), "{ \"value\": 1 }");

        try {
            var storage = StateStorage.ExactDir(destinationDirectoryPath, legacyDirectoryPath);

            Assert.That(storage.DirectoryPath, Is.EqualTo(Path.GetFullPath(destinationDirectoryPath)));
            Assert.That(
                File.Exists(Path.Combine(destinationDirectoryPath, "nested", "state.json")),
                Is.True
            );
        } finally {
            TryDeleteDirectory(rootPath);
        }
    }

    [Test]
    public void State_storage_exact_dir_skips_legacy_copy_when_destination_already_has_content() {
        var rootPath = Path.Combine(Path.GetTempPath(), $"pe-state-skip-{Guid.NewGuid():N}");
        var legacyDirectoryPath = Path.Combine(rootPath, "legacy");
        var destinationDirectoryPath = Path.Combine(rootPath, "destination");
        Directory.CreateDirectory(legacyDirectoryPath);
        Directory.CreateDirectory(destinationDirectoryPath);
        File.WriteAllText(Path.Combine(legacyDirectoryPath, "legacy.json"), "{ \"legacy\": true }");
        File.WriteAllText(Path.Combine(destinationDirectoryPath, "current.json"), "{ \"current\": true }");

        try {
            _ = StateStorage.ExactDir(destinationDirectoryPath, legacyDirectoryPath);

            Assert.That(File.Exists(Path.Combine(destinationDirectoryPath, "current.json")), Is.True);
            Assert.That(File.Exists(Path.Combine(destinationDirectoryPath, "legacy.json")), Is.False);
        } finally {
            TryDeleteDirectory(rootPath);
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
    public void Development_runtime_layout_keeps_only_runtime_host_in_dev_root() {
        var localAppData = Path.Combine(Path.GetTempPath(), $"pe-dev-layout-{Guid.NewGuid():N}");

        try {
            var developmentRuntime = ProductDevelopmentRuntimeLayout.ForCurrentUser(localAppData);

            Assert.That(
                developmentRuntime.RootPath,
                Is.EqualTo(Path.Combine(localAppData, "Positive Energy", "Pe.Tools", "dev"))
            );
            Assert.That(
                developmentRuntime.Binaries.HostDirectoryPath,
                Is.EqualTo(Path.Combine(localAppData, "Positive Energy", "Pe.Tools", "dev", "bin", "host"))
            );
        } finally {
            TryDeleteDirectory(localAppData);
        }
    }

    [Test]
    public void Development_runtime_layout_pins_the_self_hosted_dev_host_and_pea_launcher() {
        // The dev lane is self-hosted: PePayloadContext.Deployment is null, so PeRuntimeContext falls
        // back to these two paths. Pin them here (the installed lane is pinned by the InstalledProduct
        // grammar test below).
        var localAppData = Path.Combine(Path.GetTempPath(), $"pe-dev-runtime-{Guid.NewGuid():N}");

        try {
            var devHost = ProductDevelopmentRuntimeLayout.ForCurrentUser(localAppData).Binaries.HostExecutablePath;
            var peaLauncher = ProductRuntimeLayout.ForCurrentUser(localAppData).Binaries.PeaLauncherPath;

            Assert.That(
                devHost,
                Is.EqualTo(Path.Combine(localAppData, "Positive Energy", "Pe.Tools", "dev", "bin", "host", "Pe.Host.exe"))
            );
            Assert.That(
                peaLauncher,
                Is.EqualTo(Path.Combine(localAppData, "Positive Energy", "Pe.Tools", "bin", "pea", "pea.cmd"))
            );
        } finally {
            TryDeleteDirectory(localAppData);
        }
    }

    [Test]
    public void Installed_product_grammar_resolves_the_host_executable_and_pea_launcher() {
        // Consumer-side pin: the installed lane resolves host/pea through Pe.Revit.Loader's
        // InstalledProduct, so this fixtures a minimal install root (as `pe-revit install apply`
        // writes it) and asserts our payload names ("host", "pea") land where the launchers expect.
        // The full round-trip grammar contract is owned by the SDK repo's Loader.Tests.
        var appBase = Path.Combine(Path.GetTempPath(), $"pe-installed-product-{Guid.NewGuid():N}");
        const string hostVersion = "1.2.3";

        try {
            File.WriteAllText(
                Path.Combine(Directory.CreateDirectory(appBase).FullName, "product.payloads.json"),
                """
                {
                  "product": "Pe.Tools",
                  "vendor": "Positive Energy",
                  "payloads": [
                    { "type": "VersionedApp", "name": "host", "entry": "Pe.Host.exe" },
                    { "type": "PathShim", "name": "pea" }
                  ]
                }
                """
            );

            var hostVersionDir = Path.Combine(appBase, "bin", "host", "versions", hostVersion);
            Directory.CreateDirectory(hostVersionDir);
            File.WriteAllText(Path.Combine(appBase, "bin", "host", "current.txt"), hostVersion);
            var hostExe = Path.Combine(hostVersionDir, "Pe.Host.exe");
            File.WriteAllText(hostExe, string.Empty);

            var shimsDir = Directory.CreateDirectory(Path.Combine(appBase, "shims")).FullName;
            var peaShim = Path.Combine(shimsDir, "pea.cmd");
            File.WriteAllText(peaShim, "@echo off\r\n");

            var deployment = InstalledProduct.Open(appBase);
            Assert.That(deployment, Is.Not.Null);

            // Host: VersionedApp resolves versions/<current>/<entry>.
            Assert.That(deployment!.Resolve("host")?.EntryPath, Is.EqualTo(hostExe));

            // Pea launcher: pea is now a dev-only PathShim, and a PathShim always lands at
            // shims/<name>.cmd — the grammar the dev-lane pea shim resolves through.
            Assert.That(Path.Combine(deployment.ShimsDirectory, "pea.cmd"), Is.EqualTo(peaShim));
            Assert.That(File.Exists(Path.Combine(deployment.ShimsDirectory, "pea.cmd")), Is.True);
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
