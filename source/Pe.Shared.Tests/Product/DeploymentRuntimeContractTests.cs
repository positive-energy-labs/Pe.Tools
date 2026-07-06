using Pe.Dev.RevitAutomation;
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
    public void Runtime_authority_resolves_lane_specific_host_and_stable_pea_launcher() {
        var localAppData = Path.Combine(Path.GetTempPath(), $"pe-runtime-authority-{Guid.NewGuid():N}");

        try {
            var devResolution = ProductRuntimeAuthority.ResolveForCurrentMachine(ProductRuntimeLane.Dev, localAppData);
            var installedResolution = ProductRuntimeAuthority.ResolveForCurrentMachine(ProductRuntimeLane.Installed, localAppData);

            Assert.That(
                devResolution.HostExecutablePath,
                Is.EqualTo(Path.Combine(localAppData, "Positive Energy", "Pe.Tools", "dev", "bin", "host", "Pe.Host.exe"))
            );
            Assert.That(
                installedResolution.HostExecutablePath,
                Is.EqualTo(Path.Combine(localAppData, "Positive Energy", "Pe.Tools", "bin", "host", "Pe.Host.exe"))
            );
            Assert.That(devResolution.PeaLauncherPath, Is.EqualTo(installedResolution.PeaLauncherPath));
        } finally {
            TryDeleteDirectory(localAppData);
        }
    }

    [Test]
    public void Runtime_descriptor_roundtrips_and_drives_resolution_for_executing_pe_app_assembly() {
        var rootPath = Path.Combine(Path.GetTempPath(), $"pe-runtime-descriptor-{Guid.NewGuid():N}");
        var assemblyDirectory = Path.Combine(rootPath, "Pe.App");
        var assemblyPath = Path.Combine(assemblyDirectory, "Pe.App.dll");
        Directory.CreateDirectory(assemblyDirectory);
        File.WriteAllText(assemblyPath, string.Empty);
        var descriptorPath = RevitDeploymentIdentity.ResolveRuntimeDescriptorPathForAssembly(assemblyPath);
        File.WriteAllText(
            descriptorPath,
            """
            {
              "schemaVersion": 1,
              "productName": "Pe.Tools",
              "runtimeLane": "Dev",
              "configuration": "Debug.R25"
            }
            """
        );

        try {
            var descriptor = PeAppRuntimeDeploymentDescriptor.Load(descriptorPath);
            var resolution = ProductRuntimeAuthority.ResolveForExecutingPeAppAssembly(assemblyPath);

            Assert.That(descriptor.RuntimeLane, Is.EqualTo(ProductRuntimeLane.Dev));
            Assert.That(resolution.RuntimeLane, Is.EqualTo(ProductRuntimeLane.Dev));
            Assert.That(resolution.DescriptorPath, Is.EqualTo(descriptorPath));
            Assert.That(resolution.Source, Is.EqualTo("runtime-descriptor"));
        } finally {
            TryDeleteDirectory(rootPath);
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
