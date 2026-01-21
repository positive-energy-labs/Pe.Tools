using Pe.Ui.Core;
using System.Windows.Controls;
using System.Windows.Documents;
using WpfUiRichTextBox = Wpf.Ui.Controls.RichTextBox;

namespace Pe.App.Commands.Palette.ViewPalette;

/// <summary>
///     Sidebar panel that displays view details using FlowDocumentBuilder.
///     Displays different information based on ViewItemType.
/// </summary>
public class ViewPreviewPanel : UserControl {
    private readonly WpfUiRichTextBox _richTextBox;

    public ViewPreviewPanel() {
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
    ///     Updates the preview panel with view information.
    /// </summary>
    public void UpdatePreview(UnifiedViewItem item) {
        if (item == null) {
            this._richTextBox.Document = FlowDocumentBuilder.Create();
            return;
        }

        var doc = item.ItemType switch {
            ViewItemType.View => this.BuildViewPreview(item),
            ViewItemType.Schedule => this.BuildSchedulePreview(item),
            ViewItemType.Sheet => this.BuildSheetPreview(item),
            _ => FlowDocumentBuilder.Create()
        };

        this._richTextBox.Document = doc;
    }

    private FlowDocument BuildViewPreview(UnifiedViewItem item) {
        var view = item.View;
        var doc = FlowDocumentBuilder.Create()
            .AddHeader(view.Name);

        _ = doc.AddKeyValue("Type", view.ViewType.ToString());
        _ = doc.AddKeyValue("Detail Level", view.DetailLevel.ToString());

        // Level info
        var level = view.FindParameter(BuiltInParameter.PLAN_VIEW_LEVEL)?.AsValueString();
        if (!string.IsNullOrEmpty(level))
            _ = doc.AddKeyValue("Level", level);

        // Discipline
        if (view.HasViewDiscipline())
            _ = doc.AddKeyValue("Discipline", view.Discipline.ToString());

        // View Use
        var viewUse = view.FindParameter("View Use")?.AsString();
        if (!string.IsNullOrEmpty(viewUse))
            _ = doc.AddKeyValue("View Use", viewUse);

        // View Template
        var templateId = view.ViewTemplateId;
        if (templateId != ElementId.InvalidElementId) {
            var template = view.Document.GetElement(templateId);
            if (template != null)
                _ = doc.AddKeyValue("Template", template.Name);
        }

        // Scale
        var scale = view.FindParameter(BuiltInParameter.VIEW_SCALE)?.AsInteger();
        if (scale.HasValue && scale.Value > 0)
            _ = doc.AddKeyValue("Scale", $"1:{scale.Value}");

        _ = doc.AddSectionHeader("Profile");
        _ = doc.AddKeyValue("Id", view.Id.ToString());

        return doc;
    }

    private FlowDocument BuildSchedulePreview(UnifiedViewItem item) {
        var schedule = item.AsSchedule;
        if (schedule == null)
            return FlowDocumentBuilder.Create().AddHeader("Invalid Schedule");

        var doc = FlowDocumentBuilder.Create()
            .AddHeader(schedule.Name);

        // Discipline
        var discipline = schedule.FindParameter("Discipline")?.AsValueString();
        if (!string.IsNullOrEmpty(discipline))
            _ = doc.AddKeyValue("Discipline", discipline);

        // Fields count
        var definition = schedule.Definition;
        if (definition != null)
            _ = doc.AddKeyValue("Fields", definition.GetFieldCount().ToString());

        // Sheet placements
        _ = doc.AddSectionHeader("Sheet Placements");
        var instances = schedule.GetScheduleInstances(-1);
        if (instances.Count == 0)
            _ = doc.AddParagraph("Not placed on any sheets");
        else {
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

            _ = doc.AddBulletList(placements);
        }

        _ = doc.AddSectionHeader("Profile");
        _ = doc.AddKeyValue("Id", schedule.Id.ToString());

        return doc;
    }

    private FlowDocument BuildSheetPreview(UnifiedViewItem item) {
        var sheet = item.AsSheet;
        if (sheet == null)
            return FlowDocumentBuilder.Create().AddHeader("Invalid Sheet");

        var doc = FlowDocumentBuilder.Create()
            .AddHeader($"{sheet.SheetNumber} - {sheet.Name}");

        // Sheet info
        var issueDate = sheet.FindParameter(BuiltInParameter.SHEET_ISSUE_DATE)?.AsString();
        if (!string.IsNullOrEmpty(issueDate))
            _ = doc.AddKeyValue("Issue Date", issueDate);

        var drawnBy = sheet.FindParameter(BuiltInParameter.SHEET_DRAWN_BY)?.AsString();
        if (!string.IsNullOrEmpty(drawnBy))
            _ = doc.AddKeyValue("Drawn By", drawnBy);

        var checkedBy = sheet.FindParameter(BuiltInParameter.SHEET_CHECKED_BY)?.AsString();
        if (!string.IsNullOrEmpty(checkedBy))
            _ = doc.AddKeyValue("Checked By", checkedBy);

        // Placed views
        _ = doc.AddSectionHeader("Placed Views");
        var viewIds = sheet.GetAllPlacedViews();
        if (viewIds.Count == 0)
            _ = doc.AddParagraph("No views placed");
        else {
            var viewDetails = new List<(string primary, string secondary)>();
            var docRef = sheet.Document;
            foreach (var viewId in viewIds) {
                if (docRef.GetElement(viewId) is View view)
                    viewDetails.Add((view.Name, view.ViewType.ToString()));
            }

            _ = doc.AddDetailList(viewDetails);
        }

        _ = doc.AddSectionHeader("Profile");
        _ = doc.AddKeyValue("Id", sheet.Id.ToString());

        return doc;
    }
}