using System.Net.Http;
using System.Text.Json;
using Pe.Shared.HostContracts.Protocol;

namespace Pe.Host.Services;

internal static class HostSingletonGuard {
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web) {
        PropertyNameCaseInsensitive = true
    };

    public static IDisposable? TryAcquireOrExit(BridgeHostOptions options) {
        var mutex = new Mutex(true, SettingsEditorRuntime.HostSingletonMutexName, out var createdNew);
        if (createdNew)
            return mutex;

        mutex.Dispose();

        if (WaitForCompatibleHost(options)) {
            Console.WriteLine(
                "A compatible Pe.Host instance is already running at {0}. Exiting duplicate instance.",
                options.HostBaseUrl
            );
            return null;
        }

        throw new InvalidOperationException(
            $"Another process already holds mutex '{SettingsEditorRuntime.HostSingletonMutexName}', but no compatible {SettingsEditorRuntime.ProductName} host responded at '{options.HostBaseUrl}'."
        );
    }

    private static bool WaitForCompatibleHost(BridgeHostOptions options) {
        var deadlineUtc = DateTime.UtcNow.AddMilliseconds(GetProbeTimeoutMs());
        while (DateTime.UtcNow < deadlineUtc) {
            if (TryGetCompatibleHostStatus(options))
                return true;

            Thread.Sleep(250);
        }

        return false;
    }

    private static int GetProbeTimeoutMs() {
        var configuredValue = Environment.GetEnvironmentVariable(SettingsEditorRuntime.HostStartupTimeoutVariable);
        return int.TryParse(configuredValue, out var timeoutMs) && timeoutMs > 0
            ? timeoutMs
            : SettingsEditorRuntime.DefaultHostStartupTimeoutMs;
    }

    private static bool TryGetCompatibleHostStatus(BridgeHostOptions options) {
        try {
            using var client = new HttpClient { Timeout = TimeSpan.FromMilliseconds(GetHostProbeTimeoutMs()) };
            using var response = client.GetAsync($"{options.HostBaseUrl.TrimEnd('/')}{HttpRoutes.HostStatus}")
                .GetAwaiter()
                .GetResult();
            if (!response.IsSuccessStatusCode)
                return false;

            var payloadJson = response.Content.ReadAsStringAsync().GetAwaiter().GetResult();
            var status = JsonSerializer.Deserialize<HostStatusData>(payloadJson, JsonOptions);
            return status != null &&
                   string.Equals(status.RuntimeIdentity, SettingsEditorRuntime.RuntimeIdentity, StringComparison.Ordinal) &&
                   status.HostContractVersion == HostProtocol.ContractVersion &&
                   status.BridgeContractVersion == BridgeProtocol.ContractVersion &&
                   string.Equals(status.PipeName, options.PipeName, StringComparison.Ordinal);
        } catch {
            return false;
        }
    }

    private static int GetHostProbeTimeoutMs() {
        var configuredValue = Environment.GetEnvironmentVariable(SettingsEditorRuntime.HostProbeTimeoutVariable);
        return int.TryParse(configuredValue, out var timeoutMs) && timeoutMs > 0
            ? timeoutMs
            : SettingsEditorRuntime.DefaultHostProbeTimeoutMs;
    }
}
