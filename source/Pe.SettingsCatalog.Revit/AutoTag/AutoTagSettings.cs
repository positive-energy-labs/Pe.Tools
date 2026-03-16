using Newtonsoft.Json;
using Newtonsoft.Json.Converters;
using TypeGen.Core.TypeAnnotations;

namespace Pe.SettingsCatalog.Revit.AutoTag;

[ExportTsInterface]
public class AutoTagSettings {
    public bool Enabled { get; set; } = true;

    public List<AutoTagConfiguration> Configurations { get; set; } = [];
}

[ExportTsInterface]
public class AutoTagConfiguration {
    public BuiltInCategory BuiltInCategory { get; set; } = BuiltInCategory.INVALID;

    public string TagFamilyName { get; set; } = string.Empty;

    public string TagTypeName { get; set; } = "Standard";

    public bool Enabled { get; set; } = true;
    public bool AddLeader { get; set; } = true;

    [JsonConverter(typeof(StringEnumConverter))]
    public TagOrientationMode TagOrientation { get; set; } = TagOrientationMode.Horizontal;

    public double OffsetDistance { get; set; } = 2.0;
    public double OffsetAngle { get; set; }
    public bool SkipIfAlreadyTagged { get; set; } = true;
    public List<ViewTypeFilter> ViewTypeFilter { get; set; } = [];
}

[ExportTsEnum]
public enum TagOrientationMode {
    Horizontal,
    Vertical
}

[ExportTsEnum]
public enum ViewTypeFilter {
    FloorPlan,
    CeilingPlan,
    Elevation,
    Section,
    ThreeD,
    DraftingView,
    EngineeringPlan
}
