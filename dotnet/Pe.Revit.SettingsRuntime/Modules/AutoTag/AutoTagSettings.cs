using Newtonsoft.Json;
using Newtonsoft.Json.Converters;

namespace Pe.Revit.SettingsRuntime.Modules.AutoTag;

public class AutoTagSettings {
    /// <summary>The model's stored settings: one owner blob on Project Information.</summary>
    public static readonly Pe.Shared.RevitData.Serialization.OwnerDescriptor Owner = new("autotag", 1,
        new Guid("a89b3d96-72ad-4972-a532-81676635755b"), "_PE_AutoTag", "Pe.Tools AutoTag settings (JSON).") { ValidateData = read => Read(read).Refusal };

    public Newtonsoft.Json.Linq.JObject ToData() => Newtonsoft.Json.Linq.JObject.FromObject(this, StoredSerializer());

    /// <summary>The model's settings, or the reason they are "can't read, kept" (AutoTag then stays off).</summary>
    public static Pe.Shared.RevitData.Serialization.OwnerValue<AutoTagSettings> Read(Pe.Shared.RevitData.Serialization.OwnerBlobRead read) =>
        Pe.Shared.RevitData.Serialization.OwnerBlob.Parse(read, data => data.ToObject<AutoTagSettings>(StoredSerializer()));

    // An unknown key is a read error, not a key to drop on the next save (ADR 0032 storage amendment, rule 2).
    private static JsonSerializer StoredSerializer() {
        var settings = Pe.Revit.SettingsRuntime.Json.RevitJsonFormatting.CreateRevitIndentedSettings();
        settings.MissingMemberHandling = MissingMemberHandling.Error;
        return JsonSerializer.Create(settings);
    }

    public bool Enabled { get; set; } = true;

    public List<AutoTagConfiguration> Configurations { get; set; } = [];
}

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

public enum TagOrientationMode {
    Horizontal,
    Vertical
}

public enum ViewTypeFilter {
    FloorPlan,
    CeilingPlan,
    Elevation,
    Section,
    ThreeD,
    DraftingView,
    EngineeringPlan
}
