using Autodesk.Revit.UI;
using Pe.App.Commands.Palette.CommandPalette;
using Pe.Extensions.FamParameter;
using Pe.Ui.Core;
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
/// </summary>
public class FamilyElementPreviewPanel : UserControl {
    private readonly UIDocument _uidoc;
    private readonly WpfUiRichTextBox _detailsBox;
    private readonly StackPanel _associatedElementsList;
    private readonly Border _associatedContainer;
    private FamilyElementItem _currentItem;

    public FamilyElementPreviewPanel(UIDocument uidoc) {
        this._uidoc = uidoc;

        // Main container
        var mainStack = new StackPanel();

        // Element details section (top)
        this._detailsBox = new WpfUiRichTextBox {
            IsReadOnly = true,
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

        this.Content = mainStack;
    }

    /// <summary>
    ///     Updates the preview panel with element information and associated elements.
    /// </summary>
    public void UpdatePreview(FamilyElementItem item) {
        this._currentItem = item;

        if (item == null) {
            this._detailsBox.Document = FlowDocumentBuilder.Create();
            this._associatedElementsList.Children.Clear();
            this._associatedContainer.Visibility = Visibility.Collapsed;
            return;
        }

        // Build element details document
        this._detailsBox.Document = this.BuildElementDetails(item);

        // Build associated elements list
        this.RefreshAssociatedElements(item);
    }

    private FlowDocument BuildElementDetails(FamilyElementItem item) {
        var doc = FlowDocumentBuilder.Create()
            .AddHeader(item.TextPrimary);

        switch (item.ElementType) {
        case FamilyElementType.Parameter:
            _ = doc.AddKeyValue("Type/Instance", item.FamilyParam!.GetTypeInstanceDesignation());
            _ = doc.AddKeyValue("Data Type", item.FamilyParam.Definition.GetDataType().ToLabel());
            _ = doc.AddKeyValue("Storage Type", item.FamilyParam.StorageType.ToString());
            _ = doc.AddKeyValue("Is Built-In", item.FamilyParam.IsBuiltInParameter().ToString());
            _ = doc.AddKeyValue("Is Shared", item.FamilyParam.IsShared.ToString());

            if (!string.IsNullOrEmpty(item.FamilyParam.Formula))
                _ = doc.AddKeyValue("Formula", item.FamilyParam.Formula);
            break;

        case FamilyElementType.Connector:
            _ = doc.AddKeyValue("Element ID", item.Connector!.Id.ToString());
            _ = doc.AddKeyValue("Domain", item.Connector.Domain.ToString());
            break;

        case FamilyElementType.Dimension:
            _ = doc.AddKeyValue("Element ID", item.Dimension!.Id.ToString());
            _ = doc.AddKeyValue("Type", item.Dimension.DimensionType?.Name ?? "Unknown");
            if (item.Dimension.Value.HasValue)
                _ = doc.AddKeyValue("Value", $"{item.Dimension.Value.Value:F4}");
            else
                _ = doc.AddKeyValue("Segments", item.Dimension.NumberOfSegments.ToString());
            break;

        case FamilyElementType.ReferencePlane:
            _ = doc.AddKeyValue("Element ID", item.RefPlane!.Id.ToString());
            _ = doc.AddKeyValue("Name", item.RefPlane.Name.NullIfEmpty() ?? "(unnamed)");
            break;

        case FamilyElementType.Family:
            _ = doc.AddKeyValue("Family", item.FamilyInstance!.Symbol.FamilyName);
            _ = doc.AddKeyValue("Type", item.FamilyInstance.Symbol.Name);
            _ = doc.AddKeyValue("Element ID", item.FamilyInstance.Id.ToString());
            break;
        }

        return doc;
    }

    private void RefreshAssociatedElements(FamilyElementItem item) {
        this._associatedElementsList.Children.Clear();

        var associated = item.GetAssociatedElements();

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
        var row = new Grid {
            Margin = new Thickness(0, 4, 0, 4)
        };
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

        var nameText = new TextBlock {
            Text = element.Name,
            FontSize = 12,
            TextWrapping = TextWrapping.Wrap
        };
        nameText.SetResourceReference(ForegroundProperty, "TextFillColorPrimaryBrush");
        _ = infoStack.Children.Add(nameText);

        var typeText = new TextBlock {
            Text = element.Type,
            FontSize = 10,
            Opacity = 0.7
        };
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
