using Pe.App.Commands.Palette.FamilyPalette;
using Pe.Revit.Ui.Core;
using System.Windows;
using System.Windows.Controls;
using Visibility = System.Windows.Visibility;

namespace Pe.App.Commands.Palette.ViewPalette;

/// <summary>
///     Sidebar for the Go palette: dispatches to the view or family preview panel by
///     the selected item's runtime type (ISidebarPanel is contravariant, so the typed
///     panels can't be used directly on a type-erased palette).
/// </summary>
internal sealed class GoPreviewPanel : ISidebarPanel<IPaletteListItem> {
    private readonly System.Windows.Controls.Grid _content = new();
    private readonly FamilyPreviewPanel _familyPanel;
    private readonly ViewPreviewPanel _viewPanel = new();

    public GoPreviewPanel(Document doc) {
        this._familyPanel = new FamilyPreviewPanel(doc) { Visibility = Visibility.Collapsed };
        _ = this._content.Children.Add(this._viewPanel);
        _ = this._content.Children.Add(this._familyPanel);
    }

    public UIElement Content => this._content;

    public void Clear() {
        this._viewPanel.Clear();
        this._familyPanel.Clear();
    }

    public void Update(IPaletteListItem? item, CancellationToken ct) {
        switch (item) {
            case UnifiedViewItem view:
                this._viewPanel.Visibility = Visibility.Visible;
                this._familyPanel.Visibility = Visibility.Collapsed;
                this._viewPanel.Update(view, ct);
                break;
            case UnifiedFamilyItem family:
                this._familyPanel.Visibility = Visibility.Visible;
                this._viewPanel.Visibility = Visibility.Collapsed;
                this._familyPanel.Update(family, ct);
                break;
            default:
                this.Clear();
                break;
        }
    }
}
