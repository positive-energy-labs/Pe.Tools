using Pe.Shared.Product;

namespace Pe.Shared.HostContracts.Transport;

/// <summary>The local supervisor's launch outcome, independent of Revit's UI queue.</summary>
public sealed class HostStartupReadiness(ProductRuntimeLayout runtime, TimeSpan timeout) {
    private readonly TaskCompletionSource<bool> _ready = new(TaskCreationOptions.RunContinuationsAsynchronously);

    public ProductRuntimeLayout Runtime { get; } = runtime;

    public void Succeed() => this._ready.TrySetResult(true);

    public void Fail(string reason) => this._ready.TrySetException(new HostStartupException(reason));

    public void Wait() {
        using var cancellation = new CancellationTokenSource();
        var ready = this._ready.Task;
        var deadline = Task.Delay(timeout, cancellation.Token);
        var completed = Task.WhenAny(ready, deadline).GetAwaiter().GetResult();
        cancellation.Cancel();
        if (completed != ready)
            throw new HostStartupException($"The local host supervisor did not finish startup within {timeout}.");
        ready.GetAwaiter().GetResult();
    }
}

public sealed class HostStartupException(string message) : InvalidOperationException(message);
