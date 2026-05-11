using Pe.Shared.HostContracts.Operations;

namespace Pe.Host.Operations;

internal sealed record HostOperationResult(
    object? Response
);

internal interface IHostOperation {
    HostOperationDefinition Definition { get; }

    Task<HostOperationResult> ExecuteAsync(
        object request,
        HostOperationContext context,
        CancellationToken cancellationToken
    );
}

internal sealed class BaseHostOperation<TRequest>(
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
    ) => new BaseHostOperation<TRequest>(definition, handler);

    public static IHostOperation Bridge(HostOperationDefinition definition) {
        if (definition.ExecutionMode != HostExecutionMode.Bridge)
            throw new InvalidOperationException(
                $"Host operation '{definition.Key}' is not a bridge operation."
            );

        return Create<object>(
            definition,
            async (request, context, cancellationToken) => new HostOperationResult(
                await context.BridgeServer.InvokeAsync(definition, request, cancellationToken)
            )
        );
    }

    public static IHostOperation Bridge<TRequest, TResponse>(HostOperationDefinition definition) =>
        Bridge(definition);

    public static HostOperationResult Local(object? response) => new(response);
}
