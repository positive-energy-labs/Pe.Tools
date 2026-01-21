using Newtonsoft.Json;
using Newtonsoft.Json.Converters;

namespace Pe.FamilyFoundry.Snapshots;

/// <summary>
///     Mirror spec: creates two planes symmetrically around a center anchor.
///     Always results in 3 planes (center + left + right) and 2 dimensions
///     (EQ constraint on all 3, parameter label on the 2 side planes).
/// </summary>
public class MirrorSpec {
    /// <summary>Base name - generates "{Name} (Left)" and "{Name} (Right)" planes</summary>
    public required string Name { get; init; }

    /// <summary>The center anchor plane (e.g., "Center (Left/Right)")</summary>
    public required string CenterAnchor { get; init; }

    /// <summary>Parameter to assign to the 2-plane dimension label</summary>
    public string? Parameter { get; init; }

    /// <summary>Reference strength for the created planes</summary>
    public RpStrength Strength { get; set; } = RpStrength.NotARef;

    public string GetLeftName(XYZ normal) => $"{this.Name} ({GetNegativeLabel(normal)})";
    public string GetRightName(XYZ normal) => $"{this.Name} ({GetPositiveLabel(normal)})";

    private static string GetNegativeLabel(XYZ normal) =>
        Math.Abs(normal.X) == 1.0 ? "Left" :
        Math.Abs(normal.Y) == 1.0 ? "Back" :
        Math.Abs(normal.Z) == 1.0 ? "Bottom" :
        throw new ArgumentException($"Invalid normal: {normal}");

    private static string GetPositiveLabel(XYZ normal) =>
        Math.Abs(normal.X) == 1.0 ? "Right" :
        Math.Abs(normal.Y) == 1.0 ? "Front" :
        Math.Abs(normal.Z) == 1.0 ? "Top" :
        throw new ArgumentException($"Invalid normal: {normal}");

    public override string ToString() => $"Mirror: {this.Name} @ {this.CenterAnchor}";
}

/// <summary>
///     Offset spec: creates one plane offset from an anchor in a specific direction.
///     Always results in 2 planes (anchor + target) and 1 dimension.
/// </summary>
public class OffsetSpec {
    /// <summary>Name of the plane being created</summary>
    public required string Name { get; init; }

    /// <summary>The anchor/reference plane to offset from</summary>
    public required string AnchorName { get; init; }

    /// <summary>Direction of offset from anchor (Positive or Negative along normal)</summary>
    public required OffsetDirection Direction { get; init; }

    /// <summary>Parameter to assign to the dimension label</summary>
    public string? Parameter { get; init; }

    /// <summary>Reference strength for the created plane</summary>
    public RpStrength Strength { get; set; } = RpStrength.NotARef;

    public override string ToString() => $"Offset: {this.Name} @ {this.AnchorName} ({this.Direction})";
}

[JsonConverter(typeof(StringEnumConverter))]
public enum OffsetDirection { Positive, Negative }

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