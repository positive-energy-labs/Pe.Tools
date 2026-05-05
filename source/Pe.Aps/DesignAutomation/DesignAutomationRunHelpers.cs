using Newtonsoft.Json;
using System.Net;

namespace Pe.Aps.DesignAutomation;

public static class DesignAutomationRunHelpers {
    private const string StatusCodeDataKey = "Pe.AutomationApiClient.StatusCode";

    public static readonly TimeSpan BatchPollingInterval = TimeSpan.FromSeconds(10);
    public static readonly TimeSpan BatchTimeoutBuffer = TimeSpan.FromMinutes(2);

    public static bool IsTerminal(string? status) =>
        status is not null &&
        (
            status.Equals("success", StringComparison.OrdinalIgnoreCase) ||
            status.Equals("failed", StringComparison.OrdinalIgnoreCase) ||
            status.StartsWith("failed", StringComparison.OrdinalIgnoreCase) ||
            status.Equals("cancelled", StringComparison.OrdinalIgnoreCase) ||
            status.Equals("timeout", StringComparison.OrdinalIgnoreCase)
        );

    public static DateTime ComputeDeadlineUtc(DateTime submittedAtUtc, int timeoutSeconds) =>
        submittedAtUtc.AddSeconds(timeoutSeconds).Add(BatchTimeoutBuffer);

    public static async Task<TArtifact> ReadJsonArtifactAsync<TArtifact>(
        string artifactPath,
        string invalidMessage,
        CancellationToken cancellationToken
    ) =>
        JsonConvert.DeserializeObject<TArtifact>(
            await File.ReadAllTextAsync(artifactPath, cancellationToken).ConfigureAwait(false)
        ) ?? throw new InvalidDataException(invalidMessage);

    public static async Task ValidateJsonArtifactAsync<TArtifact>(
        string artifactPath,
        string invalidMessage,
        CancellationToken cancellationToken
    ) {
        _ = await ReadJsonArtifactAsync<TArtifact>(artifactPath, invalidMessage, cancellationToken)
            .ConfigureAwait(false);
    }

    public static bool HasStatusCode(
        HttpRequestException exception,
        HttpStatusCode first,
        HttpStatusCode second
    ) {
        var statusCode = TryGetStatusCode(exception);
        return statusCode == first || statusCode == second;
    }

    public static HttpStatusCode? TryGetStatusCode(HttpRequestException exception) =>
        exception.Data[StatusCodeDataKey] is HttpStatusCode statusCode ? statusCode : null;
}
