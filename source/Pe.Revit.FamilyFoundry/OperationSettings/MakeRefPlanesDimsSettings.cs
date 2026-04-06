using Pe.FamilyFoundry.Snapshots;
using System.ComponentModel;

namespace Pe.FamilyFoundry.OperationSettings;

public class MakeRefPlaneAndDimsSettings : IOperationSettings {
    [Description("Mirror specs: planes symmetric around a center anchor (3 planes, 2 dims each)")]
    public List<MirrorSpec> MirrorSpecs { get; init; } = [];

    [Description("Offset specs: single plane offset from an anchor (2 planes, 1 dim each)")]
    public List<OffsetSpec> OffsetSpecs { get; init; } = [];

    public bool Enabled { get; init; } = true;
}