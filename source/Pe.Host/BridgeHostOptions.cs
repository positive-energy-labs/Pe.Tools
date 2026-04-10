using Pe.Shared.HostContracts.Protocol;

namespace Pe.Host;

public sealed record BridgeHostOptions(
    string HostBaseUrl,
    string PipeName,
    IReadOnlyList<string> AllowedOrigins,
    bool IdleShutdownEnabled,
    TimeSpan IdleShutdownTimeout
) {
    public static BridgeHostOptions FromEnvironment() {
        var frontendBaseUrl = GetValueOrDefault(
            SettingsEditorRuntime.FrontendBaseUrlVariable,
            SettingsEditorRuntime.DefaultFrontendBaseUrl
        );
        return new BridgeHostOptions(
            GetValueOrDefault(
                SettingsEditorRuntime.HostBaseUrlVariable,
                SettingsEditorRuntime.DefaultHostBaseUrl
            ),
            GetValueOrDefault(SettingsEditorRuntime.PipeNameVariable, BridgeProtocol.DefaultPipeName),
            BuildAllowedOrigins(frontendBaseUrl),
            GetIdleShutdownEnabled(),
            GetIdleShutdownTimeout()
        );
    }

    private static IReadOnlyList<string> BuildAllowedOrigins(string frontendBaseUrl) => [
        .. new[] {
                frontendBaseUrl,
                SettingsEditorRuntime.DefaultFrontendBaseUrl,
                "http://localhost:5173",
                "http://localhost:3000",
                "http://127.0.0.1:5150", "http://127.0.0.1:5173", "http://127.0.0.1:3000"
            }
            .Distinct(StringComparer.OrdinalIgnoreCase)
    ];

    private static string GetValueOrDefault(string variableName, string defaultValue) {
        var value = Environment.GetEnvironmentVariable(variableName);
        return string.IsNullOrWhiteSpace(value) ? defaultValue : value;
    }

    private static bool GetIdleShutdownEnabled() {
        var value = Environment.GetEnvironmentVariable(SettingsEditorRuntime.IdleShutdownEnabledVariable);
        return !bool.TryParse(value, out var isEnabled) || isEnabled;
    }

    private static TimeSpan GetIdleShutdownTimeout() {
        var raw = Environment.GetEnvironmentVariable(SettingsEditorRuntime.IdleShutdownMinutesVariable);
        return int.TryParse(raw, out var minutes) && minutes > 0
            ? TimeSpan.FromMinutes(minutes)
            : SettingsEditorRuntime.DefaultIdleShutdownTimeout;
    }
}
