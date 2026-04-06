using Pe.Host.Contracts.Protocol;

namespace Pe.Host;

public sealed record BridgeHostOptions(
    string HostBaseUrl,
    string PipeName,
    IReadOnlyList<string> AllowedOrigins
) {
    private const string FrontendBaseUrlVariable = "PE_SETTINGS_EDITOR_BASE_URL";
    private const string HostBaseUrlVariable = "PE_SETTINGS_EDITOR_HOST_BASE_URL";
    private const string PipeNameVariable = "PE_SETTINGS_EDITOR_PIPE_NAME";
    private const string DefaultFrontendBaseUrl = "http://localhost:5150";
    private const string DefaultHostBaseUrl = "http://localhost:5180";

    public static BridgeHostOptions FromEnvironment() {
        var frontendBaseUrl = GetValueOrDefault(FrontendBaseUrlVariable, DefaultFrontendBaseUrl);
        return new BridgeHostOptions(
            GetValueOrDefault(HostBaseUrlVariable, DefaultHostBaseUrl),
            GetValueOrDefault(PipeNameVariable, BridgeProtocol.DefaultPipeName),
            BuildAllowedOrigins(frontendBaseUrl)
        );
    }

    private static IReadOnlyList<string> BuildAllowedOrigins(string frontendBaseUrl) => [
        .. new[] {
                frontendBaseUrl, DefaultFrontendBaseUrl, "http://localhost:5173", "http://localhost:3000",
                "http://127.0.0.1:5150", "http://127.0.0.1:5173", "http://127.0.0.1:3000"
            }
            .Distinct(StringComparer.OrdinalIgnoreCase)
    ];

    private static string GetValueOrDefault(string variableName, string defaultValue) {
        var value = Environment.GetEnvironmentVariable(variableName);
        return string.IsNullOrWhiteSpace(value) ? defaultValue : value;
    }
}