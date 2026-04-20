using System.ComponentModel;

namespace Pe.Revit.FamilyFoundry.Plans;

public class ParamDrivenExtrusionsPlan : IOperationSettings {
    [Description("Constrained rectangle extrusions to create.")]
    public List<ConstrainedRectangleExtrusionSnapshot> Rectangles { get; init; } = [];

    [Description("Constrained circle extrusions to create.")]
    public List<ConstrainedCircleExtrusionSnapshot> Circles { get; init; } = [];

    public bool Enabled { get; init; } = true;
}