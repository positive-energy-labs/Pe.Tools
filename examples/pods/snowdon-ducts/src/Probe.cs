// Shared helpers for the three entrypoints. Not an entrypoint: it declares no script container.
// Limits mirror settings/checks.json defaults; a script cannot read the Page copy of that member.

public static class Probe
{
    public const int MaxSystems = 25;
    public const int MaxFittingsPerRun = 60;
    public const double ExperimentDelta = 0.05;
    public static readonly string[] SandboxMarkers = { "copy", "sandbox" };
    public static readonly string[] LossNames = { "Loss Coefficient", "Pressure Drop" };

    public static bool IsSandbox(Document d)
    {
        var title = d.Title ?? "";
        return SandboxMarkers.Any(m => title.IndexOf(m, System.StringComparison.OrdinalIgnoreCase) >= 0);
    }

    public static IEnumerable<MechanicalSystem> DuctSystems(Document d) =>
        new FilteredElementCollector(d).OfClass(typeof(MechanicalSystem)).Cast<MechanicalSystem>();

    public static IEnumerable<FamilyInstance> Fittings(Document d) =>
        new FilteredElementCollector(d).OfCategory(BuiltInCategory.OST_DuctFitting).WhereElementIsNotElementType().OfType<FamilyInstance>();

    public static IEnumerable<Connector> Connectors(FamilyInstance fi) =>
        fi.MEPModel?.ConnectorManager?.Connectors.Cast<Connector>() ?? Enumerable.Empty<Connector>();

    public static Parameter LossParameter(Element e) =>
        LossNames.Select(n => e.LookupParameter(n)).FirstOrDefault(p => p != null && p.StorageType == StorageType.Double);

    public static string NameOf(Element e) =>
        e is FamilyInstance fi ? $"{fi.Symbol?.FamilyName} : {fi.Name}" : e.Name;

    // Element ids are valid only for this open lifetime; callers must revalidate before acting.
    public static long IdOf(Element e) => e.Id.Value;
}
