using Pe.Revit.Ui.Core;
using Pe.Revit.Ui.Core.Converters;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Data;
using Binding = System.Windows.Data.Binding;
using TextBlock = System.Windows.Controls.TextBlock;
using Visibility = System.Windows.Visibility;

namespace Pe.Revit.Ui.Components;

/// <summary>
///     List item control for ListView with XAML structure.
/// </summary>
public partial class ListViewItem : Border {
    public ListViewItem() {
        this.InitializeComponent();
        this.ApplyStyling();
        this.DataContextChanged += this.OnDataContextChanged;
    }

    private void ApplyStyling() {
        // Border styling (layout only, colors from XAML DynamicResources)
        this.CornerRadius = new CornerRadius((double)UiSz.l);
        new BorderSpec()
            .Padding(UiSz.l, UiSz.m, UiSz.ll, UiSz.m)
            .ApplyToBorder(this);

        this.SecondaryText.LineHeight = 12;
    }

    /// <summary>
    ///     Sets up bindings for the control.
    /// </summary>
    public void SetupBindings() {
        // Bind Primary Text
        var primaryBinding = new Binding("TextPrimary") { Mode = BindingMode.OneWay };
        _ = this.PrimaryText.SetBinding(TextBlock.TextProperty, primaryBinding);

        // Bind Secondary Text
        var secondaryBinding = new Binding("TextSecondary") { Mode = BindingMode.OneWay };
        _ = this.SecondaryText.SetBinding(TextBlock.TextProperty, secondaryBinding);

        var secondaryVisibilityBinding = new Binding("TextSecondary") {
            Mode = BindingMode.OneWay, Converter = new VisibilityConverter()
        };
        _ = this.SecondaryText.SetBinding(VisibilityProperty, secondaryVisibilityBinding);

        // Bind Pill Text
        var pillTextBinding = new Binding("TextPill") { Mode = BindingMode.OneWay };
        _ = this.PillBorder.SetBinding(Pill.TextProperty, pillTextBinding);

        var pillVisibilityBinding = new Binding("TextPill") {
            Mode = BindingMode.OneWay, Converter = new VisibilityConverter()
        };
        _ = this.PillBorder.SetBinding(VisibilityProperty, pillVisibilityBinding);

        // Bind Color Indicator Background and Visibility
        var colorBackgroundBinding = new Binding("ItemColor") {
            Mode = BindingMode.OneWay, Converter = new ColorToBrushConverter()
        };
        _ = this.ColorIndicator.SetBinding(BackgroundProperty, colorBackgroundBinding);

        var colorVisibilityBinding = new Binding("ItemColor") {
            Mode = BindingMode.OneWay, Converter = new NullableColorToVisibilityConverter()
        };
        _ = this.ColorIndicator.SetBinding(VisibilityProperty, colorVisibilityBinding);
    }

    private void OnDataContextChanged(object sender, DependencyPropertyChangedEventArgs e) {
        if (e.NewValue == null) return;

        // Set up bindings once; per-item state below is refreshed on every change
        // because container recycling swaps DataContext without recreating the control
        if (e.OldValue == null)
            this.SetupBindings();

        if (e.NewValue is not IPaletteListItem item) return;

        this.UpdateIcon(item);
        this.Opacity = this.ComputeCanExecute(item) ? 1 : Theme.DisabledOpacity;
    }

    /// <summary>
    ///     Shows the item's icon, or a monogram tile fallback so all rows stay aligned.
    /// </summary>
    private void UpdateIcon(IPaletteListItem item) {
        var hasIcon = item.Icon != null;
        this.IconImage.Source = item.Icon;
        this.IconImage.Opacity = Theme.IconOpacity;
        this.IconImage.Visibility = hasIcon ? Visibility.Visible : Visibility.Collapsed;
        this.IconFallback.Visibility = hasIcon ? Visibility.Collapsed : Visibility.Visible;

        var text = item.TextPrimary;
        this.IconFallbackText.Text = string.IsNullOrWhiteSpace(text)
            ? "•"
            : text.TrimStart().Substring(0, 1).ToUpperInvariant();
    }

    /// <summary>
    ///     Computes whether an item can be executed by checking available actions
    /// </summary>
    private bool ComputeCanExecute(IPaletteListItem item) {
        var actionBinding = this.FindActionBinding();
        if (actionBinding == null) return true; // Default to executable if no actions found

        return actionBinding.HasAvailableActionsUntyped(item);
    }

    /// <summary>
    ///     Finds the ActionBinding by walking up the visual tree to find SelectablePalette
    /// </summary>
    private ActionBinding? FindActionBinding() {
        var current = this.Parent;
        while (current != null) {
            var actionBinding = PaletteAttachedProperties.GetActionBinding(current);
            if (actionBinding is ActionBinding typedBinding) return typedBinding;

            current = current is FrameworkElement fe ? fe.Parent : null;
        }

        return null;
    }
}
