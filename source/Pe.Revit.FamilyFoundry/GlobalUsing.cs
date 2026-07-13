// Pe.Revit.PolyFill stays until Pe.Bcl.Compat ships an IDictionary<,> TryAdd overload:
// AuthoredParamDrivenSolidsCompiler calls TryAdd on IDictionary-typed receivers, which only
// the vendored shim covers on net48. Revit API shims already come from Pe.Revit.Compat.
global using Pe.Revit.Compat;
global using Pe.Revit.PolyFill;
global using Pe.Revit.Extensions.ProjDocument;
global using Pe.Revit.FamilyFoundry.Capture;
global using Pe.Revit.FamilyFoundry.OperationSettings;
global using Pe.Revit.FamilyFoundry.Plans;
global using Pe.Revit.FamilyFoundry.Snapshots;
global using Pe.Revit.Parameters;
