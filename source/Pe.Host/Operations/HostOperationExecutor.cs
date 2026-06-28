using Pe.Shared.HostContracts.Operations;
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
                "Host operation completed: RequestId={RequestId}, Key={Key}, Route={Route}, Verb={Verb}, Mode={Mode}, RequestType={RequestType}, ResponseType={ResponseType}, ElapsedMs={ElapsedMs}",
                context.RequestId,
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
                "Host operation failed with expected semantics: RequestId={RequestId}, Key={Key}, Route={Route}, Mode={Mode}, RequestType={RequestType}, ElapsedMs={ElapsedMs}",
                context.RequestId,
                operation.Definition.Key,
                operation.Definition.Route,
                operation.Definition.ExecutionMode,
                operation.Definition.RequestType.Name,
                stopwatch.ElapsedMilliseconds
            );
            return HostProblemResult.Create(
                ex.StatusCode,
                ex.Message,
                context.RequestId,
                operation.Definition.Key,
                ex.Issues,
                ex
            );
        } catch (Exception ex) {
            this._logger.LogError(
                ex,
                "Host operation failed: RequestId={RequestId}, Key={Key}, Route={Route}, Mode={Mode}, RequestType={RequestType}, ElapsedMs={ElapsedMs}",
                context.RequestId,
                operation.Definition.Key,
                operation.Definition.Route,
                operation.Definition.ExecutionMode,
                operation.Definition.RequestType.Name,
                stopwatch.ElapsedMilliseconds
            );
            return HostProblemResult.Create(
                StatusCodes.Status500InternalServerError,
                ex.Message,
                context.RequestId,
                operation.Definition.Key
            );
        }
    }
}
