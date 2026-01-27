using Pe.Global.Revit.Lib.Schedules.Fields;
using Pe.Global.Revit.Lib.Schedules.SortGroup;
using Pe.Ui.Core;
using System.Threading;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Documents;
using WpfUiRichTextBox = Wpf.Ui.Controls.RichTextBox;

namespace Pe.Tools.Commands.FamilyFoundry.ScheduleManagerUi;

/// <summary>
///     Side panel that displays schedule serialization preview data.
///     Implements ISidebarPanel for auto-wiring with PaletteFactory.
/// </summary>
public class ScheduleSerializePreviewPanel : UserControl, ISidebarPanel<IPaletteListItem> {
    private readonly WpfUiRichTextBox _richTextBox;
    private readonly Func<IPaletteListItem?, Pe.Tools.Commands.FamilyFoundry.ScheduleSerializePreviewData?> _previewBuilder;

    /// <summary>
    ///     Creates a ScheduleSerializePreviewPanel with injected preview building logic.
    /// </summary>
    public ScheduleSerializePreviewPanel(
        Func<IPaletteListItem?, Pe.Tools.Commands.FamilyFoundry.ScheduleSerializePreviewData?> previewBuilder
    ) {
        this._previewBuilder = previewBuilder;

        this._richTextBox = new WpfUiRichTextBox {
            IsReadOnly = true,
            Focusable = false,
            IsTextSelectionEnabled = true,
            AutoWordSelection = false,
            VerticalScrollBarVisibility = ScrollBarVisibility.Disabled,
            HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled
        };

        this.Content = this._richTextBox;
    }

    /// <inheritdoc />
    UIElement ISidebarPanel<IPaletteListItem>.Content => this;

    /// <inheritdoc />
    public void Clear() => this._richTextBox.Document = FlowDocumentBuilder.Create();

    /// <inheritdoc />
    public void Update(IPaletteListItem? item, CancellationToken ct) {
        if (ct.IsCancellationRequested) return;
        var data = this._previewBuilder(item);
        if (ct.IsCancellationRequested) return;
        this.UpdateContent(data);
    }

    private void UpdateContent(Pe.Tools.Commands.FamilyFoundry.ScheduleSerializePreviewData data) {
        if (data == null) {
            this._richTextBox.Document = FlowDocumentBuilder.Create();
            return;
        }

        var doc = FlowDocumentBuilder.Create()
            .AddHeader(data.ProfileName);

        // Validation Status Section
        if (!data.IsValid) {
            var statusPara = new Paragraph { Margin = new Thickness(0, 0, 0, 8) };
            var invalidRun = new Run("✗ Serialization Failed") { FontWeight = FontWeights.Bold, FontSize = 12 };
            invalidRun.SetResourceReference(Run.ForegroundProperty, "SystemFillColorCriticalBrush");
            statusPara.Inlines.Add(invalidRun);
            doc.Blocks.Add(statusPara);

            if (!string.IsNullOrEmpty(data.ErrorMessage)) {
                var errorPara = new Paragraph(new Run(data.ErrorMessage)) { Margin = new Thickness(0, 0, 0, 12) };
                errorPara.SetResourceReference(Paragraph.ForegroundProperty, "SystemFillColorCriticalBrush");
                doc.Blocks.Add(errorPara);
            }

            this._richTextBox.Document = doc;
            return;
        }

        // Success status
        var validStatusPara = new Paragraph { Margin = new Thickness(0, 0, 0, 8) };
        var validRun = new Run("✓ Ready to Serialize") { FontWeight = FontWeights.Bold, FontSize = 12 };
        validRun.SetResourceReference(Run.ForegroundProperty, "SystemFillColorSuccessBrush");
        validStatusPara.Inlines.Add(validRun);
        doc.Blocks.Add(validStatusPara);

        // Summary section
        var summaryPara = new Paragraph();
        summaryPara.Inlines.Add(new Run($"Category: {data.CategoryName}") { FontWeight = FontWeights.SemiBold });
        summaryPara.Inlines.Add(new LineBreak());
        summaryPara.Inlines.Add(new Run($"Itemized: {data.IsItemized}"));
        summaryPara.Inlines.Add(new LineBreak());
        summaryPara.Inlines.Add(new Run($"Fields: {data.Fields?.Count ?? 0}"));
        summaryPara.Inlines.Add(new LineBreak());
        summaryPara.Inlines.Add(new Run($"Sort/Group: {data.SortGroup?.Count ?? 0}"));
        summaryPara.Margin = new Thickness(0, 0, 0, 12);
        doc.Blocks.Add(summaryPara);

        // Fields list with details
        if (data.Fields != null && data.Fields.Count > 0) {
            _ = doc.AddSectionHeader($"Fields ({data.Fields.Count})");
            _ = doc.AddTable<ScheduleFieldSpec>(
                data.Fields,
                [
                    ("Name", f => f.ParameterName),
                    ("Header", f => f.ColumnHeaderOverride ?? string.Empty),
                    ("Display",
                        f => f.DisplayType != ScheduleFieldDisplayType.Standard
                            ? f.DisplayType.ToString()
                            : string.Empty),
                    ("Width", f => f.ColumnWidth.HasValue ? f.ColumnWidth.Value.ToString("F2") : string.Empty),
                    ("Type", f => f.CalculatedType.HasValue ? f.CalculatedType.Value.ToString() : string.Empty),
                    ("Hidden", f => f.IsHidden ? "Yes" : string.Empty)
                ],
                9
            );
        }

        // Sort/Group list with details
        if (data.SortGroup != null && data.SortGroup.Count > 0) {
            _ = doc.AddSectionHeader($"Sort/Group ({data.SortGroup.Count})");
            _ = doc.AddTable<ScheduleSortGroupSpec>(
                data.SortGroup,
                [
                    ("Field", sg => sg.FieldName),
                    ("Order", sg => sg.SortOrder.ToString()),
                    ("Header", sg => sg.ShowHeader ? "Yes" : string.Empty),
                    ("Footer", sg => sg.ShowFooter ? "Yes" : string.Empty),
                    ("Blank Line", sg => sg.ShowBlankLine ? "Yes" : string.Empty)
                ],
                9
            );
        }

        // Profile JSON section
        if (!string.IsNullOrEmpty(data.ProfileJson)) {
            _ = doc.AddSectionHeader("JSON Output Preview");
            _ = doc.AddJsonBlock(data.ProfileJson);
        }

        this._richTextBox.Document = doc;
    }
}
