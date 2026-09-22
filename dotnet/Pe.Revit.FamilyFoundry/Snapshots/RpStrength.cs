using Newtonsoft.Json;
using Newtonsoft.Json.Converters;

namespace Pe.Revit.FamilyFoundry.Snapshots;

/// <summary>The `ELEM_REFERENCE_NAME` value set by number (Revit's "Is Reference" combo).</summary>
[JsonConverter(typeof(StringEnumConverter))]
public enum RpStrength {
    Left = 0,
    CenterLR = 1,
    Right = 2,
    Front = 3,
    CenterFB = 4,
    Back = 5,
    Bottom = 6,
    CenterElev = 7,
    Top = 8,
    NotARef = 12,
    StrongRef = 13,
    WeakRef = 14
}
