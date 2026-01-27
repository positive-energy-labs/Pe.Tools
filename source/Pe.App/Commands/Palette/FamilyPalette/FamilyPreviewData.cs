namespace Pe.App.Commands.Palette.FamilyPalette;

/// <summary>
///     Data model for family preview display.
///     Supports previewing Family, FamilySymbol (type), or FamilyInstance with a unified structure.
/// </summary>
public class FamilyPreviewData {
    /// <summary>The source type that was used to build this preview</summary>
    public FamilyPreviewSource Source { get; init; }

    // Identity
    public string FamilyName { get; init; } = string.Empty;
    public string? TypeName { get; init; }
    public string CategoryName { get; init; } = string.Empty;
    public int TypeCount { get; init; }
    public List<string> TypeNames { get; init; } = [];

    // For instance-specific info
    public string? InstanceId { get; init; }
    public string? InstanceLevel { get; init; }
    public string? InstanceHost { get; init; }
    public (double X, double Y, double Z)? InstanceLocation { get; init; }

    // Parameters - the main content
    public List<FamilyParameterPreview> Parameters { get; init; } = [];

    // Counts for summary
    public int TypeParameterCount => this.Parameters.Count(p => !p.IsInstance);
    public int InstanceParameterCount => this.Parameters.Count(p => p.IsInstance);
    public int FormulaParameterCount => this.Parameters.Count(p => !string.IsNullOrEmpty(p.Formula));
}

/// <summary>
///     Indicates what source object the preview was built from.
/// </summary>
public enum FamilyPreviewSource {
    /// <summary>Preview built from a Family object (shows all types)</summary>
    Family,

    /// <summary>Preview built from a FamilySymbol/type (shows single type values)</summary>
    FamilySymbol,

    /// <summary>Preview built from a FamilyInstance (shows instance + type values)</summary>
    FamilyInstance
}

/// <summary>
///     Parameter information for preview display.
///     Supports showing formula OR values per type in a unified way.
/// </summary>
public record FamilyParameterPreview {
    public string Name { get; init; } = string.Empty;
    public bool IsInstance { get; init; }
    public string DataType { get; init; } = string.Empty;
    public string StorageType { get; init; } = string.Empty;
    public string Group { get; init; } = string.Empty;

    /// <summary>If formula-driven, the formula string. Otherwise null.</summary>
    public string? Formula { get; init; }

    /// <summary>
    ///     Values per type name. For FamilySymbol source, will have one entry.
    ///     For FamilyInstance, shows the instance value if IsInstance, else the type value.
    ///     For Family, shows values for all types.
    /// </summary>
    public Dictionary<string, string?> ValuesPerType { get; init; } = new();

    /// <summary>For instance parameters on a FamilyInstance source, the actual instance value</summary>
    public string? InstanceValue { get; init; }

    // Metadata
    public bool IsBuiltIn { get; init; }
    public bool IsShared { get; init; }
    public Guid? SharedGuid { get; init; }
}
