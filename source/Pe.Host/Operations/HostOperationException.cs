using Pe.Shared.HostContracts.Operations;
using Pe.Shared.HostContracts.SettingsStorage;

namespace Pe.Host.Operations;

internal sealed class HostOperationException(
    int statusCode,
    string message,
    IReadOnlyList<ValidationIssue>? issues = null,
    string? activeOperation = null,
    string? retryHint = null,
    string? bridgePrecondition = null,
    HostErrorKind? kind = null
) : Exception(message) {
    public IReadOnlyList<ValidationIssue> Issues { get; } = issues ?? [];
    public int StatusCode { get; } = statusCode;
    public string? ActiveOperation { get; } = activeOperation;
    public string? RetryHint { get; } = retryHint;
    public string? BridgePrecondition { get; } = bridgePrecondition;
    public HostErrorKind? Kind { get; } = kind;
}
