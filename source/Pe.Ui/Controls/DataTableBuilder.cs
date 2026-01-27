using System.Windows;

namespace Pe.Ui.Controls;

/// <summary>
///     Fluent builder for creating <see cref="SortableDataTable" /> instances.
///     Modeled after <see cref="Pe.Ui.Core.FlowDocumentBuilder" /> for consistent API style.
/// </summary>
/// <example>
///     Basic usage with typed data:
///     <code>
///     var table = DataTableBuilder.Create()
///         .AddColumn("Name", 150)
///         .AddColumn("Type", 120)
///         .AddColumn("Value", 200)
///         .AddRows(parameters,
///             ("Name", p => p.Name),
///             ("Type", p => p.DataType),
///             ("Value", p => p.Value ?? "-"))
///         .Build();
///     </code>
/// </example>
/// <example>
///     Manual row construction:
///     <code>
///     var table = DataTableBuilder.Create()
///         .AddColumn("Key", 100)
///         .AddColumn("Value", 200)
///         .AddRow(("Key", "Name"), ("Value", item.Name))
///         .AddRow(("Key", "Type"), ("Value", item.Type))
///         .Build();
///     </code>
/// </example>
public class DataTableBuilder {
    private readonly List<DataTableColumn> _columns = new();
    private readonly List<Dictionary<string, string>> _rows = new();
    private Thickness _margin = new(0, 0, 0, 12);

    private DataTableBuilder() { }

    /// <summary>
    ///     Creates a new DataTableBuilder instance.
    /// </summary>
    public static DataTableBuilder Create() => new();

    /// <summary>
    ///     Adds a column definition to the table.
    /// </summary>
    /// <param name="name">Column header name</param>
    /// <param name="width">Column width (0 = auto)</param>
    /// <param name="maxWidth">Maximum column width before horizontal scroll (default: 250)</param>
    /// <param name="maxCellLength">Maximum characters before truncation (default: 100)</param>
    public DataTableBuilder AddColumn(string name, double width = 0, double maxWidth = 250, int maxCellLength = 100) {
        this._columns.Add(new DataTableColumn {
            Name = name,
            Width = width,
            MaxWidth = maxWidth,
            MaxCellLength = maxCellLength
        });
        return this;
    }

    /// <summary>
    ///     Adds a single row with specified column values.
    /// </summary>
    /// <param name="cells">Tuple pairs of (columnName, value)</param>
    public DataTableBuilder AddRow(params (string column, string value)[] cells) {
        var row = new Dictionary<string, string>();
        foreach (var (column, value) in cells)
            row[column] = value;
        this._rows.Add(row);
        return this;
    }

    /// <summary>
    ///     Adds multiple rows from a collection using column selectors.
    ///     This is the preferred method for bulk data population.
    /// </summary>
    /// <typeparam name="T">Type of source items</typeparam>
    /// <param name="items">Source collection</param>
    /// <param name="columns">Tuple pairs of (columnName, valueSelector)</param>
    public DataTableBuilder AddRows<T>(
        IEnumerable<T> items,
        params (string column, Func<T, string> selector)[] columns
    ) {
        foreach (var item in items) {
            var row = new Dictionary<string, string>();
            foreach (var (column, selector) in columns)
                row[column] = selector(item) ?? string.Empty;
            this._rows.Add(row);
        }
        return this;
    }

    /// <summary>
    ///     Adds multiple rows from pre-built dictionaries.
    ///     Use this when you have complex row-building logic.
    /// </summary>
    /// <param name="rows">Pre-built row dictionaries</param>
    public DataTableBuilder AddRows(IEnumerable<Dictionary<string, string>> rows) {
        this._rows.AddRange(rows);
        return this;
    }

    /// <summary>
    ///     Sets the margin around the table. Default is (0, 0, 0, 12).
    /// </summary>
    public DataTableBuilder WithMargin(Thickness margin) {
        this._margin = margin;
        return this;
    }

    /// <summary>
    ///     Builds the SortableDataTable with the configured columns and rows.
    /// </summary>
    /// <returns>A configured SortableDataTable ready to add to the visual tree</returns>
    public SortableDataTable Build() {
        var table = new SortableDataTable { Margin = this._margin };
        table.SetData(this._columns, this._rows);
        return table;
    }

    /// <summary>
    ///     Returns true if there are any rows to display.
    /// </summary>
    public bool HasRows => this._rows.Count > 0;

    /// <summary>
    ///     Returns the number of rows.
    /// </summary>
    public int RowCount => this._rows.Count;
}
