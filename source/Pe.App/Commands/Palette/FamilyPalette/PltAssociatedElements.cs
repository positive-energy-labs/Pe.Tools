using Autodesk.Revit.UI;
using Pe.App.Commands.Palette.CommandPalette;
using Pe.Extensions.FamDocument;
using Pe.Extensions.FamParameter;
using Pe.Extensions.FamParameter.Formula;
using Pe.Ui.Core;
using Pe.Ui.Core.Services;
using Pe.Ui.ViewModels;
using System.Text;
using System.Windows;
using System.Windows.Media.Imaging;
using Color = System.Windows.Media.Color;

namespace Pe.App.Commands.Palette;

/// <summary>
///     Secondary palette for displaying associated elements of a FamilyParameter.
///     Shows dimensions, arrays, and formula-dependent family parameters.
/// </summary>
public static class PltAssociatedElements {
    /// <summary>
    ///     Creates a palette for displaying associated elements, suitable for embedding in a sidebar.
    /// </summary>
    public static UIElement? CreatePalette(UIApplication uiapp, FamilyParameter param, FamilyDocument familyDoc) {
        var uidoc = uiapp.ActiveUIDocument;
        var items = CollectItems(param, familyDoc);

        if (items.Count == 0) return null;

        var actions = CreateActions(uidoc, familyDoc);

        // Create palette for sidebar (no search box for association list)
        var searchService = new SearchFilterService<AssociatedElementItem>();
        var viewModel = new PaletteViewModel<AssociatedElementItem>(items, searchService);
        var palette = new Ui.Components.Palette(true);
        palette.Initialize(viewModel, actions);
        return palette;
    }

    /// <summary>
    ///     Opens a standalone window for displaying associated elements.
    /// </summary>
    public static void Open(UIApplication uiapp, FamilyParameter param, FamilyDocument familyDoc) {
        var uidoc = uiapp.ActiveUIDocument;
        var items = CollectItems(param, familyDoc);

        if (items.Count == 0) return;

        var actions = CreateActions(uidoc, familyDoc);

        var window = PaletteFactory.Create($"{param.Definition.Name} Associations", items, actions,
            new PaletteOptions<AssociatedElementItem> {
                SearchConfig = SearchConfig.PrimaryAndSecondary(), FilterKeySelector = item => item.TextPill
            });
        window.Show();
    }

    private static List<AssociatedElementItem> CollectItems(FamilyParameter param, FamilyDocument familyDoc) {
        var items = new List<AssociatedElementItem>();

        // Add associated dimensions
        foreach (var dim in param.AssociatedDimensions(familyDoc))
            items.Add(new AssociatedElementItem(dim, familyDoc));

        // Add associated arrays
        foreach (var array in param.AssociatedArrays(familyDoc))
            items.Add(new AssociatedElementItem(array, familyDoc));

        // Add associated connectors
        foreach (var connector in param.AssociatedConnectors(familyDoc))
            items.Add(new AssociatedElementItem(connector, familyDoc));

        // Add formula-dependent family parameters
        foreach (var fp in param.GetDependents(familyDoc.FamilyManager.Parameters))
            items.Add(new AssociatedElementItem(fp, familyDoc));

        return items;
    }

    private static List<PaletteAction<AssociatedElementItem>> CreateActions(
        UIDocument uidoc,
        FamilyDocument familyDoc
    ) => [
        new() {
            Name = "Show/Select",
            Execute = async item => {
                switch (item.ItemType) {
                case AssociatedItemType.Dimension:
                case AssociatedItemType.Array:
                case AssociatedItemType.Connector:
                    var elementId = item.ElementId;
                    if (elementId == null) return;
                    uidoc.ShowElements(elementId);
                    uidoc.Selection.SetElementIds([elementId]);
                    break;
                case AssociatedItemType.FamilyParameter:
                    if (item.FamilyParam == null) return;
                    ParamRelationshipDialog.Show(item.FamilyParam, familyDoc);
                    break;
                }
            },
            CanExecute = item => item != null
        }
    ];
}

public enum AssociatedItemType {
    Dimension,
    Array,
    Connector,
    FamilyParameter
}

public class AssociatedElementItem : IPaletteListItem {
    private readonly FamilyDocument _familyDoc;

    public AssociatedElementItem(Dimension dim, FamilyDocument familyDoc) {
        this._familyDoc = familyDoc;
        this.ItemType = AssociatedItemType.Dimension;
        this.ElementId = dim.Id;
        this.Dimension = dim;
    }

    public AssociatedElementItem(BaseArray array, FamilyDocument familyDoc) {
        this._familyDoc = familyDoc;
        this.ItemType = AssociatedItemType.Array;
        this.ElementId = array.Id;
        this.Array = array;
    }

    public AssociatedElementItem(ConnectorElement connector, FamilyDocument familyDoc) {
        this._familyDoc = familyDoc;
        this.ItemType = AssociatedItemType.Connector;
        this.ElementId = connector.Id;
        this.Connector = connector;
    }

    public AssociatedElementItem(FamilyParameter familyParam, FamilyDocument familyDoc) {
        this._familyDoc = familyDoc;
        this.ItemType = AssociatedItemType.FamilyParameter;
        this.FamilyParam = familyParam;
    }

    public AssociatedItemType ItemType { get; }
    public ElementId? ElementId { get; }
    public Dimension? Dimension { get; }
    public BaseArray? Array { get; }
    public ConnectorElement? Connector { get; }
    public FamilyParameter? FamilyParam { get; }

    public string TextPrimary => this.ItemType switch {
        AssociatedItemType.Dimension => this.GetDimensionName(),
        AssociatedItemType.Array => this.GetArrayName(),
        AssociatedItemType.Connector => this.GetConnectorName(),
        AssociatedItemType.FamilyParameter => this.FamilyParam?.Definition.Name ?? "Unknown",
        _ => "Unknown"
    };

    public string TextSecondary => this.ItemType switch {
        AssociatedItemType.Dimension => this.GetDimensionDetails(),
        AssociatedItemType.Array => this.GetArrayDetails(),
        AssociatedItemType.Connector => this.GetConnectorDetails(),
        AssociatedItemType.FamilyParameter => this.GetFamilyParamDetails(),
        _ => string.Empty
    };

    public string TextPill => this.ItemType switch {
        AssociatedItemType.Dimension => "Dimension",
        AssociatedItemType.Array => "Array",
        AssociatedItemType.Connector => "Connector",
        AssociatedItemType.FamilyParameter => "Parameter",
        _ => string.Empty
    };

    public Func<string> GetTextInfo => () => this.ItemType switch {
        AssociatedItemType.Dimension => this.GetDimensionTooltip(),
        AssociatedItemType.Array => this.GetArrayTooltip(),
        AssociatedItemType.Connector => this.GetConnectorTooltip(),
        AssociatedItemType.FamilyParameter => this.GetFamilyParamTooltip(),
        _ => string.Empty
    };

    public BitmapImage? Icon => null;
    public Color? ItemColor => null;

    private string GetDimensionName() {
        if (this.Dimension == null) return "Unknown Dimension";
        var dimType = this.Dimension.DimensionType?.Name ?? "Unknown Type";
        return $"{dimType} ({this.Dimension.Id})";
    }

    private string GetDimensionDetails() {
        if (this.Dimension == null) return string.Empty;
        var value = this.Dimension.Value;
        return value.HasValue ? $"Value: {value.Value:F4}" : "Multi-segment";
    }

    private string GetDimensionTooltip() {
        if (this.Dimension == null) return string.Empty;
        var sb = new StringBuilder();
        return sb.AppendLine($"Type: {this.Dimension.DimensionType?.Name ?? "Unknown"}")
            .AppendLine($"Element Id: {this.Dimension.Id}")
            .AppendLine(
                $"Value: {(this.Dimension.Value.HasValue ? $"{this.Dimension.Value.Value:F4}" : "Multi-segment")}")
            .AppendLine($"Number of Segments: {this.Dimension.NumberOfSegments}")
            .ToString().TrimEnd();
    }

    private string GetArrayName() {
        if (this.Array == null) return "Unknown Array";
        return $"Array ({this.Array.Id})";
    }

    private string GetArrayDetails() {
        if (this.Array == null) return string.Empty;
        var memberCount = this.Array.NumMembers;
        return $"Members: {memberCount}";
    }

    private string GetArrayTooltip() {
        if (this.Array == null) return string.Empty;
        var sb = new StringBuilder();
        return sb.AppendLine($"Element Id: {this.Array.Id}")
            .AppendLine($"Number of Members: {this.Array.NumMembers}")
            .AppendLine($"Label: {this.Array.Label?.Definition.Name ?? "None"}")
            .ToString().TrimEnd();
    }

    private string GetConnectorName() {
        if (this.Connector == null) return "Unknown Connector";
        return $"{this.Connector.Domain} Connector ({this.Connector.Id})";
    }

    private string GetConnectorDetails() {
        if (this.Connector == null) return string.Empty;
        return $"Domain: {this.Connector.Domain}";
    }

    private string GetConnectorTooltip() {
        if (this.Connector == null) return string.Empty;
        var sb = new StringBuilder()
            .AppendLine($"Element Id: {this.Connector.Id}")
            .AppendLine($"Domain: {this.Connector.Domain}");

        // Get associated parameter names
        var associatedParams = new List<string>();
        foreach (Parameter param in this.Connector.Parameters) {
            var associated = this._familyDoc.FamilyManager.GetAssociatedFamilyParameter(param);
            if (associated != null)
                associatedParams.Add($"  {param.Definition.Name} → {associated.Definition.Name}");
        }

        if (associatedParams.Count > 0) {
            _ = sb.AppendLine("Associated Parameters:");
            foreach (var p in associatedParams)
                _ = sb.AppendLine(p);
        }

        return sb.ToString().TrimEnd();
    }

    private string GetFamilyParamDetails() {
        if (this.FamilyParam == null) return string.Empty;
        var dataType = this.FamilyParam.Definition.GetDataType().ToLabel();
        return $"{this.FamilyParam.GetTypeInstanceDesignation()} - {dataType}";
    }

    private string GetFamilyParamTooltip() {
        if (this.FamilyParam == null) return string.Empty;
        var sb = new StringBuilder()
            .AppendLine($"Name: {this.FamilyParam.Definition.Name}")
            .AppendLine($"Type/Instance: {this.FamilyParam.GetTypeInstanceDesignation()}")
            .AppendLine($"Data Type: {this.FamilyParam.Definition.GetDataType().ToLabel()}");
        if (!string.IsNullOrEmpty(this.FamilyParam.Formula))
            _ = sb.AppendLine($"Formula: {this.FamilyParam.Formula}");

        var dims = this.FamilyParam.AssociatedDimensions(this._familyDoc).Count();
        var arrays = this.FamilyParam.AssociatedArrays(this._familyDoc).Count();
        var formulaDeps = this.FamilyParam.GetDependents(this._familyDoc.FamilyManager.Parameters).Count();
        return sb.AppendLine($"Associations: {dims} dims, {arrays} arrays, {formulaDeps} params").ToString().TrimEnd();
    }
}