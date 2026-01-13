using Pe.Ui.Core;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Documents;
using System.Windows.Media;
using WpfUiRichTextBox = Wpf.Ui.Controls.RichTextBox;

// Note: This panel has complex domain-specific rendering that benefits from manual FlowDocument building.
// FlowDocumentBuilder helpers are used where applicable (Create, AddSectionHeader, AddJsonBlock).

namespace Pe.Tools.Commands.FamilyFoundry.FamilyFoundryUi;

/// <summary>
///     Side panel that displays profile preview data including operations, parameters, and families.
///     Designed to be used as a sidebar in the palette.
/// </summary>
public class ProfilePreviewPanel : UserControl {
    private readonly WpfUiRichTextBox _richTextBox;

    public ProfilePreviewPanel() {
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
    public void UpdatePreview(PreviewData data) => this.UpdateContent(data);

    private void UpdateContent(PreviewData data) {
        if (data == null) {
            this._richTextBox.Document = FlowDocumentBuilder.Create();
            return;
        }

        var doc = FlowDocumentBuilder.Create()
            .AddHeader(data.ProfileName);

        // Validation Status Section (if there are fixes or errors)
        if (!data.IsValid || data.AppliedFixes.Any() || data.RemainingErrors.Any()) AddValidationSection(doc, data);

        // Only show operations/params/families if profile is valid
        if (data.IsValid) {
            // Summary section
            var summaryPara = new Paragraph();
            summaryPara.Inlines.Add(
                new Run($"Operations: {data.OperationCount}") { FontWeight = FontWeights.SemiBold });
            summaryPara.Inlines.Add(new LineBreak());
            summaryPara.Inlines.Add(new Run($"APS Parameters: {data.ApsParameterCount}"));
            summaryPara.Inlines.Add(new LineBreak());
            summaryPara.Inlines.Add(new Run($"AddAndSet Parameters: {data.AddAndSetParameterCount}"));
            summaryPara.Inlines.Add(new LineBreak());
            summaryPara.Inlines.Add(new Run($"Families: {data.FamilyCount}"));
            summaryPara.Margin = new Thickness(0, 0, 0, 12);
            doc.Blocks.Add(summaryPara);

            // Operations list with enabled status
            if (data.Operations.Count > 0) {
                doc.AddSectionHeader("Operations");
                var opList = new List { MarkerStyle = TextMarkerStyle.Decimal, Margin = new Thickness(16, 0, 0, 12) };
                foreach (var op in data.Operations) {
                    var enabledText = op.Enabled ? "✓" : "✗";
                    var para = new Paragraph();
                    para.Inlines.Add(new Run($"{enabledText} ") {
                        FontWeight = FontWeights.Bold,
                        Foreground = op.Enabled
                            ? Brushes.Green
                            : Brushes.Red
                    });
                    para.Inlines.Add(new Run($"{op.Name}"));
                    para.Inlines.Add(new LineBreak());
                    para.Inlines.Add(new Run($"  Type: {op.Type}, Batch: {op.IsMerged}") { FontSize = 10 });
                    var listItem = new ListItem(para);
                    opList.ListItems.Add(listItem);
                }

                doc.Blocks.Add(opList);
            }

            // APS Parameters list with details
            if (data.ApsParameters.Count > 0) {
                doc.AddSectionHeader("APS Parameters (from Parameters Service)");
                var paramList = new List { MarkerStyle = TextMarkerStyle.Disc, Margin = new Thickness(16, 0, 0, 12) };
                foreach (var param in data.ApsParameters) {
                    var para = new Paragraph();
                    para.Inlines.Add(new Run(param.Name) { FontWeight = FontWeights.SemiBold });
                    para.Inlines.Add(new LineBreak());
                    para.Inlines.Add(
                        new Run($"  {(param.IsInstance ? "Instance" : "Type")}, {param.DataType}") { FontSize = 10 });
                    var listItem = new ListItem(para);
                    paramList.ListItems.Add(listItem);
                }

                doc.Blocks.Add(paramList);
            }

            // AddAndSet Parameters list with details
            if (data.AddAndSetParameters.Count > 0) {
                doc.AddSectionHeader("AddAndSet Parameters (set by profile)");
                var paramList = new List { MarkerStyle = TextMarkerStyle.Disc, Margin = new Thickness(16, 0, 0, 12) };
                foreach (var param in data.AddAndSetParameters) {
                    var para = new Paragraph();
                    para.Inlines.Add(new Run(param.Name) { FontWeight = FontWeights.SemiBold });
                    para.Inlines.Add(new LineBreak());
                    para.Inlines.Add(
                        new Run($"  {(param.IsInstance ? "Instance" : "Type")}, {param.DataType}") { FontSize = 10 });
                    var listItem = new ListItem(para);
                    paramList.ListItems.Add(listItem);
                }

                doc.Blocks.Add(paramList);
            }

            // Families list with categories
            if (data.Families.Count > 0) {
                doc.AddSectionHeader("Families to Process");
                var famList = new List { MarkerStyle = TextMarkerStyle.Disc, Margin = new Thickness(16, 0, 0, 12) };
                foreach (var fam in data.Families) {
                    var para = new Paragraph();
                    para.Inlines.Add(new Run(fam.Name) { FontWeight = FontWeights.SemiBold });
                    para.Inlines.Add(new LineBreak());
                    para.Inlines.Add(new Run($"  Category: {fam.Category}") { FontSize = 10 });
                    var listItem = new ListItem(para);
                    famList.ListItems.Add(listItem);
                }

                doc.Blocks.Add(famList);
            }

            // Profile JSON section
            if (!string.IsNullOrEmpty(data.ProfileJson)) {
                doc.AddSectionHeader("Profile Settings (JSON)");
                doc.AddJsonBlock(data.ProfileJson);
            }
        }

        this._richTextBox.Document = doc;
    }

    private static void AddValidationSection(FlowDocument doc, PreviewData data) {
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

        // Applied fixes section (green)
        if (data.AppliedFixes.Any()) {
            var fixesHeader = new Paragraph(new Run("Applied Fixes") { FontWeight = FontWeights.SemiBold }) {
                Margin = new Thickness(0, 8, 0, 4)
            };
            fixesHeader.SetResourceReference(Paragraph.ForegroundProperty, "SystemFillColorSuccessBrush");
            doc.Blocks.Add(fixesHeader);

            var fixesList = new List { MarkerStyle = TextMarkerStyle.Disc, Margin = new Thickness(16, 0, 0, 12) };
            foreach (var fix in data.AppliedFixes) {
                var para = new Paragraph(new Run(fix));
                para.SetResourceReference(Paragraph.ForegroundProperty, "SystemFillColorSuccessBrush");
                var listItem = new ListItem(para);
                fixesList.ListItems.Add(listItem);
            }

            doc.Blocks.Add(fixesList);
        }

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
///     Data model for profile preview display.
/// </summary>
public class PreviewData {
    public string ProfileName { get; init; } = string.Empty;
    public int OperationCount => this.Operations.Count;
    public int ApsParameterCount => this.ApsParameters.Count;
    public int AddAndSetParameterCount => this.AddAndSetParameters.Count;
    public int FamilyCount => this.Families.Count;
    public List<OperationInfo> Operations { get; init; } = [];
    public List<ParameterInfo> ApsParameters { get; init; } = [];
    public List<ParameterInfo> AddAndSetParameters { get; init; } = [];
    public List<FamilyInfo> Families { get; init; } = [];
    public string ProfileJson { get; init; } = string.Empty;

    // File metadata (from ProfileListItem)
    public string FilePath { get; init; } = string.Empty;
    public DateTime? CreatedDate { get; init; }
    public DateTime? ModifiedDate { get; init; }
    public int LineCount { get; init; }

    // Validation status
    public bool IsValid { get; init; } = true;
    public List<string> AppliedFixes { get; init; } = [];
    public List<string> RemainingErrors { get; init; } = [];
}

/// <summary>
///     Operation info for preview display.
/// </summary>
public record OperationInfo(string Name, string Description, string Type, string IsMerged, bool Enabled);

/// <summary>
///     Parameter info for preview display.
/// </summary>
public record ParameterInfo(string Name, bool IsInstance, string DataType);

/// <summary>
///     Family info for preview display.
/// </summary>
public record FamilyInfo(string Name, string Category);