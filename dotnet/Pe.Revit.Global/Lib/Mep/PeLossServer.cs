using Autodesk.Revit.DB.ExtensibleStorage;
using Autodesk.Revit.DB.ExternalService;
using Autodesk.Revit.DB.Mechanical;
using Pe.Shared.RevitData.Ducts;
using Serilog;
using Newtonsoft.Json;

namespace Pe.Revit.Global.Lib.Mep;

/// <summary>Consumes host-priced results. Revit recalculation never runs a second loss engine.</summary>
public sealed class PeLossServer : IDuctFittingAndAccessoryPressureDropServer {
    public static readonly Guid Id = new("5e1f0c0e-7e10-4c0e-9e1f-0000c0ef0001");
    private static readonly Guid SchemaId = new("5e1f0c0e-7e10-4c0e-9e1f-0000c0ef0003");
    public const string ResultsField = "Results";

    /// <summary>Registers and activates the server once per process.</summary>
    public static void Register() {
        var service = (MultiServerService)ExternalServiceRegistry.GetService(ExternalServices.BuiltInExternalServices.DuctFittingAndAccessoryPressureDropService);
        if (!service.IsRegisteredServerId(Id)) service.AddServer(new PeLossServer());
        var active = service.GetActiveServerIds().ToList();
        if (!active.Contains(Id)) {
            active.Add(Id);
            service.SetActiveServers(active);
        }
        Log.Information("Pe loss server {Id} registered ({Active} active duct loss servers)", Id, active.Count);
    }

    public static bool IsRegistered =>
        ((MultiServerService)ExternalServiceRegistry.GetService(ExternalServices.BuiltInExternalServices.DuctFittingAndAccessoryPressureDropService)).IsRegisteredServerId(Id);

    /// <summary>The entity holds only host-priced results; old table-pricing entities are not accepted.</summary>
    public static Schema Schema() => Autodesk.Revit.DB.ExtensibleStorage.Schema.Lookup(SchemaId) ?? Build();

    private static Schema Build() {
        var b = new SchemaBuilder(SchemaId);
        b.SetSchemaName("PeDuctLossResults");
        b.SetReadAccessLevel(AccessLevel.Public);
        b.SetWriteAccessLevel(AccessLevel.Public);
        b.SetDocumentation("Host-priced coefficients and velocity-pressure bases. Reapply from Pe when the basis changes.");
        _ = b.AddSimpleField(ResultsField, typeof(string));
        return b.Finish();
    }

    public Guid GetServerId() => Id;
    public ExternalServiceId GetServiceId() => ExternalServices.BuiltInExternalServices.DuctFittingAndAccessoryPressureDropService;
    public string GetName() => "Pe duct loss";
    public string GetVendorId() => "PE";
    public string GetDescription() => "Consumes host-priced fitting coefficients; refuses changed or ambiguous velocity-pressure bases.";
    public Schema GetDataSchema() => Schema();
    public bool IsApplicable(DuctFittingAndAccessoryPressureDropData data) => true;

    public bool Calculate(DuctFittingAndAccessoryPressureDropData data) {
        var entity = data.GetDuctFittingAndAccessoryData().GetEntity();
        if (!entity.IsValid()) return false;
        IReadOnlyList<DuctLossResult>? results;
        try {
            results = JsonConvert.DeserializeObject<List<DuctLossResult>>(entity.Get<string>(ResultsField));
        } catch (JsonException ex) {
            Log.Warning(ex, "Pe loss server: invalid host results; reapply losses from Pe");
            return false;
        }
        if (results is not { Count: > 0 } || results.Any(r => !Valid(r))) return false;
        var items = data.GetPresureDropItems();
        var coefficients = new List<double>();
        // TODO: docs/features/ducts/LEDGER.md: prove native Pv matching for elbows, transitions and both tap legs in a controlled Revit test.
        foreach (var item in items) {
            var pv = UnitUtils.ConvertFromInternalUnits(item.VelocityPressure, UnitTypeId.InchesOfWater60DegreesFahrenheit);
            var matches = results.Where(r => Math.Abs(r.VelocityPressureInWg - pv) <= 1e-7 * Math.Max(1, Math.Abs(pv)))
                .Select(r => r.Coefficient).Distinct().ToList();
            if (matches.Count != 1) {
                Log.Warning("Pe loss server: changed or ambiguous velocity pressure {Pv}; reapply losses from Pe", pv);
                return false;
            }
            coefficients.Add(matches[0]);
        }
        for (var i = 0; i < items.Count; i++) items[i].Coefficient = coefficients[i];
        return items.Count > 0;
    }

    internal static bool Valid(DuctLossResult result) =>
        !double.IsNaN(result.Coefficient) && !double.IsInfinity(result.Coefficient) &&
        !double.IsNaN(result.VelocityPressureInWg) && !double.IsInfinity(result.VelocityPressureInWg) &&
        result.VelocityPressureInWg >= 0;
}
