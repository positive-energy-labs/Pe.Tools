using Pe.Shared.HostContracts.SettingsStorage;

namespace Pe.Host.Operations;

internal sealed class HostOperationException(
    int statusCode,
    string message,
    IReadOnlyList<ValidationIssue>? issues = null
) : Exception(message) {
    public IReadOnlyList<ValidationIssue> Issues { get; } = issues ?? [];
    public int StatusCode { get; } = statusCode;
}
