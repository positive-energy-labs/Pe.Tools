using Newtonsoft.Json;
using Newtonsoft.Json.Converters;
using Pe.Global.Services.Storage.Core.Json.SchemaProcessors;
using Pe.Global.Services.Storage.Core.Json.SchemaProviders;

namespace Pe.Global.Services.AutoTag.Core;

/// <summary>
///     Root settings container for AutoTag feature.
/// </summary>
public class AutoTagSettings {
    /// <summary>
    ///     Global enable/disable for AutoTag feature.
    /// </summary>
    public bool Enabled { get; set; } = true;

    /// <summary>
    ///     Individual tag configurations per category.
    /// </summary>
    public List<AutoTagConfiguration> Configurations { get; set; } = [];
}

/// <summary>
///     Configuration for auto-tagging a specific category of elements.
/// </summary>
public class AutoTagConfiguration {
    /// <summary>
    ///     The category name of elements to auto-tag (e.g., "Mechanical Equipment").
    ///     Must match a category that has a corresponding tag category.
    /// </summary>
    [SchemaExamples(typeof(TaggableCategoryNamesProvider))]
    public string CategoryName { get; set; } = string.Empty;

    /// <summary>
    ///     The tag family name to use (e.g., "M_Mechanical Equipment Tag").
    ///     LSP autocomplete will be filtered based on the category.
    /// </summary>
    [SchemaExamples(typeof(MultiCategoryTagProvider))]
    public string TagFamilyName { get; set; } = string.Empty;

    /// <summary>
    ///     The specific tag type/symbol name within the family (e.g., "Standard", "Large").
    /// </summary>
    public string TagTypeName { get; set; } = "Standard";

    /// <summary>
    ///     Enable/disable tagging for this category.
    /// </summary>
    public bool Enabled { get; set; } = true;

    /// <summary>
    ///     Whether to add a leader from the tag to the element.
    /// </summary>
    public bool AddLeader { get; set; } = true;

    /// <summary>
    ///     Tag orientation (Horizontal or Vertical).
    /// </summary>
    [JsonConverter(typeof(StringEnumConverter))]
    public TagOrientationMode TagOrientation { get; set; } = TagOrientationMode.Horizontal;

    /// <summary>
    ///     Offset distance from element location (in feet).
    ///     Positive values move the tag away from the element.
    /// </summary>
    public double OffsetDistance { get; set; } = 2.0;

    /// <summary>
    ///     Offset direction in degrees (0 = right, 90 = up, 180 = left, 270 = down).
    /// </summary>
    public double OffsetAngle { get; set; } = 0.0;

    /// <summary>
    ///     Skip tagging if the element already has a tag of this category.
    /// </summary>
    public bool SkipIfAlreadyTagged { get; set; } = true;

    /// <summary>
    ///     Only auto-tag in specific view types. Empty means all views.
    /// </summary>
    [JsonConverter(typeof(StringEnumConverter))]
    public List<ViewTypeFilter> ViewTypeFilter { get; set; } = [];
}

/// <summary>
///     Tag orientation options.
/// </summary>
public enum TagOrientationMode {
    Horizontal,
    Vertical
}

/// <summary>
///     View type filter options for auto-tagging.
/// </summary>
public enum ViewTypeFilter {
    FloorPlan,
    CeilingPlan,
    Elevation,
    Section,
    ThreeD,
    DraftingView,
    EngineeringPlan
}
