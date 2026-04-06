using Pe.Shared.HostContracts.Operations;

namespace Pe.Revit.Global.Services.Host.Operations;

internal interface IBridgeOperation {
    HostOperationDefinition Definition { get; }

    Task<object?> ExecuteAsync(
        object request,
        BridgeOperationContext context,
        CancellationToken cancellationToken
    );
}

internal sealed class DelegatingBridgeOperation<TRequest>(
    HostOperationDefinition definition,
    Func<TRequest, BridgeOperationContext, CancellationToken, Task<object?>> handler
) : IBridgeOperation {
    private readonly Func<TRequest, BridgeOperationContext, CancellationToken, Task<object?>> _handler = handler;

    public HostOperationDefinition Definition { get; } = definition;

    public async Task<object?> ExecuteAsync(
        object request,
        BridgeOperationContext context,
        CancellationToken cancellationToken
    ) => await this._handler((TRequest)request, context, cancellationToken);
}

internal static class BridgeOperations {
    public static IBridgeOperation Create<TRequest, TResponse>(
        HostOperationDefinition definition,
        Func<TRequest, BridgeOperationContext, CancellationToken, Task<TResponse>> handler
    ) => new DelegatingBridgeOperation<TRequest>(
        definition,
        async (request, context, cancellationToken) =>
            await handler(request, context, cancellationToken)
    );
}