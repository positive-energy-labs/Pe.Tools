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
            return payload.ReturnNoContent
                ? Results.NoContent()
                : Results.Ok(payload.Value);
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

    private static HttpPayload UnwrapHttpPayload(object? response) {
        if (response is not IHostDataEnvelope envelope)
            return new HttpPayload(response, false);

        if (!envelope.Ok)
            throw new InvalidOperationException(envelope.Message);

        var data = envelope.GetData();
        if (data == null)
            return HttpPayload.NoContent();

        return new HttpPayload(data, false);
    }

    private readonly record struct HttpPayload(object? Value, bool ReturnNoContent) {
        public static HttpPayload NoContent() => new(null, true);
    }
}