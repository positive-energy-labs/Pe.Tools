using Autodesk.Revit.Attributes;
using Autodesk.Revit.UI;
using Pe.App.Commands.Palette.FamilyPalette;
using Pe.Extensions.FamDocument;
using Pe.Extensions.FamParameter;
using Pe.Extensions.FamParameter.Formula;
using Pe.FamilyFoundry.Snapshots;
using Pe.Global.Services.Storage;
using Pe.Ui.Core;
using Pe.Ui.Core.Services;
using System.Windows.Media.Imaging;
using Color = System.Windows.Media.Color;

namespace Pe.App.Commands.Palette;

[Transaction(TransactionMode.Manual)]
public class CmdPltFamilyElements : IExternalCommand {
    public Result Execute(ExternalCommandData commandData, ref string message, ElementSet elementSet) {
        var uiapp = commandData.Application;
        var uidoc = uiapp.ActiveUIDocument;
        var doc = uidoc.Document;

        if (!doc.IsFamilyDocument) {
            message = "This command only works in a family document.";
            return Result.Failed;
        }

        var familyDoc = new FamilyDocument(doc);
        var items = CollectFamilyElements(doc, familyDoc).ToList();

        var highlighter = new ElementHighlighter(uidoc);

        var actions = new List<PaletteAction<FamilyElementItem>> {
            new() {
                Name = "Associated Elements",
                NextPalette = item => {
                    if (item.FamilyParam == null) return null;
                    return PltAssociatedElements.CreatePalette(uiapp, item.FamilyParam, familyDoc);
                },
                CanExecute = item => item?.ElementType == FamilyElementType.Parameter && item.HasAnyAssociation
            },
            new() {
                Name = "Zoom to Element",
                Execute = async item => {
                    if (item?.ElementId == null) return;
                    uidoc.ShowElements(item.ElementId);
                    uidoc.Selection.SetElementIds([item.ElementId]);
                },
                CanExecute = item => item?.ElementType != FamilyElementType.Parameter && item?.ElementId != null
            }
        };

        var window = PaletteFactory.Create("Family Elements", items, actions,
            new PaletteOptions<FamilyElementItem> {
                Storage = new Storage(nameof(CmdPltFamilyElements)),
                PersistenceKey = item => item.PersistenceKey,
                SearchConfig = SearchConfig.PrimaryAndSecondary(),
                FilterKeySelector = item => item.TextPill,
                OnSelectionChanged = item => {
                    if (item?.ElementId != null)
                        highlighter.Highlight(item.ElementId);
                }
            });

        window.Closed += (_, _) => highlighter.Dispose();
        window.Show();

        return Result.Succeeded;
    }

    private static IEnumerable<FamilyElementItem> CollectFamilyElements(Document doc, FamilyDocument familyDoc) {
        // Family Parameters
        foreach (var param in familyDoc.FamilyManager.Parameters.OfType<FamilyParameter>()
                     .OrderBy(p => p.Definition.Name))
            yield return new FamilyElementItem(param, familyDoc);

        // Connectors
        foreach (var connector in new FilteredElementCollector(doc).OfClass(typeof(ConnectorElement))
                     .Cast<ConnectorElement>())
            yield return new FamilyElementItem(connector, familyDoc);

        // Dimensions (excluding SpotDimensions)
        foreach (var dim in new FilteredElementCollector(doc).OfClass(typeof(Dimension)).Cast<Dimension>()
                     .Where(d => d is not SpotDimension))
            yield return new FamilyElementItem(dim, familyDoc);

        // Reference Planes
        foreach (var refPlane in new FilteredElementCollector(doc).OfClass(typeof(ReferencePlane))
                     .Cast<ReferencePlane>())
            yield return new FamilyElementItem(refPlane, familyDoc);

        // Nested Families
        foreach (var instance in new FilteredElementCollector(doc).OfClass(typeof(FamilyInstance))
                     .Cast<FamilyInstance>())
            yield return new FamilyElementItem(instance, familyDoc);
    }
}

public enum FamilyElementType {
    Parameter,
    Connector,
    Dimension,
    ReferencePlane,
    NestedFamily
}

public class FamilyElementItem : IPaletteListItem {
    private readonly FamilyDocument _familyDoc;

    public FamilyElementItem(FamilyParameter param, FamilyDocument familyDoc) {
        this._familyDoc = familyDoc;
        this.FamilyParam = param;
        this.ElementType = FamilyElementType.Parameter;
        this.ElementId = null; // FamilyParameters don't have element IDs for view operations
    }

    public FamilyElementItem(ConnectorElement connector, FamilyDocument familyDoc) {
        this._familyDoc = familyDoc;
        this.Connector = connector;
        this.ElementType = FamilyElementType.Connector;
        this.ElementId = connector.Id;
    }

    public FamilyElementItem(Dimension dim, FamilyDocument familyDoc) {
        this._familyDoc = familyDoc;
        this.Dimension = dim;
        this.ElementType = FamilyElementType.Dimension;
        this.ElementId = dim.Id;
    }

    public FamilyElementItem(ReferencePlane refPlane, FamilyDocument familyDoc) {
        this._familyDoc = familyDoc;
        this.RefPlane = refPlane;
        this.ElementType = FamilyElementType.ReferencePlane;
        this.ElementId = refPlane.Id;
    }

    public FamilyElementItem(FamilyInstance instance, FamilyDocument familyDoc) {
        this._familyDoc = familyDoc;
        this.NestedInstance = instance;
        this.ElementType = FamilyElementType.NestedFamily;
        this.ElementId = instance.Id;
    }

    // Backing fields for each element type
    public FamilyParameter? FamilyParam { get; }
    public ConnectorElement? Connector { get; }
    public Dimension? Dimension { get; }
    public ReferencePlane? RefPlane { get; }
    public FamilyInstance? NestedInstance { get; }

    public FamilyElementType ElementType { get; }
    public ElementId? ElementId { get; }

    public string PersistenceKey => this.ElementType switch {
        FamilyElementType.Parameter => $"param:{this.FamilyParam!.Id}",
        _ => $"{this.ElementType.ToString().ToLower()}:{this.ElementId}"
    };

    public bool HasAnyAssociation => this.ElementType == FamilyElementType.Parameter &&
                                     this.FamilyParam!.HasAnyAssociation(this._familyDoc);

    public string TextPrimary => this.ElementType switch {
        FamilyElementType.Parameter => this.FamilyParam!.Definition.Name,
        FamilyElementType.Connector => $"{this.Connector!.Domain} Connector",
        FamilyElementType.Dimension => this.GetDimensionName(),
        FamilyElementType.ReferencePlane => this.RefPlane!.Name.NullIfEmpty() ?? $"RefPlane ({this.RefPlane.Id})",
        FamilyElementType.NestedFamily => this.NestedInstance!.Symbol.FamilyName,
        _ => "Unknown"
    };

    public string TextSecondary => this.ElementType switch {
        FamilyElementType.Parameter => this.GetParameterSecondary(),
        FamilyElementType.Connector => this.GetConnectorSecondary(),
        FamilyElementType.Dimension => this.GetDimensionSecondary(),
        FamilyElementType.ReferencePlane => this.GetRefPlaneSecondary(),
        FamilyElementType.NestedFamily => this.NestedInstance!.Symbol.Name,
        _ => string.Empty
    };

    public string TextPill => this.ElementType switch {
        FamilyElementType.Parameter => this.FamilyParam!.GetTypeInstanceDesignation(),
        FamilyElementType.Connector => "Connector",
        FamilyElementType.Dimension => "Dimension",
        FamilyElementType.ReferencePlane => "RefPlane",
        FamilyElementType.NestedFamily => "Nested",
        _ => string.Empty
    };

    public Func<string> GetTextInfo => () => this.ElementType switch {
        FamilyElementType.Parameter => this.GetParameterTooltip(),
        FamilyElementType.Connector => this.GetConnectorTooltip(),
        FamilyElementType.Dimension => this.GetDimensionTooltip(),
        FamilyElementType.ReferencePlane => this.GetRefPlaneTooltip(),
        FamilyElementType.NestedFamily => this.GetNestedFamilyTooltip(),
        _ => string.Empty
    };

    public BitmapImage? Icon => null;
    public Color? ItemColor => null;

    #region NestedFamily Methods

    private string GetNestedFamilyTooltip() {
        var lines = new List<string> {
            $"Family: {this.NestedInstance!.Symbol.FamilyName}",
            $"Type: {this.NestedInstance.Symbol.Name}",
            $"Element ID: {this.NestedInstance.Id}"
        };

        // Get parameter associations
        var associations = new List<(string instParam, string famParam)>();
        foreach (Parameter param in this.NestedInstance.Parameters) {
            var associated = this._familyDoc.FamilyManager.GetAssociatedFamilyParameter(param);
            if (associated != null)
                associations.Add((param.Definition.Name, associated.Definition.Name));
        }

        if (associations.Count > 0) {
            lines.Add(string.Empty);
            lines.Add("--- Parameter Associations ---");
            foreach (var (instParam, famParam) in associations.Take(10))
                lines.Add($"  {instParam} → {famParam}");
            if (associations.Count > 10)
                lines.Add($"  ... and {associations.Count - 10} more");
        }

        return string.Join(Environment.NewLine, lines);
    }

    #endregion

    #region Parameter Methods

    private string GetParameterSecondary() {
        var label = this.FamilyParam!.Definition.GetDataType().ToLabel();
        var associationCount = this.GetAssociationCount();
        return associationCount > 0 ? $"{label} ({associationCount} associations)" : label;
    }

    private int GetAssociationCount() =>
        this.FamilyParam!.AssociatedDimensions(this._familyDoc).Count() +
        this.FamilyParam.AssociatedArrays(this._familyDoc).Count() +
        this.FamilyParam.AssociatedConnectors(this._familyDoc).Count() +
        this.FamilyParam.GetDependents(this._familyDoc.FamilyManager.Parameters).Count();

    private string GetParameterTooltip() {
        var lines = new List<string> {
            $"Name: {this.FamilyParam!.Definition.Name}",
            $"Type/Instance: {this.FamilyParam.GetTypeInstanceDesignation()}",
            $"Data Type: {this.FamilyParam.Definition.GetDataType().ToLabel()}",
            $"Storage Type: {this.FamilyParam.StorageType}",
            $"Is Built-In: {this.FamilyParam.IsBuiltInParameter()}",
            $"Is Shared: {this.FamilyParam.IsShared}"
        };

        if (!string.IsNullOrEmpty(this.FamilyParam.Formula))
            lines.Add($"Formula: {this.FamilyParam.Formula}");

        lines.Add(string.Empty);
        lines.Add("--- Associations ---");

        var dims = this.FamilyParam.AssociatedDimensions(this._familyDoc).ToList();
        lines.Add($"Dimensions: {dims.Count}");
        foreach (var dim in dims) {
            var dimType = dim.DimensionType?.Name ?? "Unknown Type";
            lines.Add($"  - {dimType} (ID: {dim.Id})");
        }

        var arrays = this.FamilyParam.AssociatedArrays(this._familyDoc).ToList();
        lines.Add($"Arrays: {arrays.Count}");
        foreach (var array in arrays) lines.Add($"  - Array (ID: {array.Id})");

        var connectors = this.FamilyParam.AssociatedConnectors(this._familyDoc).ToList();
        lines.Add($"Connectors: {connectors.Count}");
        foreach (var connector in connectors) lines.Add($"  - {connector.Domain} Connector (ID: {connector.Id})");

        var directParams = this.FamilyParam.AssociatedParameters.Cast<Parameter>().ToList();
        lines.Add($"Direct Element Params: {directParams.Count}");
        foreach (var param in directParams) lines.Add($"  - {param.Definition.Name} (ID: {param.Id})");

        var formulaParams = this.FamilyParam.GetDependents(this._familyDoc.FamilyManager.Parameters).ToList();
        lines.Add($"Formula Dependents: {formulaParams.Count}");
        foreach (var fp in formulaParams) lines.Add($"  - {fp.Definition.Name} (ID: {fp.Id})");

        return string.Join(Environment.NewLine, lines);
    }

    #endregion

    #region Connector Methods

    private string GetConnectorSecondary() {
        var associations = this.GetConnectorAssociations();
        return associations.Count > 0 ? $"{associations.Count} param associations" : "No associations";
    }

    private List<(string connParam, string famParam)> GetConnectorAssociations() {
        var associations = new List<(string, string)>();
        foreach (Parameter param in this.Connector!.Parameters) {
            var associated = this._familyDoc.FamilyManager.GetAssociatedFamilyParameter(param);
            if (associated != null)
                associations.Add((param.Definition.Name, associated.Definition.Name));
        }

        return associations;
    }

    private string GetConnectorTooltip() {
        var lines = new List<string> { $"Element ID: {this.Connector!.Id}", $"Domain: {this.Connector.Domain}" };

        var associations = this.GetConnectorAssociations();
        if (associations.Count > 0) {
            lines.Add(string.Empty);
            lines.Add("--- Parameter Associations ---");
            foreach (var (connParam, famParam) in associations)
                lines.Add($"  {connParam} → {famParam}");
        }

        return string.Join(Environment.NewLine, lines);
    }

    #endregion

    #region Dimension Methods

    private string GetDimensionName() {
        var typeName = this.Dimension!.DimensionType?.Name ?? "Dimension";
        return $"{typeName} ({this.Dimension.Id})";
    }

    private string GetDimensionSecondary() {
        var value = this.Dimension!.Value;
        return value.HasValue ? $"Value: {value.Value:F4}" : "Multi-segment";
    }

    private string GetDimensionTooltip() {
        var lines = new List<string> {
            $"Element ID: {this.Dimension!.Id}", $"Type: {this.Dimension.DimensionType?.Name ?? "Unknown"}"
        };

        if (this.Dimension.Value.HasValue)
            lines.Add($"Value: {this.Dimension.Value.Value:F4}");
        else
            lines.Add($"Segments: {this.Dimension.NumberOfSegments}");

        try {
            var label = this.Dimension.FamilyLabel;
            if (label != null) {
                lines.Add(string.Empty);
                lines.Add("--- Label Parameter ---");
                lines.Add($"  Name: {label.Definition.Name}");
                lines.Add($"  Type/Instance: {label.GetTypeInstanceDesignation()}");
            }
        } catch { }

        return string.Join(Environment.NewLine, lines);
    }

    #endregion

    #region ReferencePlane Methods

    private string GetRefPlaneSecondary() {
        var strength = GetRefPlaneStrength(this.RefPlane!);
        return $"Strength: {strength}";
    }

    private string GetRefPlaneTooltip() {
        var lines = new List<string> {
            $"Name: {this.RefPlane!.Name.NullIfEmpty() ?? "(unnamed)"}",
            $"Element ID: {this.RefPlane.Id}",
            $"Strength: {GetRefPlaneStrength(this.RefPlane)}"
        };

        // Check if it's a reference
        var isRef = this.RefPlane.get_Parameter(BuiltInParameter.ELEM_REFERENCE_NAME);
        if (isRef != null)
            lines.Add($"Is Reference: {isRef.AsInteger() != (int)RpStrength.NotARef}");

        return string.Join(Environment.NewLine, lines);
    }

    private static RpStrength GetRefPlaneStrength(ReferencePlane rp) {
        try {
            var param = rp.get_Parameter(BuiltInParameter.ELEM_REFERENCE_NAME);
            return param != null ? (RpStrength)param.AsInteger() : RpStrength.NotARef;
        } catch {
            return RpStrength.NotARef;
        }
    }

    #endregion
}

internal static class StringExtensions {
    public static string? NullIfEmpty(this string? s) => string.IsNullOrEmpty(s) ? null : s;
}