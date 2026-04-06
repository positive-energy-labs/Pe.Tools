using Pe.Ui.Core;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Controls.Primitives;
using System.Windows.Documents;
using System.Windows.Input;
using System.Windows.Threading;
using Wpf.Ui.Markup;
using WpfUiRichTextBox = Wpf.Ui.Controls.RichTextBox;

namespace Pe.Ui.Components;

/// <summary>
///     Selectable text display component with keyboard navigation
///     Popover component that displays text content positioned relative to a target element
/// </summary>
public class SelectableTextBox : RevitHostedUserControl, IPopoverExit {
    private readonly Border _border;
    private readonly Popup _popup;
    private readonly WpfUiRichTextBox _richTextBox;

    public SelectableTextBox(IEnumerable<Key> closeKeys) {
        this.Focusable = true;

        this.CloseKeys = closeKeys;

        this._richTextBox = new WpfUiRichTextBox {
            IsReadOnly = true,
            Focusable = true,
            IsTextSelectionEnabled = true,
            AutoWordSelection = false,
            VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
            HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled
        };

        this._richTextBox.PreviewKeyDown += this.RichTextBox_PreviewKeyDown;
        this._richTextBox.LostFocus += this.RichTextBox_LostFocus;

        // Allow RichTextBox to measure its content naturally
        this._richTextBox.MinWidth = 100;
        this._richTextBox.MinHeight = 50;
        this._richTextBox.MaxWidth = 250;
        this._richTextBox.MaxHeight = 400;

        this._border = new BorderSpec()
            .Background(ThemeResource.ApplicationBackgroundBrush)
            .HorizontalAlign(HorizontalAlignment.Left)
            .VerticalAlign(VerticalAlignment.Top)
            .Border(thickness: UiSz.ss)
            .Padding(UiSz.m)
            .CreateAround(this._richTextBox);

        this._popup = new Popup {
            AllowsTransparency = true,
            PopupAnimation = PopupAnimation.Fade,
            StaysOpen = false,
            Placement = PlacementMode.Left,
            HorizontalOffset = 0,
            VerticalOffset = 0,
            Child = this._border
        };

        this._popup.Closed += (_, _) => this.OnExitRequested();
        this._popup.PreviewKeyDown += this.Popup_PreviewKeyDown;

        // The UserControl's Content is the Popup - it only appears when IsOpen = true
        this.Content = this._popup;
    }

    public bool IsOpen => this._popup.IsOpen;

    public event EventHandler? ExitRequested;
    public IEnumerable<Key> CloseKeys { get; set; } = Array.Empty<Key>();

    public void RequestExit() {
        this.Hide();
        this.OnExitRequested();
    }

    public bool ShouldCloseOnKey(Key key) => this.CloseKeys.Contains(key);

    protected void OnExitRequested() => this.ExitRequested?.Invoke(this, EventArgs.Empty);

    /// <summary>
    ///     Shows the text box positioned to the left of the target element
    /// </summary>
    public void Show(UIElement placementTarget, string? text = null, bool takeFocus = true) {
        if (placementTarget == null) return;

        this.UpdateContent(text);
        this._popup.PlacementTarget = placementTarget;
        this._popup.IsOpen = true;

        if (takeFocus) {
            _ = this.Dispatcher.BeginInvoke(new Action(() => _ = this._richTextBox.Focus()),
                DispatcherPriority.Loaded);
        }
    }

    /// <summary>
    ///     Hides the text box popover
    /// </summary>
    public void Hide() {
        if (this._popup != null) this._popup.IsOpen = false;
    }

    private void UpdateContent(string? text) {
        this._richTextBox.Document = new FlowDocument {
            PagePadding = new Thickness(0),
            TextAlignment = TextAlignment.Left,
            FontFamily = Theme.FontFamily,
            FontSize = 13,
            LineHeight = 20
        };
        // Set foreground from DynamicResource
        this._richTextBox.Document.SetResourceReference(FlowDocument.ForegroundProperty, "TextFillColorSecondaryBrush");

        this._richTextBox.Document.Blocks.Clear();
        if (!string.IsNullOrEmpty(text)) this._richTextBox.Document.Blocks.Add(new Paragraph(new Run(text)));
    }

    private void Popup_PreviewKeyDown(object sender, KeyEventArgs e) {
        if (this.ShouldCloseOnKey(e.Key)) {
            e.Handled = true;
            this.RequestExit();
        }
    }

    private void RichTextBox_PreviewKeyDown(object sender, KeyEventArgs e) {
        if (this.ShouldCloseOnKey(e.Key)) {
            e.Handled = true;
            this.RequestExit();
        }
    }

    private void RichTextBox_LostFocus(object sender, RoutedEventArgs e) {
        var newFocus = Keyboard.FocusedElement as DependencyObject;
        if (newFocus != null && !this.IsAncestorOf(newFocus)) this.RequestExit();
    }
}