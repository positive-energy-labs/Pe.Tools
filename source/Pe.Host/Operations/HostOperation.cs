using Pe.Shared.HostContracts.Operations;

namespace Pe.Host.Operations;

internal sealed record HostOperationResult(
    object? Response,
    string ExecutionPath
);

internal interface IHostOperation {
    HostOperationDefinition Definition { get; }

    Task<HostOperationResult> ExecuteAsync(
        object request,
        HostOperationContext context,
        CancellationToken cancellationToken
    );
}

internal sealed class DelegatingHostOperation<TRequest>(
    HostOperationDefinition definition,
    Func<TRequest, HostOperationContext, CancellationToken, Task<HostOperationResult>> handler
) : IHostOperation {
    private readonly Func<TRequest, HostOperationContext, CancellationToken, Task<HostOperationResult>> _handler =
        handler;

    public HostOperationDefinition Definition { get; } = definition;

    public async Task<HostOperationResult> ExecuteAsync(
        object request,
        HostOperationContext context,
        CancellationToken cancellationToken
    ) => await this._handler((TRequest)request, context, cancellationToken);
}

internal static class HostOperations {
    public static IHostOperation Create<TRequest>(
        HostOperationDefinition definition,
        Func<TRequest, HostOperationContext, CancellationToken, Task<HostOperationResult>> handler
    ) => new DelegatingHostOperation<TRequest>(definition, handler);

    public static IHostOperation Bridge<TRequest, TEnvelope>(HostOperationDefinition definition)
        where TEnvelope : class =>
        Create<TRequest>(
            definition,
            async (request, context, cancellationToken) => Path(
                await context.BridgeServer.InvokeAsync<TRequest, TEnvelope>(
                    definition.Key,
                    request,
                    cancellationToken
                ),
                "bridge"
            )
        );

    public static HostOperationResult Local(object? response) => new(response, "local");

    public static HostOperationResult Path(object? response, string executionPath) => new(response, executionPath);
}