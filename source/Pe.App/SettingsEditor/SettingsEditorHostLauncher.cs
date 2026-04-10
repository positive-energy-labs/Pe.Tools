using System.Diagnostics;
using System.IO;
using System.Net.Http;
using Newtonsoft.Json;
using Pe.Shared.HostContracts.Protocol;

namespace Pe.Tools.SettingsEditor;

internal sealed record SettingsEditorHostLaunchResult(
    bool Success,
    bool AlreadyRunning,
    bool StartedProcess,
    string Message
);

internal static class SettingsEditorHostLauncher {
    public static SettingsEditorHostLaunchResult EnsureRunning() {
        try {
            if (TryGetCompatibleHostStatus(out _))
                return new SettingsEditorHostLaunchResult(true, true, false, "Settings editor host is already running.");

            if (!IsAutoStartEnabled())
                return new SettingsEditorHostLaunchResult(false, false, false, GetAutoStartDisabledMessage());

            if (!TryResolveLaunchCommand(out var launchCommand, out var launchArguments, out var workingDirectory)) {
                return new SettingsEditorHostLaunchResult(
                    false,
                    false,
                    false,
                    $"Could not locate Pe.Host. Check {SettingsEditorRuntime.HostExecutablePathVariable} or install {SettingsEditorRuntime.ProductName}."
                );
            }

            var startInfo = new ProcessStartInfo(launchCommand) {
                Arguments = launchArguments,
                WorkingDirectory = workingDirectory,
                UseShellExecute = false,
                CreateNoWindow = true
            };
            _ = Process.Start(startInfo);

            var startupTimeout = TimeSpan.FromMilliseconds(GetStartupTimeoutMs());
            var deadlineUtc = DateTime.UtcNow + startupTimeout;
            while (DateTime.UtcNow < deadlineUtc) {
                Thread.Sleep(250);
                if (TryGetCompatibleHostStatus(out _)) {
                    return new SettingsEditorHostLaunchResult(
                        true,
                        false,
                        true,
                        "Started the settings editor host."
                    );
                }
            }

            return new SettingsEditorHostLaunchResult(
                false,
                false,
                true,
                $"Started Pe.Host but it did not become compatible within {startupTimeout.TotalSeconds:0.#} seconds."
            );
        } catch (Exception ex) {
            return new SettingsEditorHostLaunchResult(false, false, false, ex.Message);
        }
    }

    private static bool TryGetCompatibleHostStatus(out HostStatusData? status) {
        status = null;
        try {
            using var client = new HttpClient { Timeout = TimeSpan.FromMilliseconds(1250) };
            using var response = client.GetAsync($"{GetHostBaseUrl().TrimEnd('/')}{HttpRoutes.HostStatus}")
                .GetAwaiter()
                .GetResult();
            if (!response.IsSuccessStatusCode)
                return false;

            var payloadJson = response.Content.ReadAsStringAsync().GetAwaiter().GetResult();
            status = JsonConvert.DeserializeObject<HostStatusData>(payloadJson);
            return status != null &&
                   string.Equals(status.RuntimeIdentity, SettingsEditorRuntime.RuntimeIdentity, StringComparison.Ordinal) &&
                   status.HostContractVersion == HostProtocol.ContractVersion &&
                   status.BridgeContractVersion == BridgeProtocol.ContractVersion &&
                   string.Equals(status.PipeName, GetExpectedPipeName(), StringComparison.Ordinal);
        } catch {
            return false;
        }
    }

    private static bool TryResolveLaunchCommand(
        out string launchCommand,
        out string launchArguments,
        out string workingDirectory
    ) {
        foreach (var candidate in GetCandidateExecutablePaths()) {
            if (!File.Exists(candidate))
                continue;

            workingDirectory = Path.GetDirectoryName(candidate)
                               ?? throw new InvalidOperationException("Resolved host path had no directory.");

            if (candidate.EndsWith(".dll", StringComparison.OrdinalIgnoreCase)) {
                launchCommand = "dotnet";
                launchArguments = $"\"{candidate}\"";
                return true;
            }

            launchCommand = candidate;
            launchArguments = string.Empty;
            return true;
        }

        launchCommand = string.Empty;
        launchArguments = string.Empty;
        workingDirectory = string.Empty;
        return false;
    }

    private static IEnumerable<string> GetCandidateExecutablePaths() {
        var localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        var programFiles = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles);
        return SettingsEditorRuntime.EnumerateHostExecutableCandidates(
            Environment.GetEnvironmentVariable(SettingsEditorRuntime.HostExecutablePathVariable),
            localAppData,
            programFiles
        );
    }

    private static string GetHostBaseUrl() => GetValueOrDefault(
        SettingsEditorRuntime.HostBaseUrlVariable,
        SettingsEditorRuntime.DefaultHostBaseUrl
    );

    private static string GetExpectedPipeName() => GetValueOrDefault(
        SettingsEditorRuntime.PipeNameVariable,
        SettingsEditorRuntime.DefaultPipeName
    );

    private static int GetStartupTimeoutMs() {
        var configuredValue = Environment.GetEnvironmentVariable(SettingsEditorRuntime.HostStartupTimeoutVariable);
        return int.TryParse(configuredValue, out var timeoutMs) && timeoutMs > 0
            ? timeoutMs
            : SettingsEditorRuntime.DefaultHostStartupTimeoutMs;
    }

    private static bool IsAutoStartEnabled() {
        var configuredValue = Environment.GetEnvironmentVariable(SettingsEditorRuntime.HostAutoStartEnabledVariable);
        if (bool.TryParse(configuredValue, out var isEnabled))
            return isEnabled;

        return !Debugger.IsAttached;
    }

    private static string GetAutoStartDisabledMessage() {
        var configuredValue = Environment.GetEnvironmentVariable(SettingsEditorRuntime.HostAutoStartEnabledVariable);
        if (bool.TryParse(configuredValue, out var isEnabled) && !isEnabled) {
            return
                $"Settings editor host is not running. Automatic startup is disabled by {SettingsEditorRuntime.HostAutoStartEnabledVariable}. Start Pe.Host manually or set it to true.";
        }

        return
            $"Settings editor host is not running. Automatic startup is disabled while debugging. Start Pe.Host manually or set {SettingsEditorRuntime.HostAutoStartEnabledVariable}=true to re-enable it.";
    }

    private static string GetValueOrDefault(string variableName, string defaultValue) {
        var value = Environment.GetEnvironmentVariable(variableName);
        return string.IsNullOrWhiteSpace(value) ? defaultValue : value;
    }
}
