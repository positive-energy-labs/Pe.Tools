using Autodesk.Revit.UI;
using Pe.App.Commands.Palette.CommandPalette;
using Pe.Revit.Extensions.FamParameter;
using Pe.Revit.Ui.Core;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Documents;
using System.Windows.Media;
using Button = Wpf.Ui.Controls.Button;
using Grid = System.Windows.Controls.Grid;
using TextBlock = Wpf.Ui.Controls.TextBlock;
using Visibility = System.Windows.Visibility;
using WpfUiRichTextBox = Wpf.Ui.Controls.RichTextBox;

namespace Pe.App.Commands.Palette.FamilyPalette;

/// <summary>
///     Interactive sidebar panel for family elements that displays element details
///     and associated elements with inline action buttons.
///     Uses the shared sidebar pipeline so association gathering stays off the dispatcher path.
/// </summary>
public class FamilyElementPreviewPanel : PaletteSidebarPanel<FamilyElementItem, FamilyElementPreviewData> {
    private readonly Border _associatedContainer;
    private readonly StackPanel _associatedElementsList;
    private readonly WpfUiRichTextBox _detailsBox;
    private readonly UIDocument _uidoc;
    private FamilyElementItem? _currentItem;

    public FamilyElementPreviewPanel(UIDocument uidoc) {
        this._uidoc = uidoc;

        // Main container
        var mainStack = new StackPanel();

        // Element details section (top)
        this._detailsBox = new WpfUiRichTextBox {
            IsReadOnly = true,
            IsDocumentEnabled = true,
            Focusable = false,
            IsTextSelectionEnabled = true,
            AutoWordSelection = false,
            VerticalScrollBarVisibility = ScrollBarVisibility.Disabled,
            HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled,
            Margin = new Thickness(0, 0, 0, 16)
        };
        _ = mainStack.Children.Add(this._detailsBox);

        // Associated elements section header
        var associatedHeader = new TextBlock {
            Text = "Associated Elements",
            FontSize = 14,
            FontWeight = FontWeights.SemiBold,
            Margin = new Thickness(0, 0, 0, 8)
        };
        associatedHeader.SetResourceReference(ForegroundProperty, "TextFillColorPrimaryBrush");
        _ = mainStack.Children.Add(associatedHeader);

        // Associated elements list container with border
        this._associatedContainer = new Border {
            BorderThickness = new Thickness(1),
            CornerRadius = new CornerRadius(4),
            Padding = new Thickness(8),
            MinHeight = 60,
            Margin = new Thickness(0, 0, 0, 0)
        };
        this._associatedContainer.SetResourceReference(BorderBrushProperty, "ControlStrokeColorDefaultBrush");
        this._associatedContainer.SetResourceReference(BackgroundProperty, "ControlFillColorDefaultBrush");

        this._associatedElementsList = new StackPanel();
        this._associatedContainer.Child = this._associatedElementsList;
        _ = mainStack.Children.Add(this._associatedContainer);

        base.Content = mainStack;
    }

    protected override void ShowLoading(FamilyElementItem item) {
        this._currentItem = item;

        var doc = FlowDocumentBuilder.Create()
            .AddHeader(item.TextPrimary);

        var loadingPara = new Paragraph(new Run("Loading...") {
            FontStyle = FontStyles.Italic,
            Foreground = Brushes.Gray
        }) { Margin = new Thickness(0, 8, 0, 0) };

        doc.Blocks.Add(loadingPara);
        this._detailsBox.Document = doc;
        this._associatedElementsList.Children.Clear();
        this._associatedContainer.Visibility = Visibility.Collapsed;
    }

    protected override async Task<FamilyElementPreviewData?> BuildDataAsync(FamilyElementItem item, CancellationToken ct) {
        if (ct.IsCancellationRequested) return null;
        return await PaletteThreading.RunRevitAsync(() => this.BuildPreviewData(item), ct);
    }

    protected override void RenderData(FamilyElementPreviewData? data) {
        if (data == null) {
            this.ClearContent();
            return;
        }

        this._currentItem = data.Item;

        var doc = FlowDocumentBuilder.Create()
            .AddHeader(data.Header);

        foreach (var (key, value) in data.Details)
            _ = doc.AddKeyValue(key, value);

        this._detailsBox.Document = doc;
        this.RefreshAssociatedElements(data.AssociatedElements);
    }

    protected override void ClearContent() {
        this._currentItem = null;
        this._detailsBox.Document = FlowDocumentBuilder.Create();
        this._associatedElementsList.Children.Clear();
        this._associatedContainer.Visibility = Visibility.Collapsed;
    }

    private FamilyElementPreviewData BuildPreviewData(FamilyElementItem item) {
        var details = new List<(string key, string value)>();

        switch (item.ElementType) {
        case FamilyElementType.Parameter:
            var familyParam = item.FamilyParam!;
            details.Add(("Type/Instance", familyParam.GetTypeInstanceDesignation()));
            details.Add(("Data Type", familyParam.Definition?.GetDataType().ToLabel() ?? string.Empty));
            details.Add(("Storage Type", familyParam.StorageType.ToString()));
            details.Add(("Is Built-In", familyParam.IsBuiltInParameter().ToString()));
            details.Add(("Is Shared", familyParam.IsShared.ToString()));

            if (!string.IsNullOrEmpty(familyParam.Formula))
                details.Add(("Formula", familyParam.Formula));
            break;

        case FamilyElementType.Connector:
            details.Add(("Element ID", item.Connector!.Id.ToString()));
            details.Add(("Domain", item.Connector.Domain.ToString()));
            break;

        case FamilyElementType.Dimension:
            details.Add(("Element ID", item.Dimension!.Id.ToString()));
            details.Add(("Type", item.Dimension.DimensionType?.Name ?? "Unknown"));
            details.Add(item.Dimension.Value.HasValue
                ? ("Value", $"{item.Dimension.Value.Value:F4}")
                : ("Segments", item.Dimension.NumberOfSegments.ToString()));
            break;

        case FamilyElementType.ReferencePlane:
            details.Add(("Element ID", item.RefPlane!.Id.ToString()));
            details.Add(("Name", item.RefPlane.Name.NullIfEmpty() ?? "(unnamed)"));
            break;

        case FamilyElementType.Family:
            details.Add(("Family", item.FamilyInstance!.Symbol.FamilyName));
            details.Add(("Type", item.FamilyInstance.Symbol.Name));
            details.Add(("Element ID", item.FamilyInstance.Id.ToString()));
            break;
        }

        return new FamilyElementPreviewData(
            item,
            item.TextPrimary,
            details,
            item.GetAssociatedElements());
    }

    private void RefreshAssociatedElements(IReadOnlyList<AssociatedElement> associated) {
        this._associatedElementsList.Children.Clear();

        if (associated.Count == 0) {
            this._associatedContainer.Visibility = Visibility.Collapsed;
            return;
        }

        this._associatedContainer.Visibility = Visibility.Visible;

        foreach (var element in associated) {
            var row = this.CreateAssociatedElementRow(element);
            _ = this._associatedElementsList.Children.Add(row);
        }
    }

    private Grid CreateAssociatedElementRow(AssociatedElement element) {
        var row = new Grid { Margin = new Thickness(0, 4, 0, 4) };
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        // Element info in a container
        var infoBorder = new Border {
            Background = Brushes.Transparent,
            BorderThickness = new Thickness(1),
            CornerRadius = new CornerRadius(4),
            Padding = new Thickness(8, 4, 8, 4),
            HorizontalAlignment = HorizontalAlignment.Stretch
        };
        infoBorder.SetResourceReference(BorderBrushProperty, "ControlStrokeColorSecondaryBrush");

        var infoStack = new StackPanel();

        var nameText = new TextBlock { Text = element.Name, FontSize = 12, TextWrapping = TextWrapping.Wrap };
        nameText.SetResourceReference(ForegroundProperty, "TextFillColorPrimaryBrush");
        _ = infoStack.Children.Add(nameText);

        var typeText = new TextBlock { Text = element.Type, FontSize = 10, Opacity = 0.7 };
        typeText.SetResourceReference(ForegroundProperty, "TextFillColorSecondaryBrush");
        _ = infoStack.Children.Add(typeText);

        infoBorder.Child = infoStack;
        Grid.SetColumn(infoBorder, 0);
        _ = row.Children.Add(infoBorder);

        // Action button
        var button = new Button {
            Content = element.AssocType == AssociatedElementType.Parameter ? "Show" : "Select",
            Padding = new Thickness(12, 4, 12, 4),
            FontSize = 11,
            Margin = new Thickness(8, 0, 0, 0),
            Tag = element
        };
        button.Click += this.OnAssociatedElementClick;
        Grid.SetColumn(button, 1);
        _ = row.Children.Add(button);

        return row;
    }

    private void OnAssociatedElementClick(object sender, RoutedEventArgs e) {
        if (sender is not Button button || button.Tag is not AssociatedElement element) return;

        switch (element.AssocType) {
        case AssociatedElementType.Dimension:
        case AssociatedElementType.Array:
        case AssociatedElementType.Connector:
            if (element.ElementId == null) return;
            this._uidoc.ShowElements(element.ElementId);
            this._uidoc.Selection.SetElementIds([element.ElementId]);
            break;

        case AssociatedElementType.Parameter:
            if (element.FamilyParameter != null && this._currentItem?.FamilyDoc != null)
                ParamRelationshipDialog.Show(element.FamilyParameter, this._currentItem.FamilyDoc);
            break;
        }
    }
}

public sealed record FamilyElementPreviewData(
    FamilyElementItem Item,
    string Header,
    List<(string key, string value)> Details,
    List<AssociatedElement> AssociatedElements
);