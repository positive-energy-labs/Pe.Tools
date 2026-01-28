using Pe.Ui.Controls;
using Serilog;
using System.Collections.ObjectModel;
using System.ComponentModel;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Data;
using System.Windows.Input;
using System.Windows.Media;

namespace Pe.Ui.Controls;

/// <summary>
///     Sortable data table with horizontal scrolling, cell truncation with tooltips,
///     and compact styling. Designed for preview panels.
/// </summary>
public class SortableDataTable : UserControl {
    private readonly ObservableCollection<DataTableRow> _rows = new();
    private readonly List<DataTableColumn> _columns = new();
    private DataGrid? _dataGrid;
    private AnimatedScrollViewer? _scrollViewer;
    private string? _currentSortColumn;
    private ListSortDirection _currentSortDirection = ListSortDirection.Ascending;

    public SortableDataTable() {
        this.BuildUI();
        // Handle scroll at UserControl level BEFORE DataGrid's internal ScrollViewer consumes it
        this.PreviewMouseWheel += this.OnPreviewMouseWheel;
    }

    public void SetData(List<DataTableColumn> columns, List<Dictionary<string, string>> rows) {
        this._columns.Clear();
        this._columns.AddRange(columns);
        this._rows.Clear();

        foreach (var rowData in rows) {
            var row = new DataTableRow();
            foreach (var column in columns)
                row.Cells[column.Name] = rowData.TryGetValue(column.Name, out var value) ? value : string.Empty;
            this._rows.Add(row);
        }

        this.RebuildGrid();
    }

    private void BuildUI() {
        // Ensure this control can receive mouse input
        this.IsEnabled = true;
        this.IsHitTestVisible = true;
        this.Background = System.Windows.Media.Brushes.Transparent; // Required for hit-testing on empty areas

        // Horizontal scrollviewer for the table
        this._scrollViewer = new AnimatedScrollViewer {
            HorizontalScrollBarVisibility = ScrollBarVisibility.Auto,
            VerticalScrollBarVisibility = ScrollBarVisibility.Disabled,
            Margin = new Thickness(0),
            IsEnabled = true,
            IsHitTestVisible = true,
            Background = System.Windows.Media.Brushes.Transparent
        };

        this.Content = this._scrollViewer;
    }

    private void RebuildGrid() {
        this._dataGrid = new DataGrid {
            ItemsSource = this._rows,
            AutoGenerateColumns = false,
            HeadersVisibility = DataGridHeadersVisibility.Column,
            GridLinesVisibility = DataGridGridLinesVisibility.None,
            CanUserAddRows = false,
            CanUserDeleteRows = false,
            CanUserReorderColumns = false,
            CanUserResizeRows = false,
            IsReadOnly = true,
            SelectionMode = DataGridSelectionMode.Single,
            FontSize = 13,
            RowHeight = 22, // Compact row height
            ColumnHeaderHeight = 24,
            BorderThickness = new Thickness(0),
            Background = Brushes.Transparent,
            HorizontalGridLinesBrush = Brushes.Transparent,
            VerticalGridLinesBrush = Brushes.Transparent
        };

        // Set resource references for styling
        this._dataGrid.SetResourceReference(ForegroundProperty, "TextFillColorSecondaryBrush");
        this._dataGrid.SetResourceReference(DataGrid.RowBackgroundProperty, "ControlFillColorTransparentBrush");
        this._dataGrid.SetResourceReference(DataGrid.AlternatingRowBackgroundProperty, "ControlFillColorDefaultBrush");

        // Build columns
        foreach (var column in this._columns) {
            var dataGridColumn = new DataGridTextColumn {
                Header = this.CreateSortableHeader(column.Name),
                Binding = new System.Windows.Data.Binding($"Cells[{column.Name}]"),
                Width = column.Width > 0 ? new DataGridLength(column.Width) : DataGridLength.Auto,
                MinWidth = 60,
                MaxWidth = column.MaxWidth > 0 ? column.MaxWidth : double.PositiveInfinity,
                CanUserSort = true
            };

            // Apply cell style with truncation and tooltip
            dataGridColumn.ElementStyle = this.CreateCellStyle();

            this._dataGrid.Columns.Add(dataGridColumn);
        }

        // Handle sorting
        this._dataGrid.Sorting += this.OnDataGridSorting;

        this._scrollViewer!.Content = this._dataGrid;
    }

    private UIElement CreateSortableHeader(string columnName) {
        var panel = new StackPanel { Orientation = Orientation.Horizontal };

        var textBlock = new TextBlock {
            Text = columnName,
            FontWeight = FontWeights.SemiBold,
            VerticalAlignment = VerticalAlignment.Center,
            Margin = new Thickness(0, 0, 4, 0)
        };

        var sortIcon = new TextBlock {
            Text = "↑↓",
            FontSize = 12,
            Opacity = 0.5,
            VerticalAlignment = VerticalAlignment.Center,
            Margin = new Thickness(0, 0, 0, 0)
        };
        sortIcon.SetResourceReference(ForegroundProperty, "TextFillColorSecondaryBrush");

        _ = panel.Children.Add(textBlock);
        _ = panel.Children.Add(sortIcon);

        return panel;
    }

    private Style CreateCellStyle() {
        var style = new Style(typeof(TextBlock));

        // Vertical center alignment for cells
        style.Setters.Add(new Setter(VerticalAlignmentProperty, VerticalAlignment.Center));

        // Truncate text
        style.Setters.Add(new Setter(TextBlock.TextTrimmingProperty, TextTrimming.CharacterEllipsis));
        style.Setters.Add(new Setter(TextBlock.PaddingProperty, new Thickness(4, 0, 4, 0))); // Reduced vertical padding

        // Tooltip that shows full text on hover
        style.Setters.Add(new Setter(ToolTipService.InitialShowDelayProperty, 300));
        style.Setters.Add(new Setter(ToolTipService.ShowDurationProperty, 30000));

        // Bind tooltip to the TextBlock's own Text property
        var tooltipBinding = new System.Windows.Data.Binding("Text") {
            RelativeSource = new RelativeSource(RelativeSourceMode.Self)
        };
        style.Setters.Add(new Setter(ToolTipProperty, tooltipBinding));

        return style;
    }

    /// <summary>
    ///     Handle scroll at UserControl level BEFORE DataGrid's internal ScrollViewer can consume it.
    ///     - Shift+scroll: horizontal scroll within this table's ScrollViewer
    ///     - Normal scroll: pass through to the panel's ancestor ScrollViewer
    /// </summary>
    private void OnPreviewMouseWheel(object sender, MouseWheelEventArgs e) {
        if (Keyboard.Modifiers == ModifierKeys.Shift) {
            // Shift+scroll = horizontal scroll in our table
            if (this._scrollViewer == null) return;

            e.Handled = true;
            var scrollAmount = e.Delta * -0.5; // Adjust sensitivity, negative for natural direction
            var newOffset = this._scrollViewer.HorizontalOffset + scrollAmount;
            this._scrollViewer.ScrollToHorizontalOffset(Math.Max(0, newOffset));

            return;
        }

        // Normal scroll = pass to panel's ScrollViewer (ancestor, not immediate parent)
        var panelScrollViewer = FindAncestor<ScrollViewer>(this);
        if (panelScrollViewer == null) return;

        e.Handled = true;
        var verticalOffset = panelScrollViewer.VerticalOffset - e.Delta;
        panelScrollViewer.ScrollToVerticalOffset(Math.Max(0, verticalOffset));

    }

    /// <summary>
    ///     Walk up the visual tree to find an ancestor of the specified type.
    /// </summary>
    private static T? FindAncestor<T>(DependencyObject obj) where T : DependencyObject {
        var parent = VisualTreeHelper.GetParent(obj);
        while (parent != null) {
            if (parent is T typed)
                return typed;
            parent = VisualTreeHelper.GetParent(parent);
        }
        return null;
    }

    private void OnDataGridSorting(object? sender, DataGridSortingEventArgs e) {
        e.Handled = true;

        var columnName = ((StackPanel)e.Column.Header).Children.OfType<TextBlock>().First().Text;
        var direction = this._currentSortColumn == columnName && this._currentSortDirection == ListSortDirection.Ascending
            ? ListSortDirection.Descending
            : ListSortDirection.Ascending;

        this._currentSortColumn = columnName;
        this._currentSortDirection = direction;

        // Sort the data
        var sorted = direction == ListSortDirection.Ascending
            ? this._rows.OrderBy(r => r.Cells.TryGetValue(columnName, out var v) ? v : string.Empty).ToList()
            : this._rows.OrderByDescending(r => r.Cells.TryGetValue(columnName, out var v) ? v : string.Empty).ToList();

        this._rows.Clear();
        foreach (var row in sorted)
            this._rows.Add(row);

        // Update sort indicators
        this.UpdateSortIndicators(columnName, direction);
    }

    private void UpdateSortIndicators(string sortedColumn, ListSortDirection direction) {
        if (this._dataGrid == null) return;

        foreach (var column in this._dataGrid.Columns) {
            if (column.Header is StackPanel panel) {
                var textBlock = panel.Children.OfType<TextBlock>().First();
                var sortIcon = panel.Children.OfType<TextBlock>().Skip(1).FirstOrDefault();

                if (sortIcon != null) {
                    if (textBlock.Text == sortedColumn) {
                        sortIcon.Text = direction == ListSortDirection.Ascending ? "▲" : "▼";
                        sortIcon.Opacity = 1.0;
                    } else {
                        sortIcon.Text = "⇅";
                        sortIcon.Opacity = 0.5;
                    }
                }
            }
        }
    }
}

public class DataTableColumn {
    public string Name { get; set; } = string.Empty;
    public double Width { get; set; } = 0; // 0 = auto
    public double MaxWidth { get; set; } = 250; // Max width before horizontal scroll kicks in
    public int MaxCellLength { get; set; } = 100; // Characters before truncation
}

public class DataTableRow : INotifyPropertyChanged {
    public Dictionary<string, string> Cells { get; } = new(StringComparer.Ordinal);

    public event PropertyChangedEventHandler? PropertyChanged;
}
