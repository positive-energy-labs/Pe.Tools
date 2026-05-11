using Microsoft.AspNetCore.Mvc;
using Pe.Shared.HostContracts.Operations;
using Pe.Shared.HostContracts.SettingsStorage;
using System.Diagnostics;

namespace Pe.Host.Operations;

internal sealed class HostOperationExecutor(
    ILogger<HostOperationExecutor> logger
) {
    private readonly ILogger<HostOperationExecutor> _logger = logger;

    public async Task<IResult> ExecuteHttpAsync(
        IHostOperation operation,
        object request,
        HostOperationContext context,
        CancellationToken cancellationToken
    ) {
        var stopwatch = Stopwatch.StartNew();
        try {
            var executionResult = await operation.ExecuteAsync(request, context, cancellationToken);

            this._logger.LogInformation(
                "Host operation completed: Key={Key}, Route={Route}, Verb={Verb}, Mode={Mode}, RequestType={RequestType}, ResponseType={ResponseType}, ElapsedMs={ElapsedMs}",
                operation.Definition.Key,
                operation.Definition.Route,
                operation.Definition.Verb,
                operation.Definition.ExecutionMode,
                operation.Definition.RequestType.Name,
                operation.Definition.ResponseType.Name,
                stopwatch.ElapsedMilliseconds
            );
            return executionResult.Response == null
                ? Results.NoContent()
                : Results.Ok(executionResult.Response);
        } catch (HostOperationException ex) {
            this._logger.LogWarning(
                ex,
                "Host operation failed with expected semantics: Key={Key}, Route={Route}, Mode={Mode}, RequestType={RequestType}, ElapsedMs={ElapsedMs}",
                operation.Definition.Key,
                operation.Definition.Route,
                operation.Definition.ExecutionMode,
                operation.Definition.RequestType.Name,
                stopwatch.ElapsedMilliseconds
            );
            return CreateProblemResult(ex.StatusCode, ex.Message, ex.Issues);
        } catch (Exception ex) {
            this._logger.LogError(
                ex,
                "Host operation failed: Key={Key}, Route={Route}, Mode={Mode}, RequestType={RequestType}, ElapsedMs={ElapsedMs}",
                operation.Definition.Key,
                operation.Definition.Route,
                operation.Definition.ExecutionMode,
                operation.Definition.RequestType.Name,
                stopwatch.ElapsedMilliseconds
            );
            return CreateProblemResult(StatusCodes.Status500InternalServerError, ex.Message, null);
        }
    }

    private static IResult CreateProblemResult(
        int statusCode,
        string detail,
        IReadOnlyList<ValidationIssue>? issues
    ) {
        var problem = new ProblemDetails {
            Detail = detail,
            Status = statusCode
        };
        if (issues is { Count: > 0 })
            problem.Extensions["issues"] = issues;

        return Results.Problem(problem);
    }
}
