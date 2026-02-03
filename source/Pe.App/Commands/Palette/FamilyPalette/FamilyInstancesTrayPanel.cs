using Pe.Ui.Components;
using Pe.Ui.Core;
using System.Collections.ObjectModel;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Data;
using System.Windows.Input;
using Wpf.Ui.Controls;
using Binding = System.Windows.Data.Binding;
using TextBlock = Wpf.Ui.Controls.TextBlock;

namespace Pe.App.Commands.Palette.FamilyPalette;

/// <summary>
///     Tray panel for Family Instances tab.
///     Provides toggles for filtering annotation symbols and active view,
///     plus a FilterBox for category filtering.
/// </summary>
public class FamilyInstancesTrayPanel : RevitHostedUserControl {
    public FamilyInstancesTrayPanel(
        FamilyInstancesOptions options,
        ObservableCollection<string> availableCategories
    ) {
        this.Options = options;

        // Build the UI programmatically
        var stackPanel = new StackPanel { Margin = new Thickness(8) };

        // Show Annotation Symbols Toggle
        var annotationToggle = new ToggleSwitch {
            Content = "Show Annotation Symbols",
            Margin = new Thickness(0, 0, 0, 8)
        };
        _ = annotationToggle.SetBinding(ToggleSwitch.IsCheckedProperty,
            new Binding(nameof(FamilyInstancesOptions.ShowAnnotationSymbols)) {
                Source = options,
                Mode = BindingMode.TwoWay
            });
        _ = stackPanel.Children.Add(annotationToggle);

        // Filter by Active View Toggle
        var activeViewToggle = new ToggleSwitch {
            Content = "Filter by Active View",
            Margin = new Thickness(0, 0, 0, 8)
        };
        _ = activeViewToggle.SetBinding(ToggleSwitch.IsCheckedProperty,
            new Binding(nameof(FamilyInstancesOptions.FilterByActiveView)) {
                Source = options,
                Mode = BindingMode.TwoWay
            });
        _ = stackPanel.Children.Add(activeViewToggle);

        // Category Filter Label
        var categoryLabel = new TextBlock {
            Text = "Filter by Category:",
            FontSize = 12,
            Margin = new Thickness(0, 4, 0, 4)
        };
        categoryLabel.SetResourceReference(ForegroundProperty, "TextFillColorSecondaryBrush");
        _ = stackPanel.Children.Add(categoryLabel);

        // Category FilterBox Container
        var filterContainer = new Border {
            CornerRadius = new CornerRadius(4),
            Padding = new Thickness(4),
            Child = new FilterBox<FamilyInstancesOptions>(
                options,
                [Key.Escape],
                () => options.SelectedFilterValue,
                value => options.SelectedFilterValue = value,
                availableCategories
            )
        };
        filterContainer.SetResourceReference(Border.BackgroundProperty, "ControlFillColorDefaultBrush");
        _ = stackPanel.Children.Add(filterContainer);

        this.Content = stackPanel;
    }

    public FamilyInstancesOptions Options { get; }
}