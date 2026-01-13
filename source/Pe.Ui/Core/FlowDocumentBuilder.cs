using System.Windows;
using System.Windows.Controls;
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
            FontFamily = ThemeManager.FontFamily(),
            FontSize = 11,
            LineHeight = 15.0
        };
        doc.SetResourceReference(FlowDocument.ForegroundProperty, "TextFillColorSecondaryBrush");
        return doc;
    }

    /// <summary>
    ///     Adds a bold header paragraph.
    /// </summary>
    public static FlowDocument AddHeader(this FlowDocument doc, string title, int fontSize = 14) {
        var para = new Paragraph(new Run(title) { FontWeight = FontWeights.Bold, FontSize = fontSize }) {
            Margin = new Thickness(0, 0, 0, 8)
        };
        doc.Blocks.Add(para);
        return doc;
    }

    /// <summary>
    ///     Adds a section header with standard styling.
    /// </summary>
    public static FlowDocument AddSectionHeader(this FlowDocument doc, string title) {
        var header = new Paragraph(new Run(title) { FontWeight = FontWeights.SemiBold }) {
            Margin = new Thickness(0, 8, 0, 4)
        };
        doc.Blocks.Add(header);
        return doc;
    }

    /// <summary>
    ///     Adds a simple text paragraph.
    /// </summary>
    public static FlowDocument AddParagraph(this FlowDocument doc, string text, Thickness? margin = null) {
        var para = new Paragraph(new Run(text)) {
            Margin = margin ?? new Thickness(0, 0, 0, 8)
        };
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
        para.Margin = new Thickness(0, 0, 0, 2);
        doc.Blocks.Add(para);
        return doc;
    }

    /// <summary>
    ///     Adds validation status with colored indicator and optional error list.
    /// </summary>
    public static FlowDocument AddValidationStatus(this FlowDocument doc, bool isValid, IEnumerable<string> errors = null) {
        var statusPara = new Paragraph { Margin = new Thickness(0, 0, 0, 8) };

        if (isValid) {
            var validRun = new Run("✓ Valid") { FontWeight = FontWeights.Bold, FontSize = 12 };
            validRun.SetResourceReference(Run.ForegroundProperty, "SystemFillColorSuccessBrush");
            statusPara.Inlines.Add(validRun);
        } else {
            var invalidRun = new Run("✗ Invalid") { FontWeight = FontWeights.Bold, FontSize = 12 };
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
            FontSize = 9,
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
                para.Inlines.Add(new Run($"  {secondary}") { FontSize = 10 });
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
}
