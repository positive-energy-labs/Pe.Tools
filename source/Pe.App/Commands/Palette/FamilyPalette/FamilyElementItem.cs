using Pe.Extensions.FamDocument;
using Pe.Extensions.FamParameter;
using Pe.Extensions.FamParameter.Formula;
using Pe.FamilyFoundry.Snapshots;
using Pe.Ui.Core;
using System.Windows.Media.Imaging;
using Color = System.Windows.Media.Color;

namespace Pe.App.Commands.Palette.FamilyPalette;

public enum FamilyElementType {
    Parameter,
    Connector,
    Dimension,
    ReferencePlane,
    Family
}

public class FamilyElementItem : IPaletteListItem {
    public FamilyElementItem(FamilyParameter param, FamilyDocument familyDoc) {
        this.FamilyDoc = familyDoc;
        this.FamilyParam = param;
        this.ElementType = FamilyElementType.Parameter;
        this.ElementId = null; // FamilyParameters don't have element IDs for view operations
    }

    public FamilyElementItem(ConnectorElement connector, FamilyDocument familyDoc) {
        this.FamilyDoc = familyDoc;
        this.Connector = connector;
        this.ElementType = FamilyElementType.Connector;
        this.ElementId = connector.Id;
    }

    public FamilyElementItem(Dimension dim, FamilyDocument familyDoc) {
        this.FamilyDoc = familyDoc;
        this.Dimension = dim;
        this.ElementType = FamilyElementType.Dimension;
        this.ElementId = dim.Id;
    }

    public FamilyElementItem(ReferencePlane refPlane, FamilyDocument familyDoc) {
        this.FamilyDoc = familyDoc;
        this.RefPlane = refPlane;
        this.ElementType = FamilyElementType.ReferencePlane;
        this.ElementId = refPlane.Id;
    }

    public FamilyElementItem(FamilyInstance instance, FamilyDocument familyDoc) {
        this.FamilyDoc = familyDoc;
        this.FamilyInstance = instance;
        this.ElementType = FamilyElementType.Family;
        this.ElementId = instance.Id;
    }

    // Backing fields for each element type
    public FamilyParameter? FamilyParam { get; }
    public ConnectorElement? Connector { get; }
    public Dimension? Dimension { get; }
    public ReferencePlane? RefPlane { get; }
    public FamilyInstance? FamilyInstance { get; }
    public FamilyDocument FamilyDoc { get; }

    public FamilyElementType ElementType { get; }
    public ElementId? ElementId { get; }

    public string PersistenceKey => this.ElementType switch {
        FamilyElementType.Parameter => $"param:{this.FamilyParam!.Id}",
        _ => $"{this.ElementType.ToString().ToLower()}:{this.ElementId}"
    };

    public bool HasAnyAssociation => this.ElementType == FamilyElementType.Parameter &&
                                     this.FamilyParam!.HasAnyAssociation(this.FamilyDoc);

    public string TextPrimary => this.ElementType switch {
        FamilyElementType.Parameter => this.FamilyParam!.Definition.Name,
        FamilyElementType.Connector => $"{this.Connector!.Domain} Connector",
        FamilyElementType.Dimension => this.GetDimensionName(),
        FamilyElementType.ReferencePlane => this.RefPlane!.Name.NullIfEmpty() ?? $"RefPlane ({this.RefPlane.Id})",
        FamilyElementType.Family => this.FamilyInstance!.Symbol.FamilyName,
        _ => "Unknown"
    };

    public string TextSecondary => this.ElementType switch {
        FamilyElementType.Parameter => this.GetParameterSecondary(),
        FamilyElementType.Connector => this.GetConnectorSecondary(),
        FamilyElementType.Dimension => this.GetDimensionSecondary(),
        FamilyElementType.ReferencePlane => this.GetRefPlaneSecondary(),
        FamilyElementType.Family => this.FamilyInstance!.Symbol.Name,
        _ => string.Empty
    };

    public string TextPill => this.ElementType switch {
        FamilyElementType.Parameter => this.FamilyParam!.GetTypeInstanceDesignation(),
        FamilyElementType.Connector => "Connector",
        FamilyElementType.Dimension => "Dimension",
        FamilyElementType.ReferencePlane => "RefPlane",
        FamilyElementType.Family => "Nested",
        _ => string.Empty
    };

    public Func<string> GetTextInfo => () => this.ElementType switch {
        FamilyElementType.Parameter => this.GetParameterTooltip(),
        FamilyElementType.Connector => this.GetConnectorTooltip(),
        FamilyElementType.Dimension => this.GetDimensionTooltip(),
        FamilyElementType.ReferencePlane => this.GetRefPlaneTooltip(),
        FamilyElementType.Family => this.GetNestedFamilyTooltip(),
        _ => string.Empty
    };

    public BitmapImage? Icon => null;
    public Color? ItemColor => null;

    #region Associated Elements Helpers

    /// <summary>
    ///     Gets all associated elements for this item as a structured list for preview panel display.
    /// </summary>
    public List<AssociatedElement> GetAssociatedElements() {
        var results = new List<AssociatedElement>();

        switch (this.ElementType) {
        case FamilyElementType.Parameter:
            // Dimensions
            foreach (var dim in this.FamilyParam!.AssociatedDimensions(this.FamilyDoc)) {
                var dimType = dim.DimensionType?.Name ?? "Unknown Type";
                results.Add(new AssociatedElement(
                    $"{dimType} (ID: {dim.Id})",
                    "Dimension",
                    dim.Id,
                    AssociatedElementType.Dimension
                ));
            }

            // Arrays
            foreach (var array in this.FamilyParam.AssociatedArrays(this.FamilyDoc))
                results.Add(new AssociatedElement(
                    $"Array (ID: {array.Id})",
                    "Array",
                    array.Id,
                    AssociatedElementType.Array
                ));

            // Connectors
            foreach (var connector in this.FamilyParam.AssociatedConnectors(this.FamilyDoc))
                results.Add(new AssociatedElement(
                    $"{connector.Domain} Connector (ID: {connector.Id})",
                    "Connector",
                    connector.Id,
                    AssociatedElementType.Connector
                ));

            // Formula Dependents
            foreach (var fp in this.FamilyParam.GetDependents(this.FamilyDoc.FamilyManager.Parameters))
                results.Add(new AssociatedElement(
                    fp.Definition.Name,
                    "Parameter",
                    null,
                    AssociatedElementType.Parameter,
                    fp
                ));

            break;

        case FamilyElementType.Dimension:
            try {
                var label = this.Dimension!.FamilyLabel;
                if (label != null)
                    results.Add(new AssociatedElement(
                        label.Definition.Name,
                        "Label Parameter",
                        null,
                        AssociatedElementType.Parameter,
                        label
                    ));
            } catch { }

            break;

        case FamilyElementType.Connector:
            foreach (Parameter param in this.Connector!.Parameters) {
                var associated = this.FamilyDoc.FamilyManager.GetAssociatedFamilyParameter(param);
                if (associated != null)
                    results.Add(new AssociatedElement(
                        $"{param.Definition.Name} → {associated.Definition.Name}",
                        "Parameter Association",
                        null,
                        AssociatedElementType.Parameter,
                        associated
                    ));
            }

            break;

        case FamilyElementType.Family:
            foreach (Parameter param in this.FamilyInstance!.Parameters) {
                var associated = this.FamilyDoc.FamilyManager.GetAssociatedFamilyParameter(param);
                if (associated != null)
                    results.Add(new AssociatedElement(
                        $"{param.Definition.Name} → {associated.Definition.Name}",
                        "Parameter Association",
                        null,
                        AssociatedElementType.Parameter,
                        associated
                    ));
            }

            break;
        }

        return results;
    }

    #endregion

    #region NestedFamily Methods

    private string GetNestedFamilyTooltip() {
        var lines = new List<string> {
            $"Family: {this.FamilyInstance!.Symbol.FamilyName}",
            $"Type: {this.FamilyInstance.Symbol.Name}",
            $"Element ID: {this.FamilyInstance.Id}"
        };

        // Get parameter associations
        var associations = new List<(string instParam, string famParam)>();
        foreach (Parameter param in this.FamilyInstance.Parameters) {
            var associated = this.FamilyDoc.FamilyManager.GetAssociatedFamilyParameter(param);
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
        this.FamilyParam!.AssociatedDimensions(this.FamilyDoc).Count() +
        this.FamilyParam.AssociatedArrays(this.FamilyDoc).Count() +
        this.FamilyParam.AssociatedConnectors(this.FamilyDoc).Count() +
        this.FamilyParam.GetDependents(this.FamilyDoc.FamilyManager.Parameters).Count();

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

        var dims = this.FamilyParam.AssociatedDimensions(this.FamilyDoc).ToList();
        lines.Add($"Dimensions: {dims.Count}");
        foreach (var dim in dims) {
            var dimType = dim.DimensionType?.Name ?? "Unknown Type";
            lines.Add($"  - {dimType} (ID: {dim.Id})");
        }

        var arrays = this.FamilyParam.AssociatedArrays(this.FamilyDoc).ToList();
        lines.Add($"Arrays: {arrays.Count}");
        foreach (var array in arrays) lines.Add($"  - Array (ID: {array.Id})");

        var connectors = this.FamilyParam.AssociatedConnectors(this.FamilyDoc).ToList();
        lines.Add($"Connectors: {connectors.Count}");
        foreach (var connector in connectors) lines.Add($"  - {connector.Domain} Connector (ID: {connector.Id})");

        var directParams = this.FamilyParam.AssociatedParameters.Cast<Parameter>().ToList();
        lines.Add($"Direct Element Params: {directParams.Count}");
        foreach (var param in directParams) lines.Add($"  - {param.Definition.Name} (ID: {param.Id})");

        var formulaParams = this.FamilyParam.GetDependents(this.FamilyDoc.FamilyManager.Parameters).ToList();
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
            var associated = this.FamilyDoc.FamilyManager.GetAssociatedFamilyParameter(param);
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

/// <summary>
///     Represents an element associated with another family element (for preview panel display).
/// </summary>
public record AssociatedElement(
    string Name,
    string Type,
    ElementId? ElementId,
    AssociatedElementType AssocType,
    FamilyParameter? FamilyParameter = null
);

public enum AssociatedElementType {
    Dimension,
    Array,
    Connector,
    Parameter
}

internal static class StringExtensions {
    public static string? NullIfEmpty(this string? s) => string.IsNullOrEmpty(s) ? null : s;
}
