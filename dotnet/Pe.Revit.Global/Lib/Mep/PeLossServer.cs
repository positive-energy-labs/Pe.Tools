using Autodesk.Revit.DB.ExtensibleStorage;
using Autodesk.Revit.DB.ExternalService;
using Autodesk.Revit.DB.Mechanical;
using Pe.Shared.RevitData.Ducts;
using Serilog;
using System.Collections.Concurrent;

namespace Pe.Revit.Global.Lib.Mep;

/// <summary>
///     Pe's duct fitting loss server, the one method `ducts.apply` points a fitting at (pressure-drop ledger, Decided
///     2026-10-08 and 2026-10-12). Revit calls <see cref="Calculate" /> per fitting per recalculation and hands it the
///     fitting's connectors with their live flows and sizes. Per fitting, the server's entity names the family's own
///     coefficient parameter (the FittingCoefficient slot, default Pe_C) and the ASHRAE table of its rule. A positive
///     parameter wins and charges every leg (the family owns the number: a stamped elbow); otherwise each leg is priced
///     from the table and the connectors (<see cref="DuctFittingPricing" />: a tap's branch and straight legs, a
///     transition, an unstamped elbow). Nothing to read charges 0.
///     The GUIDs never change: a fitting stores the server id in RBS_DUCT_FITTING_LOSS_METHOD_SERVER_PARAM, and a
///     changed id orphans every fitting that points at it. A Revit without this add-in shows Revit's missing-server
///     dialog and charges 0 (accepted, ruling 2026-10-08; the export route freezes numbers for that case).
/// </summary>
public sealed class PeLossServer : IDuctFittingAndAccessoryPressureDropServer {
    public static readonly Guid Id = new("5e1f0c0e-7e10-4c0e-9e1f-0000c0ef0001");
    private static readonly Guid SchemaId = new("5e1f0c0e-7e10-4c0e-9e1f-0000c0ef0002");
    public const string ParameterField = "Parameter";
    public const string TableField = "Table";

    private static Func<IEnumerable<Document>> _documents = Tracked;
    private static readonly ConcurrentDictionary<string, IReadOnlyDictionary<string, AshraeGrid>?> _tables = new(StringComparer.Ordinal);

    /// <summary>The SDK tracker's open project documents; Revit hands the server an id, not a document, so the fitting is resolved across them.</summary>
    private static IEnumerable<Document> Tracked() {
        foreach (var tracked in Services.Document.DocumentTrackerAccessor.Current?.Open ?? []) {
            Document? doc;
            try {
                doc = tracked.Resolve();
            } catch (Exception) {
                continue;
            }
            if (doc is { IsValidObject: true, IsFamilyDocument: false }) yield return doc;
        }
    }

    /// <summary>Registers and activates the server once per process. A documents override is for tests and scripts.</summary>
    public static void Register(Func<IEnumerable<Document>>? documents = null) {
        _documents = documents ?? Tracked;
        var service = (MultiServerService)ExternalServiceRegistry.GetService(ExternalServices.BuiltInExternalServices.DuctFittingAndAccessoryPressureDropService);
        if (!service.IsRegisteredServerId(Id)) service.AddServer(new PeLossServer());
        var active = service.GetActiveServerIds().ToList();
        if (!active.Contains(Id)) {
            active.Add(Id);
            service.SetActiveServers(active);
        }
        Log.Information("Pe loss server {Id} registered ({Active} active duct loss servers)", Id, active.Count);
    }

    public static bool IsRegistered => Try(() =>
        (bool?)((MultiServerService)ExternalServiceRegistry.GetService(ExternalServices.BuiltInExternalServices.DuctFittingAndAccessoryPressureDropService)).IsRegisteredServerId(Id)) == true;

    /// <summary>The entity schema: the parameter the server reads on that fitting and the ASHRAE table it prices the legs from.</summary>
    public static Schema Schema() => Autodesk.Revit.DB.ExtensibleStorage.Schema.Lookup(SchemaId) ?? Build();

    private static Schema Build() {
        var b = new SchemaBuilder(SchemaId);
        b.SetSchemaName("PeDuctLoss");
        b.SetReadAccessLevel(AccessLevel.Public);
        b.SetWriteAccessLevel(AccessLevel.Public);
        b.SetDocumentation("The instance parameter the Pe duct loss server reads as the fitting's loss coefficient, and the ASHRAE table it prices the legs from when the parameter is absent.");
        _ = b.AddSimpleField(ParameterField, typeof(string));
        _ = b.AddSimpleField(TableField, typeof(string));
        return b.Finish();
    }

    /// <summary>Revit's shipped table, parsed once per process; null when the id has no supported grid.</summary>
    public static IReadOnlyDictionary<string, AshraeGrid>? Table(string id) => _tables.GetOrAdd(id, key => {
        try {
            return AshraeTables.Read(AshraeTables.DefaultFolder, [key]).Tables.TryGetValue(key, out var t) ? t : null;
        } catch (Exception ex) when (ex is IOException or InvalidOperationException) {
            Log.Warning(ex, "Pe loss server: ASHRAE table {Table} is unreadable", key);
            return null;
        }
    });

    public Guid GetServerId() => Id;
    public ExternalServiceId GetServiceId() => ExternalServices.BuiltInExternalServices.DuctFittingAndAccessoryPressureDropService;
    public string GetName() => "Pe duct loss";
    public string GetVendorId() => "PE";
    public string GetDescription() => "Charges the fitting family's own loss coefficient (default Pe_C), or prices each leg from its ASHRAE table and live flows.";
    public Schema GetDataSchema() => Schema();
    public bool IsApplicable(DuctFittingAndAccessoryPressureDropData data) => true;

    public bool Calculate(DuctFittingAndAccessoryPressureDropData data) {
        var fitting = data.GetDuctFittingAndAccessoryData();
        var id = fitting.GetFamilyInstanceId();
        var entity = Try(() => fitting.GetEntity());
        string? Field(string name) => entity is { } e && e.IsValid() && Try(() => e.Get<string>(name)) is { Length: > 0 } v ? v : null;
        var parameter = Field(ParameterField) ?? DuctParameterSlots.DefaultFittingCoefficient;
        var table = Field(TableField)?.ToUpperInvariant();
        var items = data.GetPresureDropItems();
        var element = Element(id);
        var own = element is null ? 0 : Own(element, parameter);
        if (own > 0) {
            foreach (var item in items) item.Coefficient = own;
            return true;
        }
        var grids = table is null ? null : Table(table);
        var legs = grids is null
            ? []
            : fitting.GetAllConnectorData().Select(c => new LossLeg(c.Index, c.Flow, Area(c), c.Profile == ConnectorProfileType.Round, c.FlowDirection == FlowDirectionType.In)).ToList();
        var partType = fitting.PartType.ToString();
        foreach (var item in items) {
            var c = grids is null ? 0 : Try(() => (double?)DuctFittingPricing.Price(partType, grids, legs, new LossItem(item.BeginConnectorIndex, item.EndConnectorIndex))) ?? 0;
            item.Coefficient = c > 0 && !double.IsNaN(c) && !double.IsInfinity(c) ? c : 0;
        }
        // The session proof reads this: what Revit reports per leg and what the server charged (Debug, off in production).
        if (Log.IsEnabled(Serilog.Events.LogEventLevel.Debug))
            Log.Debug("Pe loss server {Id} {Part} table {Table}: legs {Legs}; items {Items}", id.Value(), partType, table,
                legs.Select(l => $"{l.Index}:q={l.Flow:0.###},a={l.Area:0.####},{(l.Round ? "round" : "rect")},{(l.In ? "in" : "out")}"),
                items.Select(i => $"{i.BeginConnectorIndex}->{i.EndConnectorIndex}:c={i.Coefficient:0.####},pv={i.VelocityPressure:0.###}"));
        return true;
    }

    private static double Area(DuctFittingAndAccessoryConnectorData c) => c.Profile == ConnectorProfileType.Round
        ? Math.PI * c.Diameter * c.Diameter / 4
        : c.Width * c.Height;

    /// <summary>
    ///     The fitting across the open documents: the element with this id whose loss method is this server.
    ///     ponytail: ids collide across documents only by chance, and the server check breaks the tie.
    /// </summary>
    private static Element? Element(ElementId id) {
        foreach (var doc in _documents()) {
            var e = Try(() => doc.IsValidObject && !doc.IsFamilyDocument ? doc.GetElement(id) : null);
            if (e is not null && e.get_Parameter(BuiltInParameter.RBS_DUCT_FITTING_LOSS_METHOD_SERVER_PARAM)?.AsString() == Id.ToString()) return e;
        }
        return null;
    }

    /// <summary>The family's own coefficient; missing, unset, non-finite or the family's -1 ("unpriced") read 0.</summary>
    private static double Own(Element e, string parameter) {
        var p = e.LookupParameter(parameter);
        if (p is not { HasValue: true, StorageType: StorageType.Double }) return 0;
        var c = p.AsDouble();
        return c > 0 && !double.IsNaN(c) && !double.IsInfinity(c) ? c : 0;
    }

    private static T? Try<T>(Func<T?> read) {
        try {
            return read();
        } catch (Autodesk.Revit.Exceptions.ApplicationException) {
            return default;
        }
    }
}
