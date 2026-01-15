using Pe.Ui.Core;
using Pe.Ui.Core.Converters;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Data;
using System.Windows.Media;
using Binding = System.Windows.Data.Binding;
using Image = System.Windows.Controls.Image;
using TextBlock = System.Windows.Controls.TextBlock;
using Visibility = System.Windows.Visibility;

namespace Pe.Ui.Components;

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
            .Padding(UiSz.ss, UiSz.ss, UiSz.ll, UiSz.ss)
            .ApplyToBorder(this);

        this.SecondaryText.LineHeight = 12;

        // Icon styling
        this.IconImage.Width = (double)UiSz.ll;
        this.IconImage.Height = (double)UiSz.ll;
        this.IconImage.Margin = new Thickness(0, 0, (double)UiSz.l, 0);
        // Opacity is set per-item in UpdateFromDataContext based on whether icon exists

        // Pill styling is now handled by the Pill component itself
    }

    /// <summary>
    ///     Updates the control with data from an IPaletteListItem.
    /// </summary>
    public void UpdateFromDataContext(object dataContext) {
        if (dataContext is not IPaletteListItem item)
            return;

        // Update Primary Text
        this.PrimaryText.Text = item.TextPrimary ?? string.Empty;

        // Update Secondary Text and Visibility
        var hasSecondary = !string.IsNullOrWhiteSpace(item.TextSecondary);
        this.SecondaryText.Text = hasSecondary ? item.TextSecondary : string.Empty;
        this.SecondaryText.Visibility = hasSecondary ? Visibility.Visible : Visibility.Collapsed;

        // Update Pill Text and Visibility
        var hasPill = !string.IsNullOrWhiteSpace(item.TextPill);
        this.PillBorder.Text = hasPill ? item.TextPill : string.Empty;
        this.PillBorder.Visibility = hasPill ? Visibility.Visible : Visibility.Collapsed;

        // Update Icon and Visibility
        // Check if list has ANY icons - if so, reserve space even if this item doesn't have one
        var listHasIcons = this.GetListHasIcons();
        var hasIcon = item.Icon != null;
        this.IconImage.Source = hasIcon ? item.Icon : null;

        // Show icon space if: this item has an icon OR any item in the list has an icon
        this.IconImage.Visibility = hasIcon || listHasIcons ? Visibility.Visible : Visibility.Collapsed;

        // Set opacity to 0 if no icon but space is reserved (invisible but takes up space)
        this.IconImage.Opacity = hasIcon ? Theme.IconOpacity : 0;

        // Update Color Indicator
        if (item.ItemColor.HasValue) {
            this.ColorIndicator.Background = new SolidColorBrush(item.ItemColor.Value);
            this.ColorIndicator.Visibility = Visibility.Visible;
        } else
            this.ColorIndicator.Visibility = Visibility.Collapsed;

        // Update Opacity based on actions (compute executability from actions)
        var canExecute = this.ComputeCanExecute(item);
        this.Opacity = canExecute ? 1 : Theme.DisabledOpacity;
    }

    /// <summary>
    ///     Sets up bindings for the control (alternative to UpdateFromDataContext for binding scenarios).
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
        // Bind Icon - but handle visibility manually based on list state
        var iconBinding = new Binding("Icon") { Mode = BindingMode.OneWay };
        _ = this.IconImage.SetBinding(Image.SourceProperty, iconBinding);

        // Manual visibility and opacity handling after binding is set
        var currentItem = this.DataContext as IPaletteListItem;
        if (currentItem != null) {
            var listHasIcons = this.GetListHasIcons();
            var hasIcon = currentItem.Icon != null;
            // Show icon space if: this item has an icon OR any item in the list has an icon
            this.IconImage.Visibility = hasIcon || listHasIcons ? Visibility.Visible : Visibility.Collapsed;

            // Set opacity to 0 if no icon but space is reserved
            this.IconImage.Opacity = hasIcon ? Theme.IconOpacity : 0;
        }

        // Bind Color Indicator Background and Visibility
        var colorBackgroundBinding = new Binding("ItemColor") {
            Mode = BindingMode.OneWay, Converter = new ColorToBrushConverter()
        };
        _ = this.ColorIndicator.SetBinding(BackgroundProperty, colorBackgroundBinding);

        var colorVisibilityBinding = new Binding("ItemColor") {
            Mode = BindingMode.OneWay, Converter = new NullableColorToVisibilityConverter()
        };
        _ = this.ColorIndicator.SetBinding(VisibilityProperty, colorVisibilityBinding);

        // Tooltip disabled - no hover tooltips

        // Compute opacity from actions (no binding needed since CanExecute doesn't change after palette opens)
        if (currentItem != null) {
            var canExecute = this.ComputeCanExecute(currentItem);
            this.Opacity = canExecute ? 1 : Theme.DisabledOpacity;
        }
    }

    private void OnDataContextChanged(object sender, DependencyPropertyChangedEventArgs e) {
        // Set up bindings once when DataContext is first set
        if (e.NewValue != null && e.OldValue == null)
            this.SetupBindings();
    }

    /// <summary>
    ///     Computes whether an item can be executed by checking available actions
    /// </summary>
    private bool ComputeCanExecute(IPaletteListItem item) {
        var actionBinding = this.FindActionBinding();
        if (actionBinding == null) return true; // Default to executable if no actions found

        // Use reflection to call HasAvailableActions method
        var hasAvailableActionsMethod = actionBinding.GetType().GetMethod("HasAvailableActions");
        if (hasAvailableActionsMethod != null) {
            var result = hasAvailableActionsMethod.Invoke(actionBinding, new object[] { item });
            return result is bool canExecute && canExecute;
        }

        return true; // Default to executable if method not found
    }

    /// <summary>
    ///     Finds the ActionBinding by walking up the visual tree to find SelectablePalette
    /// </summary>
    private object FindActionBinding() {
        var current = this.Parent;
        while (current != null) {
            var actionBinding = PaletteAttachedProperties.GetActionBinding(current);
            if (actionBinding != null) return actionBinding;

            current = current is FrameworkElement fe ? fe.Parent : null;
        }

        return null;
    }

    /// <summary>
    ///     Checks if the parent ListView has any items with icons
    /// </summary>
    private bool GetListHasIcons() {
        // Try to find ListView in visual tree
        DependencyObject current = this;
        while (current != null) {
            if (current is ListView customListView) {
                var hasIcons = ListView.GetHasIcons(customListView);
                return hasIcons;
            }

            // Also check for the inner Wpf.Ui.Controls.ListView
            if (current is System.Windows.Controls.ListView sysListView) {
                var hasIcons = ListView.GetHasIcons(sysListView);
                return hasIcons;
            }

            current = VisualTreeHelper.GetParent(current);
        }

        return false;
    }
}