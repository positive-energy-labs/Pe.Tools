using Pe.Revit.Ui.Core;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Documents;
using System.Windows.Media;
using WpfUiRichTextBox = Wpf.Ui.Controls.RichTextBox;

namespace Pe.App.Commands.Palette.ViewPalette;

/// <summary>
///     Sidebar panel that displays view details using FlowDocumentBuilder.
///     Uses the shared sidebar pipeline so Revit reads happen before UI rendering.
/// </summary>
public class ViewPreviewPanel : PaletteSidebarPanel<UnifiedViewItem, ViewPreviewData> {
    private readonly WpfUiRichTextBox _richTextBox;

    public ViewPreviewPanel() {
        // Palette handles sidebar padding and scrolling - just provide the content
        this._richTextBox = new WpfUiRichTextBox {
            IsReadOnly = true,
            IsDocumentEnabled = true,
            Focusable = false,
            IsTextSelectionEnabled = true,
            AutoWordSelection = false,
            VerticalScrollBarVisibility = ScrollBarVisibility.Disabled,
            HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled
        };

        base.Content = this._richTextBox;
    }

    protected override void ShowLoading(UnifiedViewItem item) {
        var doc = FlowDocumentBuilder.Create()
            .AddHeader(item.TextPrimary);

        var loadingPara = new Paragraph(new Run("Loading...") {
            FontStyle = FontStyles.Italic,
            Foreground = Brushes.Gray
        }) { Margin = new Thickness(0, 8, 0, 0) };

        doc.Blocks.Add(loadingPara);
        this._richTextBox.Document = doc;
    }

    protected override async Task<ViewPreviewData?> BuildDataAsync(UnifiedViewItem item, CancellationToken ct) {
        if (ct.IsCancellationRequested) return null;
        return await PaletteThreading.RunRevitAsync(() => this.BuildPreviewData(item), ct);
    }

    protected override void RenderData(ViewPreviewData? data) {
        if (data == null) {
            this.ClearContent();
            return;
        }

        var doc = FlowDocumentBuilder.Create()
            .AddHeader(data.Header);

        foreach (var section in data.Sections) {
            if (!string.IsNullOrEmpty(section.Header))
                _ = doc.AddSectionHeader(section.Header);

            foreach (var (key, value) in section.KeyValues)
                _ = doc.AddKeyValue(key, value);

            foreach (var paragraph in section.Paragraphs)
                _ = doc.AddParagraph(paragraph);

            if (section.BulletItems.Count > 0)
                _ = doc.AddBulletList(section.BulletItems);

            if (section.DetailItems.Count > 0)
                _ = doc.AddDetailList(section.DetailItems);
        }

        this._richTextBox.Document = doc;
    }

    protected override void ClearContent() => this._richTextBox.Document = FlowDocumentBuilder.Create();

    private ViewPreviewData BuildPreviewData(UnifiedViewItem item) => item.ItemType switch {
        ViewItemType.View => this.BuildViewPreviewData(item),
        ViewItemType.Schedule => this.BuildSchedulePreviewData(item),
        ViewItemType.Sheet => this.BuildSheetPreviewData(item),
        _ => new ViewPreviewData("Invalid View", [])
    };

    private ViewPreviewData BuildViewPreviewData(UnifiedViewItem item) {
        var view = item.View;
        var summary = new List<(string key, string value)> {
            ("Type", view.ViewType.ToString()),
            ("Detail Level", view.DetailLevel.ToString())
        };

        var level = view.FindParameter(BuiltInParameter.PLAN_VIEW_LEVEL)?.AsValueString();
        if (!string.IsNullOrEmpty(level))
            summary.Add(("Level", level));

        if (view.HasViewDiscipline())
            summary.Add(("Discipline", view.Discipline.ToString()));

        var viewUse = view.FindParameter("View Use")?.AsString();
        if (!string.IsNullOrEmpty(viewUse))
            summary.Add(("View Use", viewUse));

        var templateId = view.ViewTemplateId;
        if (templateId != ElementId.InvalidElementId) {
            var template = view.Document.GetElement(templateId);
            if (template != null)
                summary.Add(("Template", template.Name));
        }

        var scale = view.FindParameter(BuiltInParameter.VIEW_SCALE)?.AsInteger();
        if (scale.HasValue && scale.Value > 0)
            summary.Add(("Scale", $"1:{scale.Value}"));

        return new ViewPreviewData(view.Name, [
            new ViewPreviewSection(null, summary),
            new ViewPreviewSection("Profile", [("Id", view.Id.ToString())])
        ]);
    }

    private ViewPreviewData BuildSchedulePreviewData(UnifiedViewItem item) {
        var schedule = item.AsSchedule;
        if (schedule == null)
            return new ViewPreviewData("Invalid Schedule", []);

        var summary = new List<(string key, string value)>();
        var discipline = schedule.FindParameter("Discipline")?.AsValueString();
        if (!string.IsNullOrEmpty(discipline))
            summary.Add(("Discipline", discipline));

        var definition = schedule.Definition;
        if (definition != null)
            summary.Add(("Fields", definition.GetFieldCount().ToString()));

        var instances = schedule.GetScheduleInstances(-1);
        var placements = new List<string>();
        var docRef = schedule.Document;
        foreach (var instId in instances) {
            var inst = docRef.GetElement(instId);
            if (inst?.OwnerViewId != null) {
                var sheet = docRef.GetElement(inst.OwnerViewId) as ViewSheet;
                if (sheet != null)
                    placements.Add($"{sheet.SheetNumber} - {sheet.Name}");
            }
        }

        return new ViewPreviewData(schedule.Name, [
            new ViewPreviewSection(null, summary),
            placements.Count == 0
                ? new ViewPreviewSection("Sheet Placements", [], ["Not placed on any sheets"])
                : new ViewPreviewSection("Sheet Placements", [], bulletItems: placements),
            new ViewPreviewSection("Profile", [("Id", schedule.Id.ToString())])
        ]);
    }

    private ViewPreviewData BuildSheetPreviewData(UnifiedViewItem item) {
        var sheet = item.AsSheet;
        if (sheet == null)
            return new ViewPreviewData("Invalid Sheet", []);

        var summary = new List<(string key, string value)>();
        var issueDate = sheet.FindParameter(BuiltInParameter.SHEET_ISSUE_DATE)?.AsString();
        if (!string.IsNullOrEmpty(issueDate))
            summary.Add(("Issue Date", issueDate));

        var drawnBy = sheet.FindParameter(BuiltInParameter.SHEET_DRAWN_BY)?.AsString();
        if (!string.IsNullOrEmpty(drawnBy))
            summary.Add(("Drawn By", drawnBy));

        var checkedBy = sheet.FindParameter(BuiltInParameter.SHEET_CHECKED_BY)?.AsString();
        if (!string.IsNullOrEmpty(checkedBy))
            summary.Add(("Checked By", checkedBy));

        var viewIds = sheet.GetAllPlacedViews();
        var viewDetails = new List<(string primary, string secondary)>();
        var docRef = sheet.Document;
        foreach (var viewId in viewIds) {
            if (docRef.GetElement(viewId) is View view)
                viewDetails.Add((view.Name, view.ViewType.ToString()));
        }

        return new ViewPreviewData($"{sheet.SheetNumber} - {sheet.Name}", [
            new ViewPreviewSection(null, summary),
            viewDetails.Count == 0
                ? new ViewPreviewSection("Placed Views", [], ["No views placed"])
                : new ViewPreviewSection("Placed Views", [], detailItems: viewDetails),
            new ViewPreviewSection("Profile", [("Id", sheet.Id.ToString())])
        ]);
    }
}

public sealed record ViewPreviewData(string Header, List<ViewPreviewSection> Sections);

public sealed class ViewPreviewSection {
    public ViewPreviewSection(
        string? header,
        List<(string key, string value)> keyValues,
        List<string>? paragraphs = null,
        List<string>? bulletItems = null,
        List<(string primary, string secondary)>? detailItems = null
    ) {
        this.Header = header;
        this.KeyValues = keyValues;
        this.Paragraphs = paragraphs ?? [];
        this.BulletItems = bulletItems ?? [];
        this.DetailItems = detailItems ?? [];
    }

    public string? Header { get; }
    public List<(string key, string value)> KeyValues { get; }
    public List<string> Paragraphs { get; }
    public List<string> BulletItems { get; }
    public List<(string primary, string secondary)> DetailItems { get; }
}