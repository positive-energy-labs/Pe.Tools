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

    public static Task RunOnUiAsync(
        Dispatcher dispatcher,
        Action action,
        DispatcherPriority priority = DispatcherPriority.Background
    ) => dispatcher.InvokeAsync(action, priority).Task;
}
