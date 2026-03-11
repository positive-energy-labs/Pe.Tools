namespace Pe.Host;

public sealed record BridgeHostOptions(
    string SignalRBaseUrl,
    string PipeName,
    IReadOnlyList<string> AllowedOrigins
) {
    private const string FrontendBaseUrlVariable = "PE_SETTINGS_EDITOR_BASE_URL";
    private const string SignalRBaseUrlVariable = "PE_SETTINGS_EDITOR_SIGNALR_BASE_URL";
    private const string PipeNameVariable = "PE_SETTINGS_EDITOR_PIPE_NAME";
    private const string DefaultFrontendBaseUrl = "http://localhost:5150";
    private const string DefaultSignalRBaseUrl = "http://localhost:5180";

    public static BridgeHostOptions FromEnvironment() {
        var frontendBaseUrl = GetValueOrDefault(FrontendBaseUrlVariable, DefaultFrontendBaseUrl);
        return new(
            GetValueOrDefault(SignalRBaseUrlVariable, DefaultSignalRBaseUrl),
            GetValueOrDefault(PipeNameVariable, Pe.Host.Contracts.BridgeProtocol.DefaultPipeName),
            BuildAllowedOrigins(frontendBaseUrl)
        );
    }

    private static IReadOnlyList<string> BuildAllowedOrigins(string frontendBaseUrl) =>
        new[] {
            frontendBaseUrl,
            DefaultFrontendBaseUrl,
            "http://localhost:5173",
            "http://localhost:3000",
            "http://127.0.0.1:5150",
            "http://127.0.0.1:5173",
            "http://127.0.0.1:3000"
        }
        .Distinct(StringComparer.OrdinalIgnoreCase)
        .ToArray();

    private static string GetValueOrDefault(string variableName, string defaultValue) {
        var value = Environment.GetEnvironmentVariable(variableName);
        return string.IsNullOrWhiteSpace(value) ? defaultValue : value;
    }
}
