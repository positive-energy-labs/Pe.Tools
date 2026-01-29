using Pe.Ui.Core;
using System.Threading;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Documents;
using System.Windows.Threading;
using WpfUiRichTextBox = Wpf.Ui.Controls.RichTextBox;

namespace Pe.App.Commands.Palette.FamilyPalette;

/// <summary>
///     Reusable sidebar panel for displaying family/type/instance previews.
///     Shows family info, parameter table with values per type or formulas, and instance-specific details.
///     Implements <see cref="ISidebarPanel{TItem}" /> for auto-wiring with <see cref="UnifiedFamilyItem" />.
///     Uses async loading pattern to keep the UI responsive during navigation.
/// </summary>
public class FamilyPreviewPanel : UserControl, ISidebarPanel<UnifiedFamilyItem> {
    private readonly StackPanel _mainPanel;
    private readonly WpfUiRichTextBox _infoBox;
    private readonly Document _doc; 
    private FamilyPreviewData? _currentData;

    public FamilyPreviewPanel(Document doc) {
        this._doc = doc;

        // Main container
        this._mainPanel = new StackPanel();

        // Info section (header, summary, etc) - uses FlowDocument for text
        this._infoBox = new WpfUiRichTextBox {
            IsReadOnly = true,
            Focusable = false,
            IsTextSelectionEnabled = true,
            AutoWordSelection = false,
            VerticalScrollBarVisibility = ScrollBarVisibility.Disabled,
            HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled,
            Margin = new Thickness(0, 0, 0, 8)
        };

        _ = this._mainPanel.Children.Add(this._infoBox);
        base.Content = this._mainPanel;
    }

    #region ISidebarPanel Implementation

    /// <inheritdoc />
    UIElement ISidebarPanel<UnifiedFamilyItem>.Content => this;

    /// <inheritdoc />
    /// <summary>
    ///     Called immediately on selection change (before debounce).
    ///     Clears stale content so the user doesn't see old data during navigation.
    /// </summary>
    public void Clear() => this.ClearPreview();

    /// <inheritdoc />
    /// <summary>
    ///     Called after debounce with cancellation support.
    /// </summary>
    public void Update(UnifiedFamilyItem? item, CancellationToken ct) {
        if (item == null) {
            this.ClearPreview();
            return;
        }

        // Check for cancellation before starting work
        if (ct.IsCancellationRequested) return;

        // Phase 1: Show immediate lightweight content (header/basic info)
        // This gives user instant feedback that something is loading
        this.ShowQuickPreview(item);

        // Phase 2: Build and render full preview data
        var previewData = item.PreviewData;
        if (ct.IsCancellationRequested) return;
        this.UpdatePreview(previewData);
    }

    /// <summary>
    ///     Shows lightweight preview content immediately.
    ///     This runs before the expensive PreviewData computation.
    /// </summary>
    private void ShowQuickPreview(UnifiedFamilyItem item) {
        // Show basic info that's cheap to access (already computed in the item)
        var doc = FlowDocumentBuilder.Create();
        _ = doc.AddHeader(item.TextPrimary);
        _ = doc.AddKeyValue("Category", item.TextPill);

        // Add loading indicator for parameters
        var loadingPara = new Paragraph(new Run("Loading...") {
            FontStyle = FontStyles.Italic,
            Foreground = System.Windows.Media.Brushes.Gray
        }) {
            Margin = new Thickness(0, 8, 0, 0)
        };
        doc.Blocks.Add(loadingPara);

        this._infoBox.Document = doc;
    }

    #endregion

    /// <summary>Updates preview from pre-built data</summary>
    public void UpdatePreview(FamilyPreviewData? data) {
        this._currentData = data;
        if (data == null)
            this.ClearPreview();
        else
            this.RenderPreview();
    }

    private void ClearPreview() {
        this._currentData = null;
        this._infoBox.Document = FlowDocumentBuilder.Create();

    }

    private void RenderPreview() {
        if (this._currentData == null) {
            this.ClearPreview();
            return;
        }

        var data = this._currentData;

        // Build info section with reduced line height
        var doc = FlowDocumentBuilder.Create();
        // LineHeight is already set to 1 in Create()

        // Header based on source
        var header = data.Source switch {
            FamilyPreviewSource.Family => data.FamilyName,
            FamilyPreviewSource.FamilySymbol => $"{data.FamilyName}: {data.TypeName}",
            FamilyPreviewSource.FamilyInstance => $"{data.FamilyName}: {data.TypeName}",
            _ => data.FamilyName
        };
        _ = doc.AddHeader(header);

        // Summary section with compact margins
        _ = doc.AddKeyValue("Category", data.CategoryName);
        _ = doc.AddKeyValue("Types", data.TypeCount.ToString());

        // Instance-specific info
        if (data.Source == FamilyPreviewSource.FamilyInstance) {
            if (!string.IsNullOrEmpty(data.InstanceId))
                _ = doc.AddKeyValue("Instance ID", data.InstanceId);
            if (!string.IsNullOrEmpty(data.InstanceLevel))
                _ = doc.AddKeyValue("Level", data.InstanceLevel);
            if (!string.IsNullOrEmpty(data.InstanceHost))
                _ = doc.AddKeyValue("Host", data.InstanceHost);
            if (data.InstanceLocation.HasValue) {
                var loc = data.InstanceLocation.Value;
                _ = doc.AddKeyValue("Location", $"({loc.X:F2}, {loc.Y:F2}, {loc.Z:F2})");
            }
        }

        this._infoBox.Document = doc;

        if (data.Parameters.Count > 0) {
            // Parameter summary with compact styling
            _ = doc.AddSectionHeader("Parameters");
            var summaryPara = new Paragraph { Margin = new Thickness(0, 0, 0, 2), FontSize = 13, LineHeight = 1 };
            summaryPara.Inlines.Add(new Run($"Type: {data.TypeParameterCount}  |  Instance: {data.InstanceParameterCount}"));
            if (data.FormulaParameterCount > 0) {
                summaryPara.Inlines.Add(new Run($"  |  Formula-driven: {data.FormulaParameterCount}"));
            }
            this._infoBox.Document.Blocks.Add(summaryPara);

            // Add parameter tables using custom control
            this.AddParameterTable(doc, data, isInstance: false, "Type Parameters");
            this.AddParameterTable(doc, data, isInstance: true, "Instance Parameters");
        }
    }

    private void AddParameterTable(FlowDocument doc, FamilyPreviewData data, bool isInstance, string sectionTitle) {
        var parameters = data.Parameters.Where(p => p.IsInstance == isInstance).ToList();
        if (parameters.Count == 0)
            return;

        // Add section header to info box
        var headerPara = new Paragraph(new Run(sectionTitle) { FontWeight = FontWeights.SemiBold }) {
            Margin = new Thickness(0, 6, 0, 2),
            LineHeight = 1
        };
        doc.Blocks.Add(headerPara);

        // For Family source with multiple types, show a multi-type table
        // For FamilySymbol/Instance, show single value column
        if (data.Source == FamilyPreviewSource.Family && data.TypeNames.Count > 1) {
            var (columns, rows) = this.BuildMultiTypeTableData(data, parameters);
            _ = doc.AddTable(columns, rows);
            return;
        }

        var (singleColumns, singleRows) = this.BuildSingleTypeTableData(data, parameters);
        _ = doc.AddTable(singleColumns, singleRows);
    }

    private (List<string> columns, List<Dictionary<string, string>> rows) BuildMultiTypeTableData(
        FamilyPreviewData data,
        List<FamilyParameterPreview> parameters
    ) {
        var hasFormulas = parameters.Any(p => !string.IsNullOrEmpty(p.Formula));

        var columns = new List<string> { "Name", "Type" };
        if (hasFormulas)
            columns.Add("Formula");

        columns.AddRange(data.TypeNames);

        // Build rows using dictionary format for dynamic columns
        var rows = parameters.Select(param => {
            var row = new Dictionary<string, string> {
                ["Name"] = param.Name,
                ["Type"] = param.DataType
            };

            if (hasFormulas)
                row["Formula"] = param.Formula ?? string.Empty;

            foreach (var typeName in data.TypeNames)
                row[typeName] = param.ValuesPerType.TryGetValue(typeName, out var v) ? v ?? "-" : "-";

            return row;
        }).ToList();

        return (columns, rows);
    }

    private (List<string> columns, List<Dictionary<string, string>> rows) BuildSingleTypeTableData(
        FamilyPreviewData data,
        List<FamilyParameterPreview> parameters
    ) {
        var typeName = data.TypeName ?? data.TypeNames.FirstOrDefault() ?? string.Empty;

        var columns = new List<string> { "Name", "Type", "Value/Formula" };
        var rows = parameters.Select(param => new Dictionary<string, string> {
            ["Name"] = param.Name,
            ["Type"] = param.DataType,
            ["Value/Formula"] = this.GetValueOrFormula(param, data, typeName)
        }).ToList();

        return (columns, rows);
    }

    private string GetValueOrFormula(FamilyParameterPreview param, FamilyPreviewData data, string typeName) {
        if (!string.IsNullOrEmpty(param.Formula))
            return $"={param.Formula}";

        if (data.Source == FamilyPreviewSource.FamilyInstance && param.IsInstance && param.InstanceValue != null)
            return param.InstanceValue;

        return param.ValuesPerType.TryGetValue(typeName, out var v) ? v ?? "-" : "-";
    }
}

