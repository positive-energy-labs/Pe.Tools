 using System.Windows;
using System.Windows.Documents;
using System.Windows.Media;

namespace Pe.Ui.Core;

/// <summary>
///     Fluent helpers for creating FlowDocument content with consistent styling.
///     Use extension methods to build themed documents with standard typography.
/// </summary>
public static class FlowDocumentBuilder {
    /// <summary>
    ///     Creates a themed FlowDocument with standard styling.
    /// </summary>
    public static FlowDocument Create() {
        var doc = new FlowDocument {
            PagePadding = new Thickness(0),
            TextAlignment = TextAlignment.Left,
            FontFamily = Theme.FontFamily,
            FontSize = 13,
            LineHeight = 1 // Minimal line height for compact display
        };
        doc.SetResourceReference(FlowDocument.ForegroundProperty, "TextFillColorSecondaryBrush");
        return doc;
    }

    /// <summary>
    ///     Adds a bold header paragraph.
    /// </summary>
    public static FlowDocument AddHeader(this FlowDocument doc, string title, double? fontSize = null) {
        var size = fontSize ?? 14;
        var para = new Paragraph(new Run(title) { FontWeight = FontWeights.Bold, FontSize = size }) {
            Margin = new Thickness(0, 0, 0, 6), // Reduced from 8
            LineHeight = 1
        };
        doc.Blocks.Add(para);
        return doc;
    }

    /// <summary>
    ///     Adds a section header with standard styling.
    /// </summary>
    public static FlowDocument AddSectionHeader(this FlowDocument doc, string title) {
        var header = new Paragraph(new Run(title) { FontWeight = FontWeights.SemiBold }) {
            Margin = new Thickness(0, 6, 0, 2), // Reduced from (0, 8, 0, 4)
            LineHeight = 1
        };
        doc.Blocks.Add(header);
        return doc;
    }

    /// <summary>
    ///     Adds a simple text paragraph.
    /// </summary>
    public static FlowDocument AddParagraph(this FlowDocument doc, string text, Thickness? margin = null) {
        var para = new Paragraph(new Run(text)) { Margin = margin ?? new Thickness(0, 0, 0, 8) };
        doc.Blocks.Add(para);
        return doc;
    }

    /// <summary>
    ///     Adds a key-value line (e.g., "Level: Floor 1").
    /// </summary>
    public static FlowDocument AddKeyValue(this FlowDocument doc, string key, string value) {
        var para = new Paragraph();
        para.Inlines.Add(new Run($"{key}: ") { FontWeight = FontWeights.SemiBold });
        para.Inlines.Add(new Run(value));
        para.Margin = new Thickness(0, 0, 0, 0); // Removed bottom margin
        para.LineHeight = 1; // Minimal line height
        doc.Blocks.Add(para);
        return doc;
    }

    /// <summary>
    ///     Adds validation status with colored indicator and optional error list.
    /// </summary>
    public static FlowDocument AddValidationStatus(this FlowDocument doc,
        bool isValid,
        IEnumerable<string>? errors = null) {
        var statusPara = new Paragraph { Margin = new Thickness(0, 0, 0, 8) };

        if (isValid) {
            var validRun = new Run("✓ Valid") { FontWeight = FontWeights.Bold, FontSize = 13 };
            validRun.SetResourceReference(Run.ForegroundProperty, "SystemFillColorSuccessBrush");
            statusPara.Inlines.Add(validRun);
        } else {
            var invalidRun = new Run("✗ Invalid") { FontWeight = FontWeights.Bold, FontSize = 13 };
            invalidRun.SetResourceReference(Run.ForegroundProperty, "SystemFillColorCriticalBrush");
            statusPara.Inlines.Add(invalidRun);
        }

        doc.Blocks.Add(statusPara);

        // Add errors if present
        var errorList = errors?.ToList();
        if (errorList is { Count: > 0 }) {
            var errorsHeader = new Paragraph(new Run("Errors") { FontWeight = FontWeights.SemiBold }) {
                Margin = new Thickness(0, 8, 0, 4)
            };
            errorsHeader.SetResourceReference(Paragraph.ForegroundProperty, "SystemFillColorCriticalBrush");
            doc.Blocks.Add(errorsHeader);

            var list = new List { MarkerStyle = TextMarkerStyle.Disc, Margin = new Thickness(16, 0, 0, 12) };
            foreach (var error in errorList) {
                var para = new Paragraph(new Run(error));
                para.SetResourceReference(Paragraph.ForegroundProperty, "SystemFillColorCriticalBrush");
                list.ListItems.Add(new ListItem(para));
            }

            doc.Blocks.Add(list);
        }

        return doc;
    }

    /// <summary>
    ///     Adds a monospace JSON code block.
    /// </summary>
    public static FlowDocument AddJsonBlock(this FlowDocument doc, string json) {
        if (string.IsNullOrEmpty(json)) return doc;

        var jsonPara = new Paragraph(new Run(json)) {
            FontFamily = new FontFamily("Consolas"),
            FontSize = 12,
            Margin = new Thickness(8, 0, 0, 12),
            Background = Brushes.Black,
            Foreground = Brushes.LightGray,
            Padding = new Thickness(8)
        };
        doc.Blocks.Add(jsonPara);
        return doc;
    }

    /// <summary>
    ///     Adds a bullet list from string items.
    /// </summary>
    public static FlowDocument AddBulletList(this FlowDocument doc, IEnumerable<string> items) {
        var itemList = items?.ToList();
        if (itemList is not { Count: > 0 }) return doc;

        var list = new List { MarkerStyle = TextMarkerStyle.Disc, Margin = new Thickness(16, 0, 0, 12) };
        foreach (var item in itemList) {
            var para = new Paragraph(new Run(item));
            list.ListItems.Add(new ListItem(para));
        }

        doc.Blocks.Add(list);
        return doc;
    }

    /// <summary>
    ///     Adds a numbered list from string items.
    /// </summary>
    public static FlowDocument AddNumberedList(this FlowDocument doc, IEnumerable<string> items) {
        var itemList = items?.ToList();
        if (itemList is not { Count: > 0 }) return doc;

        var list = new List { MarkerStyle = TextMarkerStyle.Decimal, Margin = new Thickness(16, 0, 0, 12) };
        foreach (var item in itemList) {
            var para = new Paragraph(new Run(item));
            list.ListItems.Add(new ListItem(para));
        }

        doc.Blocks.Add(list);
        return doc;
    }

    /// <summary>
    ///     Adds a bullet list with primary and secondary text per item.
    /// </summary>
    public static FlowDocument AddDetailList(
        this FlowDocument doc,
        IEnumerable<(string primary, string secondary)> items,
        TextMarkerStyle markerStyle = TextMarkerStyle.Disc
    ) {
        var itemList = items?.ToList();
        if (itemList is not { Count: > 0 }) return doc;

        var list = new List { MarkerStyle = markerStyle, Margin = new Thickness(16, 0, 0, 12) };
        foreach (var (primary, secondary) in itemList) {
            var para = new Paragraph();
            para.Inlines.Add(new Run(primary) { FontWeight = FontWeights.SemiBold });
            if (!string.IsNullOrEmpty(secondary)) {
                para.Inlines.Add(new LineBreak());
                para.Inlines.Add(new Run($"  {secondary}") { FontSize = 12 });
            }

            list.ListItems.Add(new ListItem(para));
        }

        doc.Blocks.Add(list);
        return doc;
    }

    /// <summary>
    ///     Adds a status indicator with check or X mark.
    /// </summary>
    public static FlowDocument AddStatusItem(this FlowDocument doc, string label, bool enabled) {
        var para = new Paragraph();
        var marker = enabled ? "✓ " : "✗ ";
        para.Inlines.Add(new Run(marker) {
            FontWeight = FontWeights.Bold,
            Foreground = enabled ? Brushes.Green : Brushes.Red
        });
        para.Inlines.Add(new Run(label));
        para.Margin = new Thickness(0, 0, 0, 2);
        doc.Blocks.Add(para);
        return doc;
    }

    /// <summary>
    ///     Adds a compact table with column headers and rows of data.
    ///     Simple API: pass column names and rows as dictionaries.
    /// </summary>
    /// <param name="doc">The FlowDocument to add the table to</param>
    /// <param name="columns">Column names in display order</param>
    /// <param name="rows">List of row data as dictionaries (key = column name, value = cell content)</param>
    /// <param name="fontSize">Font size for table content (null = use Caption size)</param>
    /// <param name="margin">Margin around the table</param>
    /// <returns>The FlowDocument for chaining</returns>
    public static FlowDocument AddTable(
        this FlowDocument doc,
        IEnumerable<string> columns,
        IEnumerable<Dictionary<string, string>> rows,
        double? fontSize = null,
        Thickness? margin = null
    ) {
        var size = fontSize ?? 12;
        var columnList = columns?.ToList();
        var rowList = rows?.ToList();

        if (columnList is not { Count: > 0 } || rowList is not { Count: > 0 })
            return doc;

        var table = new Table { CellSpacing = 0, FontSize = size, Margin = margin ?? new Thickness(0, 0, 0, 12) };

        // Define columns
        foreach (var _ in columnList)
            table.Columns.Add(new TableColumn());

        // Add header row
        var headerGroup = new TableRowGroup();
        var headerRow = new TableRow();
        headerRow.SetResourceReference(TableRow.BackgroundProperty, "ControlFillColorDefaultBrush");

        foreach (var column in columnList) {
            var cell = new TableCell(new Paragraph(new Run(column) {
                FontWeight = FontWeights.SemiBold,
                FontSize = size
            }) { Margin = new Thickness(4, 2, 4, 2) }) { Padding = new Thickness(0) };
            headerRow.Cells.Add(cell);
        }

        headerGroup.Rows.Add(headerRow);
        table.RowGroups.Add(headerGroup);

        // Add data rows
        var dataGroup = new TableRowGroup();
        var isAlternate = false;

        foreach (var rowData in rowList) {
            var dataRow = new TableRow();

            // Alternate row background for readability
            if (isAlternate)
                dataRow.SetResourceReference(TableRow.BackgroundProperty, "ControlFillColorDefaultBrush");

            foreach (var column in columnList) {
                var value = rowData.TryGetValue(column, out var v) ? v : string.Empty;
                var cell = new TableCell(new Paragraph(new Run(value) { FontSize = size }) {
                    Margin = new Thickness(4, 2, 4, 2)
                }) { Padding = new Thickness(0) };
                dataRow.Cells.Add(cell);
            }

            dataGroup.Rows.Add(dataRow);
            isAlternate = !isAlternate;
        }

        table.RowGroups.Add(dataGroup);
        doc.Blocks.Add(table);
        return doc;
    }

    /// <summary>
    ///     Adds a compact table from objects using property selectors.
    ///     More type-safe API for when you have strongly-typed data.
    /// </summary>
    /// <typeparam name="T">Type of the data objects</typeparam>
    /// <param name="doc">The FlowDocument to add the table to</param>
    /// <param name="items">Data items to display</param>
    /// <param name="columns">Column definitions (name, selector function)</param>
    /// <param name="fontSize">Font size for table content (null = use Caption size)</param>
    /// <param name="margin">Margin around the table</param>
    /// <returns>The FlowDocument for chaining</returns>
    public static FlowDocument AddTable<T>(
        this FlowDocument doc,
        IEnumerable<T> items,
        IEnumerable<(string columnName, Func<T, string> selector)> columns,
        double? fontSize = null,
        Thickness? margin = null
    ) {
        var itemList = items?.ToList();
        var columnList = columns?.ToList();

        if (columnList is not { Count: > 0 } || itemList is not { Count: > 0 })
            return doc;

        // Convert to dictionary format and use main AddTable method
        var columnNames = columnList.Select(c => c.columnName);
        var rows = itemList.Select(item => {
            var row = new Dictionary<string, string>();
            foreach (var (columnName, selector) in columnList)
                row[columnName] = selector(item) ?? string.Empty;
            return row;
        });

        return doc.AddTable(columnNames, rows, fontSize, margin);
    }
}