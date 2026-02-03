using System.Windows;
using System.Windows.Controls;
using System.Windows.Threading;

namespace Pe.Ui.Core;

/// <summary>
///     Base sidebar panel that centralizes threading and cancellation.
///     Implementers provide data building and UI rendering hooks.
/// </summary>
public abstract class PaletteSidebarPanel<TItem, TData> : UserControl, ISidebarPanel<TItem>
    where TItem : class, IPaletteListItem {
    private int _updateSequence;

    UIElement ISidebarPanel<TItem>.Content => this;

    public void Clear() {
        if (this.Dispatcher.CheckAccess())
            this.ClearContent();
        else
            _ = this.Dispatcher.InvokeAsync(this.ClearContent, DispatcherPriority.Background);
    }

    public void Update(TItem? item, CancellationToken ct) {
        if (ct.IsCancellationRequested) return;

        if (item == null) {
            this.Clear();
            return;
        }

        this.ShowLoading(item);
        var sequence = Interlocked.Increment(ref this._updateSequence);

        _ = Task.Run(async () => {
            var data = await this.BuildDataAsync(item, ct).ConfigureAwait(false);
            if (ct.IsCancellationRequested) return;
            if (sequence != this._updateSequence) return;

            await this.Dispatcher.InvokeAsync(
                () => this.RenderData(data),
                DispatcherPriority.Background);
        }, ct);
    }

    /// <summary>
    ///     Optional quick UI feedback while data loads.
    /// </summary>
    protected virtual void ShowLoading(TItem item) { }

    /// <summary>
    ///     Build preview data off the UI thread. Use <see cref="PaletteThreading" /> for Revit context.
    /// </summary>
    protected abstract Task<TData?> BuildDataAsync(TItem item, CancellationToken ct);

    /// <summary>
    ///     Render preview content on the UI thread.
    /// </summary>
    protected abstract void RenderData(TData? data);

    /// <summary>
    ///     Clear UI content on the UI thread.
    /// </summary>
    protected abstract void ClearContent();
}
