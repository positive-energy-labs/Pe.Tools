using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Pe.Shared.HostContracts.Operations;
using Pe.Shared.HostContracts.SettingsStorage;

namespace Pe.Host.Operations;

/// <summary>
/// Single problem-details builder shared by the endpoint mapper (binding/validation
/// failures) and the operation executor (handler failures), so every error path
/// emits the same extensions — including the machine-readable <c>kind</c>.
/// </summary>
internal static class HostProblemResult {
    public static IResult Create(
        int statusCode,
        string detail,
        string requestId,
        string operationKey,
        IReadOnlyList<ValidationIssue>? issues = null,
        HostOperationException? exception = null
    ) {
        var problem = new ProblemDetails {
            Detail = detail,
            Status = statusCode
        };
        problem.Extensions["requestId"] = requestId;
        problem.Extensions["operationKey"] = operationKey;
        problem.Extensions["kind"] = (exception?.Kind ?? DeriveKind(statusCode)).ToString();
        if (!string.IsNullOrWhiteSpace(exception?.ActiveOperation))
            problem.Extensions["activeOperation"] = exception.ActiveOperation;
        if (!string.IsNullOrWhiteSpace(exception?.RetryHint))
            problem.Extensions["retryHint"] = exception.RetryHint;
        if (!string.IsNullOrWhiteSpace(exception?.BridgePrecondition))
            problem.Extensions["bridgePrecondition"] = exception.BridgePrecondition;
        if (issues is { Count: > 0 })
            problem.Extensions["issues"] = issues;

        return Results.Problem(problem);
    }

    // Fallback classification when a throw site did not set an explicit kind.
    private static HostErrorKind DeriveKind(int statusCode) => statusCode switch {
        StatusCodes.Status400BadRequest => HostErrorKind.InvalidRequest,
        StatusCodes.Status409Conflict => HostErrorKind.Conflict,
        StatusCodes.Status423Locked or StatusCodes.Status429TooManyRequests => HostErrorKind.BridgeBusy,
        StatusCodes.Status502BadGateway or StatusCodes.Status503ServiceUnavailable => HostErrorKind.Disconnected,
        _ => HostErrorKind.HostFailure
    };
}
