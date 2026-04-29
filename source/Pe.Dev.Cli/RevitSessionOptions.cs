using Pe.Dev.RevitAutomation;
using Pe.Shared.HostContracts.Protocol;
using System.Net.Http;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace Pe.Dev.Cli;

internal sealed record RevitSessionOptions(
    bool JsonOutput
) {
    public static RevitSessionOptions Parse(IReadOnlyList<string> args) {
        var jsonOutput = false;

        foreach (var arg in args) {
            switch (arg.ToLowerInvariant()) {
            case "--json":
                jsonOutput = true;
                break;
            default:
                throw new ArgumentException($"Unknown argument '{arg}' for session.");
            }
        }

        return new RevitSessionOptions(jsonOutput);
    }
}

internal sealed record RevitSessionReport(
    HostStatusData? HostStatus,
    IReadOnlyList<RevitProcessSessionIdentity> ProcessSessions,
    RevitProcessSessionIdentity? SelectedProcessSession
) {
    public bool HostReachable => this.HostStatus != null;
    public bool HasAnySessions => (this.HostStatus?.Sessions.Count ?? 0) != 0 || this.ProcessSessions.Count != 0;
}

internal static class RevitSessionHostClient {
    private static readonly JsonSerializerOptions JsonOptions = CreateJsonOptions();

    public static HostStatusData? TryGetStatus() {
        try {
            using var client = new HttpClient { Timeout = TimeSpan.FromMilliseconds(GetProbeTimeoutMs()) };
            using var response = client.GetAsync($"{GetHostBaseUrl().TrimEnd('/')}{HttpRoutes.HostStatus}")
                .GetAwaiter()
                .GetResult();
            if (!response.IsSuccessStatusCode)
                return null;

            var payloadJson = response.Content.ReadAsStringAsync().GetAwaiter().GetResult();
            return JsonSerializer.Deserialize<HostStatusData>(payloadJson, JsonOptions);
        } catch {
            return null;
        }
    }

    public static string GetHostBaseUrl() {
        var configuredValue = Environment.GetEnvironmentVariable(SettingsEditorRuntime.HostBaseUrlVariable);
        return string.IsNullOrWhiteSpace(configuredValue)
            ? SettingsEditorRuntime.DefaultHostBaseUrl
            : configuredValue;
    }

    private static int GetProbeTimeoutMs() {
        var configuredValue = Environment.GetEnvironmentVariable(SettingsEditorRuntime.HostProbeTimeoutVariable);
        return int.TryParse(configuredValue, out var timeoutMs) && timeoutMs > 0
            ? timeoutMs
            : SettingsEditorRuntime.DefaultHostProbeTimeoutMs;
    }

    private static JsonSerializerOptions CreateJsonOptions() {
        var options = new JsonSerializerOptions(JsonSerializerDefaults.Web) {
            PropertyNameCaseInsensitive = true,
            DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull
        };
        options.Converters.Add(new JsonStringEnumConverter());
        return options;
    }
}
