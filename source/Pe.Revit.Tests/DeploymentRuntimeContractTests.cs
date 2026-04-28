using Pe.Dev.Cli;
using Pe.Dev.RevitAutomation;
using Pe.Shared.HostContracts.Protocol;
using Pe.Shared.HostContracts.Scripting;
using Pe.Shared.SettingsLayout;
using Pe.Shared.StorageRuntime;

namespace Pe.Revit.Tests;

[TestFixture]
public sealed class DeploymentRuntimeContractTests {
    [Test]
    public void Authored_and_runtime_paths_split_between_documents_and_local_app_data() {
        var localAppData = Path.Combine(Path.GetTempPath(), $"pe-localapp-{Guid.NewGuid():N}");

        try {
            Assert.That(
                SettingsStorageLocations.GetDefaultBasePath().EndsWith(Path.Combine("Pe.App"), StringComparison.OrdinalIgnoreCase),
                Is.True
            );
            Assert.That(
                ScriptingWorkspaceLocations.GetDefaultBasePath().EndsWith(Path.Combine("Pe.Scripting"), StringComparison.OrdinalIgnoreCase),
                Is.True
            );
            Assert.That(
                DeploymentRuntimeLocations.GetStateRootPath(localAppData),
                Is.EqualTo(Path.Combine(localAppData, "Positive Energy", "Pe.Tools", "State"))
            );
            Assert.That(
                DeploymentRuntimeLocations.GetLogRootPath(localAppData),
                Is.EqualTo(Path.Combine(localAppData, "Positive Energy", "Pe.Tools", "Logs"))
            );
            Assert.That(
                GlobalStorageLocations.ResolveHostLogPath(localAppData),
                Is.EqualTo(Path.Combine(localAppData, "Positive Energy", "Pe.Tools", "Logs", "host.log.txt"))
            );
            Assert.That(
                GlobalStorageLocations.ResolveRevitAppLogPath(localAppData),
                Is.EqualTo(Path.Combine(localAppData, "Positive Energy", "Pe.Tools", "Logs", "revit.log.txt"))
            );
        } finally {
            TryDeleteDirectory(localAppData);
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

        Assert.That(DevLogPathResolver.HostLogPath, Is.EqualTo(GlobalStorageLocations.ResolveHostLogPath()));
        Assert.That(DevLogPathResolver.RevitAppLogPath, Is.EqualTo(GlobalStorageLocations.ResolveRevitAppLogPath()));
        Assert.That(
            DevLogPathResolver.HostLogPath.StartsWith(Path.Combine(localAppData, "Positive Energy", "Pe.Tools", "Logs"), StringComparison.OrdinalIgnoreCase),
            Is.True
        );
    }

    [Test]
    public void Session_options_accept_json_flag() {
        var options = RevitSessionOptions.Parse(["--json"]);

        Assert.That(options.JsonOutput, Is.True);
    }

    [Test]
    public void Session_exit_code_is_nonzero_when_no_host_or_process_sessions_exist() {
        var report = RevitCommandRunner.CreateSessionReport([], null);

        Assert.That(RevitCommandRunner.GetSessionExitCode(report), Is.EqualTo(3));
    }

    [Test]
    public void Session_exit_code_is_zero_when_host_has_connected_sessions() {
        var report = RevitCommandRunner.CreateSessionReport([], CreateHostStatusData(sessionCount: 1));

        Assert.That(RevitCommandRunner.GetSessionExitCode(report), Is.EqualTo(0));
    }

    [Test]
    public void Session_report_preserves_multiple_host_sessions() {
        var hostStatus = CreateHostStatusData(sessionCount: 2);
        var report = RevitCommandRunner.CreateSessionReport([], hostStatus);

        Assert.That(report.HostReachable, Is.True);
        Assert.That(report.HostStatus?.Sessions.Count, Is.EqualTo(2));
    }

    private static HostStatusData CreateHostStatusData(int sessionCount) {
        var sessions = Enumerable.Range(1, sessionCount)
            .Select(index => new HostSessionData(
                $"session-{index}",
                "2025",
                1000 + index,
                false,
                null,
                null,
                null,
                false,
                false,
                false,
                null,
                null,
                null,
                0,
                0,
                "net8.0-windows",
                BridgeProtocol.ContractVersion,
                BridgeProtocol.Transport,
                [],
                0
            ))
            .ToList();

        return new HostStatusData(
            true,
            sessionCount != 0,
            false,
            null,
            null,
            null,
            false,
            false,
            false,
            null,
            null,
            null,
            0,
            0,
            "2025",
            "net8.0-windows",
            HostProtocol.ContractVersion,
            HostProtocol.Transport,
            SettingsEditorRuntime.RuntimeIdentity,
            SettingsEditorRuntime.DefaultPipeName,
            "1.0.0",
            BridgeProtocol.ContractVersion,
            BridgeProtocol.Transport,
            [],
            null,
            sessions.FirstOrDefault()?.SessionId,
            0,
            sessions
        );
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
