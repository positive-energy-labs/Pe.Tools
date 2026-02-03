using System.Threading;
using System.Threading.Tasks;
using System.Windows.Threading;

namespace Pe.Ui.Core;

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

        T result = default;
        await RevitTaskAccessor.RunAsync(() => {
            result = action();
            return Task.CompletedTask;
        });

        return ct.IsCancellationRequested ? default : result;
    }

    public static Task RunOnUiAsync(
        Dispatcher dispatcher,
        Action action,
        DispatcherPriority priority = DispatcherPriority.Background
    ) => dispatcher.InvokeAsync(action, priority).Task;
}
