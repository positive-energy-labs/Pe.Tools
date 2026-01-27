using Pe.Global.Revit.Ui;
using Pe.Ui.Core;
using System.Threading;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using Button = Wpf.Ui.Controls.Button;
using Grid = System.Windows.Controls.Grid;
using TextBlock = Wpf.Ui.Controls.TextBlock;
using TextBox = Wpf.Ui.Controls.TextBox;

namespace Pe.App.Commands.Palette.CommandPalette;

/// <summary>
///     Sidebar panel for editing keyboard shortcuts on a command.
///     Displays current shortcuts with delete buttons and allows adding new ones.
///     Implements <see cref="ISidebarPanel{TItem}" /> for auto-wiring with <see cref="PostableCommandItem" />.
/// </summary>
public class ShortcutEditorPanel : UserControl, ISidebarPanel<PostableCommandItem> {
    private readonly Action? _onShortcutsChanged;
    private readonly StackPanel _shortcutsList;
    private readonly TextBox _newShortcutInput;
    private readonly TextBlock _statusText;
    private PostableCommandItem? _currentItem;

    public ShortcutEditorPanel(Action? onShortcutsChanged = null) {
        this._onShortcutsChanged = onShortcutsChanged;

        // Main container
        var mainStack = new StackPanel {
            Margin = new Thickness(16)
        };

        // Header - will be updated when item is set
        var header = new TextBlock {
            FontSize = 16,
            FontWeight = FontWeights.SemiBold,
            Margin = new Thickness(0, 0, 0, 16),
            TextWrapping = TextWrapping.Wrap
        };
        header.SetResourceReference(ForegroundProperty, "TextFillColorPrimaryBrush");
        _ = mainStack.Children.Add(header);

        // Current shortcuts section
        var shortcutsLabel = new TextBlock {
            Text = "Current Shortcuts",
            FontSize = 12,
            Margin = new Thickness(0, 0, 0, 8)
        };
        shortcutsLabel.SetResourceReference(ForegroundProperty, "TextFillColorSecondaryBrush");
        _ = mainStack.Children.Add(shortcutsLabel);

        // Shortcuts list container with border
        var shortcutsContainer = new Border {
            BorderThickness = new Thickness(1),
            CornerRadius = new CornerRadius(4),
            Padding = new Thickness(8),
            MinHeight = 60,
            Margin = new Thickness(0, 0, 0, 16)
        };
        shortcutsContainer.SetResourceReference(BorderBrushProperty, "ControlStrokeColorDefaultBrush");
        shortcutsContainer.SetResourceReference(BackgroundProperty, "ControlFillColorDefaultBrush");

        this._shortcutsList = new StackPanel();
        shortcutsContainer.Child = this._shortcutsList;
        _ = mainStack.Children.Add(shortcutsContainer);

        // Add new shortcut section
        var addLabel = new TextBlock {
            Text = "Add New Shortcut",
            FontSize = 12,
            Margin = new Thickness(0, 0, 0, 8)
        };
        addLabel.SetResourceReference(ForegroundProperty, "TextFillColorSecondaryBrush");
        _ = mainStack.Children.Add(addLabel);

        // Input row
        var inputRow = new Grid {
            Margin = new Thickness(0, 0, 0, 16)
        };
        inputRow.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        inputRow.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        this._newShortcutInput = new TextBox {
            PlaceholderText = "e.g., CC or Ctrl+Shift+C",
            Margin = new Thickness(0, 0, 8, 0)
        };
        this._newShortcutInput.KeyDown += this.OnInputKeyDown;
        Grid.SetColumn(this._newShortcutInput, 0);
        _ = inputRow.Children.Add(this._newShortcutInput);

        var addButton = new Button {
            Content = "Add",
            Padding = new Thickness(16, 6, 16, 6)
        };
        addButton.Click += this.OnAddClick;
        Grid.SetColumn(addButton, 1);
        _ = inputRow.Children.Add(addButton);

        _ = mainStack.Children.Add(inputRow);

        // Clear all button
        var clearButton = new Button {
            Content = "Clear All Shortcuts",
            Margin = new Thickness(0, 0, 0, 8),
            HorizontalAlignment = HorizontalAlignment.Left
        };
        clearButton.Click += this.OnClearAllClick;
        _ = mainStack.Children.Add(clearButton);

        // Status text for feedback
        this._statusText = new TextBlock {
            FontSize = 12,
            TextWrapping = TextWrapping.Wrap,
            Margin = new Thickness(0, 8, 0, 0)
        };
        _ = mainStack.Children.Add(this._statusText);

        base.Content = mainStack;
    }

    #region ISidebarPanel Implementation

    /// <inheritdoc />
    UIElement ISidebarPanel<PostableCommandItem>.Content => this;

    /// <inheritdoc />
    public GridLength? PreferredWidth => new GridLength(400);

    /// <inheritdoc />
    /// <summary>
    ///     Called immediately on selection change (before debounce).
    ///     Clears status and shows placeholder.
    /// </summary>
    public void Clear() {
        this._currentItem = null;
        this.ClearStatus();

        if (this.Content is StackPanel mainStack && mainStack.Children[0] is TextBlock header)
            header.Text = "Select a command";

        this._shortcutsList.Children.Clear();
        _ = this._shortcutsList.Children.Add(new TextBlock {
            Text = "No command selected",
            FontStyle = FontStyles.Italic,
            Foreground = Brushes.Gray
        });
    }

    /// <inheritdoc />
    /// <summary>
    ///     Called after debounce with cancellation support.
    /// </summary>
    public void Update(PostableCommandItem? item, CancellationToken ct) {
        if (ct.IsCancellationRequested) return;

        this._currentItem = item;
        this.ClearStatus();

        // Update header
        if (this.Content is StackPanel mainStack && mainStack.Children[0] is TextBlock header)
            header.Text = item != null ? $"Edit Shortcuts: {item.Name}" : "Select a command";

        this.RefreshShortcutsList();
    }

    #endregion

    private void RefreshShortcutsList() {
        this._shortcutsList.Children.Clear();

        if (this._currentItem == null) {
            _ = this._shortcutsList.Children.Add(new TextBlock {
                Text = "No command selected",
                FontStyle = FontStyles.Italic,
                Foreground = Brushes.Gray
            });
            return;
        }

        // Get current shortcuts from UIFramework (live state)
        var shortcuts = ShortcutsService.Instance.GetLiveShortcuts(this._currentItem.Command.Value);

        if (shortcuts.Count == 0) {
            _ = this._shortcutsList.Children.Add(new TextBlock {
                Text = "No shortcuts assigned",
                FontStyle = FontStyles.Italic,
                Foreground = Brushes.Gray
            });
            return;
        }

        foreach (var shortcut in shortcuts) {
            var row = this.CreateShortcutRow(shortcut);
            _ = this._shortcutsList.Children.Add(row);
        }
    }

    private Grid CreateShortcutRow(string shortcut) {
        var row = new Grid {
            Margin = new Thickness(0, 2, 0, 2)
        };
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        // Shortcut text in a pill-style container
        var shortcutBorder = new Border {
            Background = Brushes.Transparent,
            BorderThickness = new Thickness(1),
            CornerRadius = new CornerRadius(4),
            Padding = new Thickness(8, 4, 8, 4),
            HorizontalAlignment = HorizontalAlignment.Left
        };
        shortcutBorder.SetResourceReference(BorderBrushProperty, "ControlStrokeColorDefaultBrush");

        var shortcutText = new TextBlock {
            Text = shortcut,
            FontFamily = new FontFamily("Consolas"),
            FontSize = 13
        };
        shortcutText.SetResourceReference(ForegroundProperty, "TextFillColorPrimaryBrush");
        shortcutBorder.Child = shortcutText;
        Grid.SetColumn(shortcutBorder, 0);
        _ = row.Children.Add(shortcutBorder);

        // Delete button
        var deleteButton = new Button {
            Content = "×",
            Padding = new Thickness(8, 2, 8, 2),
            FontSize = 14,
            ToolTip = "Remove this shortcut",
            Tag = shortcut
        };
        deleteButton.Click += this.OnDeleteClick;
        Grid.SetColumn(deleteButton, 1);
        _ = row.Children.Add(deleteButton);

        return row;
    }

    private void OnInputKeyDown(object sender, KeyEventArgs e) {
        if (e.Key == Key.Enter) {
            this.AddShortcut();
            e.Handled = true;
        }
    }

    private void OnAddClick(object sender, RoutedEventArgs e) => this.AddShortcut();

    private void AddShortcut() {
        if (this._currentItem == null) {
            this.ShowStatus("No command selected", isError: true);
            return;
        }

        var shortcut = this._newShortcutInput.Text?.Trim().ToUpperInvariant();
        if (string.IsNullOrEmpty(shortcut)) {
            this.ShowStatus("Enter a shortcut to add", isError: true);
            return;
        }

        var (_, error) = ShortcutsService.Instance.AddShortcut(this._currentItem.Command.Value, shortcut);

        if (error != null) {
            this.ShowStatus(error.Message, isError: true);
            return;
        }

        // Success - clear input and refresh
        this._newShortcutInput.Text = "";
        this.ShowStatus($"Added shortcut: {shortcut}", isError: false);
        this.RefreshShortcutsList();
        this.NotifyShortcutsChanged();
    }

    private void OnDeleteClick(object sender, RoutedEventArgs e) {
        if (sender is not Button button || button.Tag is not string shortcut) return;
        if (this._currentItem == null) return;
        var (_, error) = ShortcutsService.Instance.RemoveShortcut(this._currentItem.Command.Value, shortcut);

        if (error != null) {
            this.ShowStatus(error.Message, isError: true);
            return;
        }

        this.ShowStatus($"Removed shortcut: {shortcut}", isError: false);
        this.RefreshShortcutsList();
        this.NotifyShortcutsChanged();
    }

    private void OnClearAllClick(object sender, RoutedEventArgs e) {
        if (this._currentItem == null) {
            this.ShowStatus("No command selected", isError: true);
            return;
        }

        var (_, error) = ShortcutsService.Instance.ClearShortcuts(this._currentItem.Command.Value);

        if (error != null) {
            this.ShowStatus(error.Message, isError: true);
            return;
        }

        this.ShowStatus("All shortcuts cleared", isError: false);
        this.RefreshShortcutsList();
        this.NotifyShortcutsChanged();
    }

    private void ShowStatus(string message, bool isError) {
        this._statusText.Text = message;
        this._statusText.Foreground = isError
            ? Brushes.IndianRed
            : Brushes.ForestGreen;
    }

    private void ClearStatus() => this._statusText.Text = "";

    private void NotifyShortcutsChanged() {
        // Update the current item's shortcuts for immediate UI feedback
        if (this._currentItem != null)
            this._currentItem.Shortcuts = ShortcutsService.Instance.GetLiveShortcuts(this._currentItem.Command.Value);

        this._onShortcutsChanged?.Invoke();
    }
}
