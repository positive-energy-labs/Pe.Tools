using Pe.Global.Revit.Lib;
using Pe.Ui.Core;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Documents;
using WpfUiRichTextBox = Wpf.Ui.Controls.RichTextBox;

namespace Pe.Tools.Commands.FamilyFoundry.ScheduleManagerUi;

/// <summary>
///     Side panel that displays schedule profile preview data including fields, sort/group settings, and JSON.
///     Designed to be used as a sidebar in the palette.
/// </summary>
public class SchedulePreviewPanel : UserControl {
    private readonly WpfUiRichTextBox _richTextBox;

    public SchedulePreviewPanel() {
        // Palette handles sidebar padding and scrolling - just provide the content
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

    /// <summary>
    ///     Updates the preview panel with new data.
    /// </summary>
    public void UpdatePreview(SchedulePreviewData data) => this.UpdateContent(data);

    private void UpdateContent(SchedulePreviewData data) {
        if (data == null) {
            this._richTextBox.Document = FlowDocumentBuilder.Create();
            return;
        }

        var doc = FlowDocumentBuilder.Create()
            .AddHeader(data.ProfileName);

        // Validation Status Section (if there are errors)
        if (!data.IsValid || data.RemainingErrors.Any()) AddValidationSection(doc, data);

        // Only show details if profile is valid
        if (data.IsValid) {
            // Summary section
            var summaryPara = new Paragraph();
            summaryPara.Inlines.Add(
                new Run($"Category: {data.CategoryName}") { FontWeight = FontWeights.SemiBold });
            summaryPara.Inlines.Add(new LineBreak());
            summaryPara.Inlines.Add(new Run($"Itemized: {data.IsItemized}"));
            summaryPara.Inlines.Add(new LineBreak());
            summaryPara.Inlines.Add(new Run($"Fields: {data.FieldCount}"));
            summaryPara.Inlines.Add(new LineBreak());
            summaryPara.Inlines.Add(new Run($"Sort/Group: {data.SortGroupCount}"));
            summaryPara.Margin = new Thickness(0, 0, 0, 12);
            doc.Blocks.Add(summaryPara);

            // Fields list with details
            if (data.Fields.Count > 0) {
                doc.AddSectionHeader($"Fields ({data.FieldCount})");

                // Build table data
                doc.AddTable(
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
            if (data.SortGroup.Count > 0) {
                doc.AddSectionHeader($"Sort/Group ({data.SortGroupCount})");

                doc.AddTable(
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
                doc.AddSectionHeader("Profile Settings (JSON)");
                doc.AddJsonBlock(data.ProfileJson);
            }

            // File metadata section
            if (data.CreatedDate.HasValue || data.ModifiedDate.HasValue) {
                doc.AddSectionHeader("File Metadata");
                var metaPara = new Paragraph();
                if (data.CreatedDate.HasValue) {
                    metaPara.Inlines.Add(new Run($"Created: {data.CreatedDate:yyyy-MM-dd HH:mm:ss}"));
                    metaPara.Inlines.Add(new LineBreak());
                }

                if (data.ModifiedDate.HasValue)
                    metaPara.Inlines.Add(new Run($"Modified: {data.ModifiedDate:yyyy-MM-dd HH:mm:ss}"));
                metaPara.Margin = new Thickness(0, 0, 0, 12);
                metaPara.FontSize = 10;
                doc.Blocks.Add(metaPara);
            }
        }

        this._richTextBox.Document = doc;
    }

    private static void AddValidationSection(FlowDocument doc, SchedulePreviewData data) {
        // Status indicator
        var statusPara = new Paragraph { Margin = new Thickness(0, 0, 0, 8) };

        if (data.IsValid) {
            var validRun = new Run("✓ Valid Profile") { FontWeight = FontWeights.Bold, FontSize = 12 };
            validRun.SetResourceReference(Run.ForegroundProperty, "SystemFillColorSuccessBrush");
            statusPara.Inlines.Add(validRun);
        } else {
            var invalidRun = new Run("✗ Invalid Profile") { FontWeight = FontWeights.Bold, FontSize = 12 };
            invalidRun.SetResourceReference(Run.ForegroundProperty, "SystemFillColorCriticalBrush");
            statusPara.Inlines.Add(invalidRun);
        }

        doc.Blocks.Add(statusPara);

        // Remaining errors section (red)
        if (data.RemainingErrors.Any()) {
            var errorsHeader = new Paragraph(new Run("Validation Errors") { FontWeight = FontWeights.SemiBold }) {
                Margin = new Thickness(0, 8, 0, 4)
            };
            errorsHeader.SetResourceReference(Paragraph.ForegroundProperty, "SystemFillColorCriticalBrush");
            doc.Blocks.Add(errorsHeader);

            var errorsList = new List { MarkerStyle = TextMarkerStyle.Disc, Margin = new Thickness(16, 0, 0, 12) };
            foreach (var error in data.RemainingErrors) {
                var para = new Paragraph(new Run(error));
                para.SetResourceReference(Paragraph.ForegroundProperty, "SystemFillColorCriticalBrush");
                var listItem = new ListItem(para);
                errorsList.ListItems.Add(listItem);
            }

            doc.Blocks.Add(errorsList);
        }
    }
}

/// <summary>
///     Data model for schedule profile preview display.
/// </summary>
public class SchedulePreviewData {
    public string ProfileName { get; init; } = string.Empty;
    public string CategoryName { get; init; } = string.Empty;
    public bool IsItemized { get; init; }
    public int FieldCount => this.Fields.Count;
    public int SortGroupCount => this.SortGroup.Count;
    public List<ScheduleFieldSpec> Fields { get; init; } = [];
    public List<ScheduleSortGroupSpec> SortGroup { get; init; } = [];
    public string ProfileJson { get; init; } = string.Empty;

    // File metadata (from ScheduleListItem)
    public string FilePath { get; init; } = string.Empty;
    public DateTime? CreatedDate { get; init; }
    public DateTime? ModifiedDate { get; init; }

    // Validation status
    public bool IsValid { get; init; } = true;
    public List<string> RemainingErrors { get; init; } = [];
}