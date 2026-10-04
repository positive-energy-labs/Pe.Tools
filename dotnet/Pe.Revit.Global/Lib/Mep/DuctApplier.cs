using Autodesk.Revit.DB.ExtensibleStorage;
using Autodesk.Revit.DB.ExternalService;
using Autodesk.Revit.DB.Mechanical;
using Pe.Revit.Failures;
using Pe.Revit.Tasks;
using Pe.Shared.RevitData.Ducts;
using Serilog;
using System.Globalization;

namespace Pe.Revit.Global.Lib.Mep;

/// <summary>
///     The Revit half of `ducts.apply`. Plans every write first (preview stops there, no transaction), then follows the
///     SA 26 recipe (pressure-drop ledger): the engine switch, every targeted fitting and accessory to Not Defined and
///     committed, then each one's server entity (Revit's own, required by Revit) and its server, terminal connector
///     drops, fan static and Pe's store, committed. The two commits sit in one TransactionGroup: a failed stage rolls
///     the whole apply back and names itself, a clean apply is one undo step.
/// </summary>
public static class DuctApplier {
    private static readonly Guid NotDefined = new("76eff5da-2e71-45f7-b940-cc5716328ba0");
    private static readonly Guid SpecificCoefficient = new("5a598293-1504-46cc-a9c0-de55c82848b9");
    private static readonly Guid SpecificLoss = new("46245996-eebb-4536-ac17-9c1cd917d8cf");

    // The entity fields of Revit's servers (campaign s6_schemas, V2 e1_elbowpd). PressureLoss is internal units.
    private const string CoefficientField = "Coefficient";
    private const string PressureLossField = "PressureLoss";

    internal static readonly ProjectInfoText StoreText = new(
        new Guid("91e80aa7-f842-43ac-adbe-9b1f6a40c2d2"),
        "_PE_DuctLosses",
        "Versioned Pe.Tools duct loss provenance (ducts.apply).");

    private static readonly ForgeTypeId InWg = UnitTypeId.InchesOfWater60DegreesFahrenheit;

    public static (DuctLossStore? Store, string? Error) ReadStore(Document doc) {
        if (StoreText.Read(doc) is not { } json) return (null, null);
        try {
            return (DuctLossStore.FromJson(json), null);
        } catch (InvalidOperationException ex) {
            return (null, ex.Message);
        }
    }

    /// <summary>One planned target. Write runs inside the stage's transaction and returns the After text.</summary>
    private sealed record Item(long? Id, string Kind, string? Before) {
        public string Outcome { get; set; } = "planned";
        public string? Reason { get; set; }
        public string? After { get; set; }
        public Func<string>? Write { get; set; }
        public Element? Element { get; init; }
        /// <summary>Fittings and accessories: the server to set after the Not Defined commit, and its entity value.</summary>
        public (Guid Server, Schema Schema, string Field, string Value)? Loss { get; init; }

        public Item Refuse(string reason) {
            this.Outcome = "refused";
            this.Reason = reason;
            return this;
        }

        public Item Unchanged(string after) {
            this.Outcome = "unchanged";
            this.After = after;
            return this;
        }
    }

    public static DuctApplyResult Apply(Document doc, DuctApplyRequest request) {
        var slots = (request.Slots ?? request.Store.Slots ?? new DuctParameterSlots()).WithDefaults();
        var schemas = new Dictionary<Guid, Schema?> {
            [SpecificCoefficient] = Schema(SpecificCoefficient),
            [SpecificLoss] = Schema(SpecificLoss)
        };
        var items = new List<Item>();
        var seen = new HashSet<(string, long)>();
        Item? Duplicate(string kind, long id) => seen.Add((kind, id)) ? null : new Item(id, kind, null).Refuse("the request names this id twice");

        if (request.NetworkBasedCalculations is { } engine) items.Add(Engine(doc, engine));
        foreach (var w in request.Fittings ?? [])
            items.Add(Duplicate("fitting", w.Id) ?? Lossy(doc, w.Id, "fitting", BuiltInCategory.OST_DuctFitting, SpecificCoefficient, schemas, CoefficientField,
                Finite(w.Coefficient) ? w.Coefficient.ToString("R", CultureInfo.InvariantCulture) : null, w.Coefficient, $"specific-coefficient {w.Coefficient:0.####}"));
        foreach (var w in request.Components ?? [])
            items.Add(Duplicate("component", w.Id) ?? Lossy(doc, w.Id, "component", BuiltInCategory.OST_DuctAccessory, SpecificLoss, schemas, PressureLossField,
                Finite(w.InWg) ? UnitUtils.ConvertToInternalUnits(w.InWg, InWg).ToString("R", CultureInfo.InvariantCulture) : null, w.InWg, $"specific-loss {w.InWg:0.####} in-wg"));
        foreach (var w in request.Terminals ?? []) items.Add(Duplicate("terminal", w.Id) ?? Terminal(doc, w, slots));
        foreach (var w in request.Equipment ?? []) items.Add(Duplicate("equipment", w.Id) ?? Equipment(doc, w, slots));

        var (stored, storeError) = ReadStore(doc);
        var storeRevision = stored?.WorkRevision ?? 0;
        var store = new Item(null, "store", stored is null ? storeError is null ? "absent" : "unreadable" : $"revision {storeRevision}");
        if (storeError is not null) store.Refuse($"the model's {StoreText.Name} is unreadable ({storeError}); refusing to overwrite it");
        else if (request.Store.WorkRevision < storeRevision)
            store.Refuse($"stale: the model holds store revision {storeRevision}, the request carries {request.Store.WorkRevision}; re-read ducts.snapshot");
        items.Add(store);

        if (request.PreviewOnly || items.All(i => i.Outcome != "planned"))
            return Result(request.PreviewOnly, items, null, storeRevision);
        if (store.Outcome == "refused") {
            foreach (var i in items.Where(i => i.Outcome == "planned")) i.Refuse($"not written: the store was refused ({store.Reason})");
            return Result(false, items, null, storeRevision);
        }

        var now = DateTimeOffset.UtcNow;
        var next = Compose(request, stored, items, now, slots, storeRevision + 1);
        if (stored is not null && Content(stored) == Content(next) && items.All(i => i.Outcome != "planned" || ReferenceEquals(i, store))) {
            store.Unchanged($"revision {storeRevision}");
            return Result(false, items, null, storeRevision);
        }
        store.Write = () => {
            // Composed at write time: terminals and equipment ran first in this stage, so a refused write is not recorded.
            next = Compose(request, stored, items, now, slots, storeRevision + 1);
            StoreText.Write(doc, next.ToJson());
            return $"revision {next.WorkRevision}";
        };

        var failed = Execute(doc, items);
        if (failed is not null) {
            foreach (var i in items.Where(i => i.Outcome == "planned"))
                i.Refuse($"not written: stage {failed} failed and the whole apply rolled back");
            return Result(false, items, null, storeRevision);
        }

        foreach (var i in items.Where(i => i.Outcome == "written" && i.Element is { IsValidObject: true } && i.Loss is not null))
            i.After += $"; Revit drop {Pressure(i.Element!.get_Parameter(BuiltInParameter.RBS_PRESSURE_DROP)):0.#####} in-wg";
        var systems = items.Where(i => i.Outcome == "written" && i.Element is { IsValidObject: true })
            .SelectMany(i => DuctSnapshots.HvacConnectors(i.Element!))
            .Select(c => Try(() => c.MEPSystem as MechanicalSystem))
            .OfType<MechanicalSystem>()
            .GroupBy(m => m.Id.Value()).Select(g => g.First())
            .OrderBy(m => m.Name, StringComparer.Ordinal)
            .Select(DuctSnapshots.RevitSystem)
            .ToList();
        return Result(false, items, systems, store.Outcome == "written" ? next.WorkRevision : storeRevision);
    }

    /// <summary>Runs the stages in one group; returns the failed stage's name, or null when all committed.</summary>
    private static string? Execute(Document doc, List<Item> items) {
        var planned = items.Where(i => i.Outcome == "planned").ToList();
        var lossy = planned.Where(i => i.Loss is not null).ToList();
        var stages = new List<(string Name, Action Run)>();
        if (planned.FirstOrDefault(i => i.Kind == "engine") is { } engine)
            stages.Add(("engine", () => Write(engine)));
        if (lossy.Count > 0)
            stages.Add(("not-defined", () => {
                foreach (var i in lossy)
                    _ = i.Element!.get_Parameter(BuiltInParameter.RBS_DUCT_FITTING_LOSS_METHOD_SERVER_PARAM).Set(NotDefined.ToString());
            }));
        stages.Add(("losses", () => {
            // Terminals, equipment and the store first: a terminal's SubTransaction rollback after the server change
            // discards Revit's recalculation and the fittings commit with a 0 drop (W3, Project A).
            foreach (var i in planned.Where(i => i.Loss is null && i.Kind != "engine")) Write(i);
            foreach (var i in lossy) {
                var (server, schema, field, value) = i.Loss!.Value;
                var entity = new Entity(schema);
                entity.Set(field, value);
                i.Element!.SetEntity(entity);
                _ = i.Element.get_Parameter(BuiltInParameter.RBS_DUCT_FITTING_LOSS_METHOD_SERVER_PARAM).Set(server.ToString());
                i.Outcome = "written";
            }
        }));

        using var group = new TransactionGroup(doc, "Pe Apply Duct Losses");
        _ = group.Start();
        foreach (var (name, run) in stages) {
            var diagnostics = new List<(bool IsError, string Message)>();
            try {
                using var sandbox = DocumentSandbox.BeginCommit(doc, $"Pe Duct Losses ({name})");
                var options = sandbox.Transaction.GetFailureHandlingOptions();
                _ = options.SetFailuresPreprocessor(new DelegatingFailuresPreprocessor(a => PeToolsFailureHandling.RejectErrors(a, diagnostics)));
                _ = options.SetClearAfterRollback(true);
                _ = options.SetForcedModalHandling(false);
                sandbox.Transaction.SetFailureHandlingOptions(options);
                run();
                sandbox.Complete();
            } catch (Exception ex) when (DuctSnapshots.IsRevitFailure(ex) || ex is ArgumentException) {
                Log.Error(ex, "ducts.apply stage {Stage} failed", name);
                try {
                    _ = group.RollBack();
                } catch (Exception rollback) {
                    // Dispose of an unassimilated group rolls back too; the stage failure is the answer.
                    Log.Error(rollback, "ducts.apply group rollback after stage {Stage}", name);
                }
                foreach (var i in items.Where(i => i.Outcome == "written")) i.Outcome = "planned";
                var detail = string.Join("; ", diagnostics.Where(d => d.IsError).Select(d => d.Message));
                return detail.Length > 0 ? $"{name} ({ex.Message}: {detail})" : $"{name} ({ex.Message})";
            }
        }
        _ = group.Assimilate();
        return null;
    }

    private static void Write(Item i) {
        try {
            i.After = i.Write!();
            i.Outcome = "written";
        } catch (Exception ex) when (DuctSnapshots.IsRevitFailure(ex) || ex is ArgumentException) {
            if (i.Kind == "store") throw;
            i.Refuse($"Revit refused: {ex.Message}");
        }
    }

    private static Item Engine(Document doc, bool want) {
        var settings = DuctSettings.GetDuctSettings(doc);
        var item = new Item(settings.Id.Value(), "engine", Engine(settings.NetworkBasedCalculations)) {
            Write = () => {
                settings.NetworkBasedCalculations = want;
                return Engine(want);
            }
        };
        return settings.NetworkBasedCalculations == want ? item.Unchanged(Engine(want)) : item;
    }

    private static string Engine(bool network) => network ? "network-based calculations" : "legacy calculations";

    private static Item Lossy(Document doc, long id, string kind, BuiltInCategory category, Guid server,
        Dictionary<Guid, Schema?> schemas, string field, string? value, double number, string after) {
        var e = doc.GetElement(id.ToElementId());
        if (e is null) return new Item(id, kind, null).Refuse($"element {id} is not in the document");
        var method = e.get_Parameter(BuiltInParameter.RBS_DUCT_FITTING_LOSS_METHOD_SERVER_PARAM);
        var current = method?.AsString();
        // The element's own server's entity, read through that schema's own field (it may differ from the target's).
        var existing = Guid.TryParse(current, out var g) && schemas.TryGetValue(g, out var s) && s is not null
                       && s.ListFields().FirstOrDefault(f => f.ValueType == typeof(string)) is { } own
                       && e.GetEntity(s) is { } en && en.IsValid() ? en.Get<string>(own) : null;
        var item = new Item(id, kind, $"{Name(current)}{(existing is { Length: > 0 } ? " " + existing : "")}") { Element = e };
        if (e.Category.ToBuiltInCategory() != category)
            return item.Refuse($"not a {(category == BuiltInCategory.OST_DuctFitting ? "duct fitting" : "duct accessory")} ({e.Category?.Name ?? "no category"})");
        if (method is null || method.IsReadOnly) return item.Refuse("the element has no writable loss method server parameter");
        if (value is null || number < 0) return item.Refuse("the value must be a finite number of 0 or more");
        if (schemas[server] is not { } schema) return item.Refuse($"Revit's {Name(server.ToString())} server has no data schema");
        if (schema.GetField(field) is null)
            return item.Refuse($"Revit's {Name(server.ToString())} schema has no field {field} (fields: {string.Join(", ", schema.ListFields().Select(f => f.FieldName))})");
        if (g == server && existing is not null && double.TryParse(existing, NumberStyles.Float, CultureInfo.InvariantCulture, out var had)
            && Math.Abs(had - double.Parse(value, CultureInfo.InvariantCulture)) <= 1e-9 * Math.Max(1, Math.Abs(had)))
            return item.Unchanged(after);
        return item with { Loss = (server, schema, field, value), After = after };
    }

    /// <summary>
    ///     Two routes, both proven on Project A (pressure-drop ledger, W3): the connector setter, which Revit refuses on
    ///     every family connector it does not own, and the instance parameter the family binds to its connector drop
    ///     (the SA 26 recipe), named by the TerminalDrop slot. The slot route runs in a SubTransaction and keeps the
    ///     write only when the connector reads the new drop after regeneration.
    /// </summary>
    private static Item Terminal(Document doc, DuctDropWrite w, DuctParameterSlots slots) {
        var e = doc.GetElement(w.Id.ToElementId());
        if (e is null) return new Item(w.Id, "terminal", null).Refuse($"element {w.Id} is not in the document");
        var c = DuctSnapshots.HvacConnectors(e).FirstOrDefault();
        var method = c is null ? null : Try(() => (DuctLossMethodType?)c.AssignedDuctLossMethod);
        // Re-fetched on every read: a Regenerate invalidates the Connector wrapper (W3, InvalidObjectExceptionProxy).
        double? Read() => Try(() => DuctSnapshots.HvacConnectors(e).FirstOrDefault() is { } live
            ? (double?)UnitUtils.ConvertFromInternalUnits(live.AssignedPressureDrop, InWg)
            : null);
        var had = Read();
        var item = new Item(w.Id, "terminal", c is null ? null : $"{method} {had:0.#####} in-wg") { Element = e };
        if (e.Category.ToBuiltInCategory() != BuiltInCategory.OST_DuctTerminal) return item.Refuse($"not an air terminal ({e.Category?.Name ?? "no category"})");
        if (c is null) return item.Refuse("the terminal has no HVAC connector");
        if (method != DuctLossMethodType.SpecificLoss)
            return item.Refuse($"the connector's loss method is {method}; Revit takes a drop only when the family connector is Specific Loss");
        if (!Finite(w.InWg) || w.InWg < 0) return item.Refuse("the drop must be a finite number of 0 or more");
        if (had is { } h && Math.Abs(h - w.InWg) < 1e-6) return item.Unchanged($"{w.InWg:0.#####} in-wg");
        var bound = slots.TerminalDrop is { } name ? e.LookupParameter(name) : null;
        if (slots.TerminalDrop is { } named && (bound is null || bound.IsReadOnly || bound.StorageType != StorageType.Double))
            return item.Refuse($"the instance has no writable number parameter '{named}' (the TerminalDrop slot)");
        var value = UnitUtils.ConvertToInternalUnits(w.InWg, InWg);
        return item with {
            Write = () => {
                if (bound is null) {
                    try {
                        c.AssignedPressureDrop = value;
                    } catch (Exception ex) when (DuctSnapshots.IsRevitFailure(ex)) {
                        throw new InvalidOperationException(
                            "Revit refused the connector drop: the family binds it to a parameter; name that instance parameter as the TerminalDrop slot");
                    }
                    return $"connector {Read():0.#####} in-wg";
                }
                using var sub = new SubTransaction(doc);
                _ = sub.Start();
                _ = bound.Set(value);
                doc.Regenerate();
                if (Read() is { } read && Math.Abs(read - w.InWg) < 1e-6) {
                    _ = sub.Commit();
                    return $"'{bound.Definition.Name}' {read:0.#####} in-wg; connector reads it";
                }
                _ = sub.RollBack();
                throw new InvalidOperationException($"'{bound.Definition.Name}' is not bound to the connector drop (the connector still reads {Read():0.#####} in-wg); nothing kept");
            }
        };
    }

    private static Item Equipment(Document doc, DuctEquipmentWrite w, DuctParameterSlots slots) {
        var e = doc.GetElement(w.Id.ToElementId());
        if (e is null) return new Item(w.Id, "equipment", null).Refuse($"element {w.Id} is not in the document");
        var own = e.LookupParameter(slots.FanStatic);
        var (p, where) = own is not null ? (own, "instance") : ((e as FamilyInstance)?.Symbol?.LookupParameter(slots.FanStatic), "type");
        var item = new Item(w.Id, "equipment", p is { HasValue: true, StorageType: StorageType.Double } ? $"{where} {Pressure(p):0.####} in-wg" : null) { Element = e };
        if (e.Category.ToBuiltInCategory() != BuiltInCategory.OST_MechanicalEquipment) return item.Refuse($"not mechanical equipment ({e.Category?.Name ?? "no category"})");
        if (p is null) return item.Refuse($"neither the instance nor its type has '{slots.FanStatic}'");
        if (p.StorageType != StorageType.Double || p.Definition.GetDataType() != SpecTypeId.HvacPressure)
            return item.Refuse($"'{slots.FanStatic}' on the {where} is not an HVAC pressure parameter");
        if (p.IsReadOnly) return item.Refuse($"'{slots.FanStatic}' on the {where} is read-only (a formula, a reporting parameter or a built-in drives it)");
        if (!Finite(w.ExternalStaticInWg) || w.ExternalStaticInWg < 0) return item.Refuse("the static must be a finite number of 0 or more");
        var after = $"{where} '{slots.FanStatic}' {w.ExternalStaticInWg:0.####} in-wg";
        if (p.HasValue && Math.Abs(Pressure(p) - w.ExternalStaticInWg) < 1e-6) return item.Unchanged(after);
        return item with {
            // Re-resolved: a Regenerate earlier in the stage can invalidate the planned Parameter wrapper.
            Write = () => (where == "instance" ? e.LookupParameter(slots.FanStatic) : (e as FamilyInstance)?.Symbol?.LookupParameter(slots.FanStatic))
                ?.Set(UnitUtils.ConvertToInternalUnits(w.ExternalStaticInWg, InWg)) == true
                ? after
                : throw new InvalidOperationException($"Revit rejected '{slots.FanStatic}' on the {where}")
        };
    }

    private static DuctLossStore Compose(DuctApplyRequest request, DuctLossStore? stored, List<Item> items, DateTimeOffset now,
        DuctParameterSlots slots, int revision) {
        var asked = request.Store;
        var rules = new Dictionary<string, DuctRuleChoice>(asked.Rules ?? new(), StringComparer.Ordinal);
        var instances = new Dictionary<long, DuctInstanceRecord>(asked.Instances ?? new());
        var drops = new Dictionary<long, DuctDropRecord>(asked.Terminals ?? new());
        bool Lands(string kind, long id) => items.Any(i => i.Kind == kind && i.Id == id && i.Outcome is "planned" or "unchanged" or "written");
        foreach (var w in (request.Fittings ?? []).Where(w => Lands("fitting", w.Id))) {
            instances[w.Id] = new DuctInstanceRecord(w.Table, w.Inputs, w.Coefficient, now);
            if (w.RuleKey is { Length: > 0 } key && !rules.ContainsKey(key)) rules[key] = new DuctRuleChoice(w.Table);
        }
        foreach (var w in (request.Terminals ?? []).Where(w => Lands("terminal", w.Id))) drops[w.Id] = new DuctDropRecord(w.InWg, w.Source, now);
        foreach (var w in (request.Components ?? []).Where(w => Lands("component", w.Id))) drops[w.Id] = new DuctDropRecord(w.InWg, w.Source, now);
        var unknown = new Dictionary<string, Newtonsoft.Json.Linq.JToken>(stored?.Unknown ?? new Dictionary<string, Newtonsoft.Json.Linq.JToken>());
        foreach (var kv in asked.Unknown ?? new Dictionary<string, Newtonsoft.Json.Linq.JToken>()) unknown[kv.Key] = kv.Value;
        return new DuctLossStore {
            Version = DuctLossStore.CurrentVersion, Rules = rules, Instances = instances, Terminals = drops, Slots = slots, WorkRevision = revision, AppliedAt = now, Unknown = unknown
        };
    }

    private static string Content(DuctLossStore s) => (s with {
        WorkRevision = 0,
        AppliedAt = null,
        Instances = s.Instances.ToDictionary(kv => kv.Key, kv => kv.Value with { AppliedAt = default }),
        Terminals = s.Terminals.ToDictionary(kv => kv.Key, kv => kv.Value with { AppliedAt = default })
    }).ToJson();

    private static DuctApplyResult Result(bool preview, List<Item> items, IReadOnlyList<DuctSystem>? systems, int revision) => new(
        preview,
        items.Select(i => new DuctWrite(i.Id, i.Kind, i.Outcome, i.Reason, i.Before, i.Outcome == "refused" ? null : i.After)).ToList(),
        new DuctApplyCounts(
            items.Count(i => i.Outcome == "planned"),
            items.Count(i => i.Outcome == "written"),
            items.Count(i => i.Outcome == "refused"),
            items.Count(i => i.Outcome == "unchanged")),
        systems,
        revision);

    private static Schema? Schema(Guid server) => Try(() =>
        (ExternalServiceRegistry.GetService(ExternalServices.BuiltInExternalServices.DuctFittingAndAccessoryPressureDropService)
            ?.GetServer(server) as IDuctFittingAndAccessoryPressureDropServer)?.GetDataSchema());

    private static string Name(string? server) => Guid.TryParse(server, out var g)
        ? g == NotDefined ? "not-defined"
        : g == SpecificCoefficient ? "specific-coefficient"
        : g == SpecificLoss ? "specific-loss"
        : g == new Guid("8baf7d75-8b9b-46d0-b8ce-3ad1c19e6b19") ? "ashrae-table"
        : server!
        : "no server";

    // + 0.0 turns -0 into 0 for display.
    private static double Pressure(Parameter? p) => p is { StorageType: StorageType.Double } ? Math.Round(UnitUtils.ConvertFromInternalUnits(p.AsDouble(), InWg), 6) + 0.0 : 0;
    private static bool Finite(double v) => !double.IsNaN(v) && !double.IsInfinity(v);

    private static T? Try<T>(Func<T?> read) {
        try {
            return read();
        } catch (Exception ex) when (DuctSnapshots.IsRevitFailure(ex)) {
            return default;
        }
    }
}
