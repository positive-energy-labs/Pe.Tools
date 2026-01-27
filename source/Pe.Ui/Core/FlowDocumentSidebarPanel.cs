using System.Threading;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Documents;
using System.Windows.Threading;
using WpfUiRichTextBox = Wpf.Ui.Controls.RichTextBox;

namespace Pe.Ui.Core;

/// <summary>
///     Base class for sidebar panels that display a <see cref="FlowDocument" />.
///     Provides standard setup for a read-only RichTextBox and implements <see cref="ISidebarPanel{TItem}" />.
///     Uses async loading pattern to keep the UI responsive during navigation.
/// </summary>
/// <typeparam name="TItem">The palette item type</typeparam>
public abstract class FlowDocumentSidebarPanel<TItem> : UserControl, ISidebarPanel<TItem>
    where TItem : class, IPaletteListItem {
    /// <summary>
    ///     The RichTextBox used to display the FlowDocument content.
    ///     Derived classes can access this to add additional blocks or customize.
    /// </summary>
    protected readonly WpfUiRichTextBox InfoBox;

    protected FlowDocumentSidebarPanel() {
        this.InfoBox = new WpfUiRichTextBox {
            IsReadOnly = true,
            Focusable = false,
            IsTextSelectionEnabled = true,
            AutoWordSelection = false,
            VerticalScrollBarVisibility = ScrollBarVisibility.Disabled,
            HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled,
            Margin = new Thickness(0)
        };

        base.Content = this.InfoBox;
    }

    /// <inheritdoc />
    UIElement ISidebarPanel<TItem>.Content => this;

    /// <inheritdoc />
    public virtual GridLength? PreferredWidth => null;

    /// <inheritdoc />
    /// <summary>
    ///     Called immediately on selection change (before debounce).
    ///     Clears the document so stale content doesn't persist.
    /// </summary>
    public virtual void Clear() =>
        this.InfoBox.Document = FlowDocumentBuilder.Create();

    /// <inheritdoc />
    /// <summary>
    ///     Called after debounce with cancellation support.
    ///     Default implementation uses dispatcher priority for responsive UI.
    ///     Override for custom async loading patterns.
    /// </summary>
    public virtual void Update(TItem? item, CancellationToken ct) {
        if (item == null) {
            this.InfoBox.Document = FlowDocumentBuilder.Create();
            return;
        }

        if (ct.IsCancellationRequested) return;

        // Schedule at lower priority to keep UI responsive
        _ = this.Dispatcher.BeginInvoke(DispatcherPriority.Background, () => {
            if (ct.IsCancellationRequested) return;
            this.InfoBox.Document = this.BuildDocument(item);
        });
    }

    /// <summary>
    ///     Builds the FlowDocument content for the given item.
    ///     Override this method to customize the preview content.
    /// </summary>
    /// <param name="item">The selected item (never null)</param>
    /// <returns>A FlowDocument to display in the sidebar</returns>
    protected abstract FlowDocument BuildDocument(TItem item);
}
