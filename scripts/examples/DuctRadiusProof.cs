using System;
using System.Linq;
using Autodesk.Revit.DB;
using Pe.Revit.Scripting.Context;
using Pe.Revit.Global.Lib.Mep;

// Read-only native regression. Run with an explicit open Chadds document target.
public sealed class DuctRadiusProof : PeScriptContainer {
    public override void Execute() {
        var element = (FamilyInstance)doc!.GetElement(new ElementId(12767100L));
        var center = element.LookupParameter("Center Radius");
        var duct = element.LookupParameter("Duct Radius");
        var snapshot = DuctSnapshots.Snapshot(doc);
        var fitting = snapshot.Nodes.Single(n => n.Id == element.Id.Value);
        var actual = fitting.FittingGeometry!.RadiusOverDiameter.Value;
        Result(new { fitting.Id, fitting.Family, fitting.Type,
            centerSpec = center.Definition.GetDataType().TypeId,
            ductSpec = duct.Definition.GetDataType().TypeId,
            centerFt = center.AsDouble(), ductFt = duct.AsDouble(), actual,
            fitting.FittingGeometry });
        if (Math.Abs(center.AsDouble() * 12 - 4) > 1e-6 || Math.Abs(duct.AsDouble() * 12 - 2) > 1e-6)
            throw new Exception("Radius witness changed: expected 4 inch center radius and 2 inch duct radius.");
        if (actual is null || Math.Abs(actual.Value - 1) > 1e-6)
            throw new Exception("Round Elbow 12767100, type 1 D: expected captured r/D = 1.");
    }
}
