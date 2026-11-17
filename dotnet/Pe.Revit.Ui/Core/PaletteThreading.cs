using System.Windows.Threading;

namespace Pe.Revit.Ui.Core;

/// <summary>
///     Centralized threading helpers for palette pipelines.
///     Keeps Revit-context, background, and UI-thread work coordinated in one place.
/// </summary>
public static class PaletteThreading {
    public static Task<T> RunBackgroundAsync<T>(Func<T> action, CancellationToken ct) =>
        Task.Run(action, ct);

    public static Task RunBackgroundAsync(Action action, CancellationToken ct) =>
        Task.Run(action, ct);

    public static async Task<T> RunRevitAsync<T>(Func<T> action, CancellationToken ct) {
        if (ct.IsCancellationRequested)
            return default;

        if (!RevitTaskAccessor.IsConfigured) {
            throw new InvalidOperationException(
                "RevitTaskAccessor not configured. Wire up in Application.OnStartup.");
        }

        var runAsync = RevitTaskAccessor.RunAsync
                       ?? throw new InvalidOperationException("RevitTaskAccessor.RunAsync is not configured.");
        var hasResult = false;
        T? result = default;
        await runAsync(() => {
            result = action();
            hasResult = true;
        });

        return ct.IsCancellationRequested || !hasResult
            ? default
            : result!;
    }

    /// <summary>
    ///     For an op that writes. Its result is the evidence of what landed, so once the action ran, a later
    ///     cancellation never discards it, and a request cancelled before the action throws instead of answering
    ///     an empty success.
    /// </summary>
    public static async Task<T> RunRevitEffectAsync<T>(Func<T> action, CancellationToken ct) {
        ct.ThrowIfCancellationRequested();
        T result = default!;
        if (!await RunRevitAsync(() => { result = action(); return true; }, CancellationToken.None))
            throw new InvalidOperationException("The Revit task ended without running the operation.");
        return result;
    }

    public static Task RunOnUiAsync(
        Dispatcher dispatcher,
        Action action,
        DispatcherPriority priority = DispatcherPriority.Background
    ) => dispatcher.InvokeAsync(action, priority).Task;
}
