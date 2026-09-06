using Pe.Revit.Ui.Core;
using Pe.Shared.RevitData.Families;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Documents;
using TextElement = System.Windows.Documents.TextElement;
using WpfUiRichTextBox = Wpf.Ui.Controls.RichTextBox;

namespace Pe.App.Commands.FamilyFoundry.FamilyFoundryUi;

/// <summary>Side panel: validity, section counts, selected families, and the JSON of the selected file.</summary>
public class ProfilePreviewPanel(Func<ProfileListItem?, CancellationToken, Task<PreviewData?>> previewBuilder) : PaletteSidebarPanel<ProfileListItem, PreviewData> {
    private readonly WpfUiRichTextBox _richTextBox = new() {
        IsReadOnly = true, IsDocumentEnabled = true, Focusable = true, IsTextSelectionEnabled = true, AutoWordSelection = false,
        VerticalScrollBarVisibility = ScrollBarVisibility.Disabled, HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled
    };

    protected override async Task<PreviewData?> BuildDataAsync(ProfileListItem item, CancellationToken ct) => ct.IsCancellationRequested ? null : await previewBuilder(item, ct);

    protected override void RenderData(PreviewData? data) {
        this.Content ??= this._richTextBox;
        if (data == null) { this._richTextBox.Document = FlowDocumentBuilder.Create(); return; }
        var doc = FlowDocumentBuilder.Create().AddHeader(data.ProfileName);

        var status = new Paragraph { Margin = new Thickness(0, 0, 0, 8) };
        var run = new Run(data.IsValid ? "✓ Valid" : "✗ Invalid") { FontWeight = FontWeights.Bold, FontSize = 12 };
        run.SetResourceReference(TextElement.ForegroundProperty, data.IsValid ? "SystemFillColorSuccessBrush" : "SystemFillColorCriticalBrush");
        status.Inlines.Add(run);
        doc.Blocks.Add(status);

        if (data.RemainingErrors.Count > 0) {
            _ = doc.AddSectionHeader("Errors");
            var list = new List { MarkerStyle = TextMarkerStyle.Disc, Margin = new Thickness(16, 0, 0, 12) };
            foreach (var error in data.RemainingErrors) list.ListItems.Add(new ListItem(new Paragraph(new Run(error))));
            doc.Blocks.Add(list);
        }
        if (data.Sections.Count > 0) {
            _ = doc.AddSectionHeader(data.Patch is null ? "Sections" : "Patch fragment");
            var list = new List { MarkerStyle = TextMarkerStyle.Disc, Margin = new Thickness(16, 0, 0, 12) };
            foreach (var s in data.Sections) list.ListItems.Add(new ListItem(new Paragraph(new Run(s))));
            doc.Blocks.Add(list);
        }
        if (data.Families.Count > 0) {
            _ = doc.AddSectionHeader($"Families selected ({data.Families.Count})");
            var list = new List { MarkerStyle = TextMarkerStyle.Disc, Margin = new Thickness(16, 0, 0, 12) };
            foreach (var f in data.Families) list.ListItems.Add(new ListItem(new Paragraph(new Run($"{f.Name}  ({f.Category})"))));
            doc.Blocks.Add(list);
        }
        if (!string.IsNullOrEmpty(data.ProfileJson)) {
            _ = doc.AddSectionHeader("JSON");
            _ = doc.AddJsonBlock(data.ProfileJson);
        }
        this._richTextBox.Document = doc;
    }

    protected override void ClearContent() => this._richTextBox.Document = FlowDocumentBuilder.Create();
}

public sealed record PreviewData {
    public string ProfileName { get; init; } = string.Empty;
    public string FilePath { get; init; } = string.Empty;
    public DateTime? ModifiedDate { get; init; }
    public int LineCount { get; init; }
    public string ProfileJson { get; init; } = string.Empty;
    public bool IsValid { get; init; }
    public List<string> RemainingErrors { get; init; } = [];
    public List<string> Sections { get; init; } = [];
    public List<FamilyInfo> Families { get; init; } = [];
    public FamilyModel? Model { get; init; }
    public FamilyPatch? Patch { get; init; }
}

public record FamilyInfo(string Name, string Category);
