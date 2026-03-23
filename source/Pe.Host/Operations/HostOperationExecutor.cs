using Pe.Host.Contracts;
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
            var response = executionResult.Response;
            var payload = UnwrapHttpPayload(response);

            this._logger.LogInformation(
                "Host operation completed: Key={Key}, Route={Route}, Verb={Verb}, Mode={Mode}, ExecutionPath={ExecutionPath}, RequestType={RequestType}, ResponseType={ResponseType}, ElapsedMs={ElapsedMs}",
                operation.Definition.Key,
                operation.Definition.Route,
                operation.Definition.Verb,
                operation.Definition.ExecutionMode,
                executionResult.ExecutionPath,
                operation.Definition.RequestType.Name,
                operation.Definition.ResponseType.Name,
                stopwatch.ElapsedMilliseconds
            );
            return Results.Ok(payload);
        } catch (InvalidOperationException ex) {
            this._logger.LogWarning(
                ex,
                "Host operation failed with conflict semantics: Key={Key}, Route={Route}, Mode={Mode}, RequestType={RequestType}, ElapsedMs={ElapsedMs}",
                operation.Definition.Key,
                operation.Definition.Route,
                operation.Definition.ExecutionMode,
                operation.Definition.RequestType.Name,
                stopwatch.ElapsedMilliseconds
            );
            return Results.Problem(statusCode: StatusCodes.Status409Conflict, detail: ex.Message);
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
            return Results.Problem(statusCode: StatusCodes.Status500InternalServerError, detail: ex.Message);
        }
    }

    private static object? UnwrapHttpPayload(object? response) {
        if (response is not IHostDataEnvelope envelope)
            return response;

        if (!envelope.Ok)
            throw new InvalidOperationException(envelope.Message);

        var data = envelope.GetData();
        if (data == null)
            throw new InvalidOperationException(envelope.Message);

        return data;
    }
}
