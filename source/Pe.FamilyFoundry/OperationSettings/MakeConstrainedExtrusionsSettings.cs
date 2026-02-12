using Pe.FamilyFoundry.Snapshots;
using System.ComponentModel;

namespace Pe.FamilyFoundry.OperationSettings;

public class MakeConstrainedExtrusionsSettings : IOperationSettings {
    [Description("Constrained rectangle extrusions to create.")]
    public List<ConstrainedRectangleExtrusionSpec> Rectangles { get; init; } = [];

    [Description("Constrained circle extrusions to create.")]
    public List<ConstrainedCircleExtrusionSpec> Circles { get; init; } = [];

    public bool Enabled { get; init; } = true;
}
