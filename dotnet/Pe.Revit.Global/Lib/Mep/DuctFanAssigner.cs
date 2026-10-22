using Autodesk.Revit.DB.Mechanical;
using Pe.Revit.Failures;
using Pe.Revit.Tasks;
using Pe.Shared.RevitData.Ducts;
using Serilog;

namespace Pe.Revit.Global.Lib.Mep;

/// <summary>
///     The Revit half of `ducts.assign-fan`: Revit's Duct Systems > Select Equipment (no postable command does it).
///     The spike (`.artifacts/runs/close-ducts-v1/assignfan/`) PROVED the one write that keeps the system's id, name,
///     type and parameters: take the unit's connector out of the members, then set
///     <see cref="MechanicalSystem.BaseEquipmentConnector" />; setting it while the connector is a member is FALSIFIED
///     ("base connector has been used"), and so is NewMechanicalSystem over used connectors. Revit checks neither
///     connectivity nor classification, so the guards here do, and the read back is ours.
/// </summary>
public static class DuctFanAssigner {
    private sealed class Refused(string message) : Exception(message);

    public static DuctAssignFanResult Assign(Document doc, DuctAssignFanRequest request) {
        var system = doc.GetElement(request.SystemId.ToElementId()) as MechanicalSystem;
        var before = system is null ? null : DuctSnapshots.RevitSystem(system);
        DuctAssignFanResult Refuse(string reason, int? connector = null) =>
            new(request.PreviewOnly, request.SystemId, request.UnitId, "refused", reason, connector, null, before, null);
        if (system is null) return Refuse($"element {request.SystemId} is not a duct system");
        Connector port;
        try {
            port = Port(doc, system, request.UnitId);
        } catch (Refused r) {
            return Refuse(r.Message);
        }

        var diagnostics = new List<(bool IsError, string Message)>();
        var preview = request.PreviewOnly;
        using var all = preview ? new TransactionGroup(doc, DocumentSandbox.TransactionNamePrefix + "Pe Assign Fan (preview)") : null;
        _ = all?.Start();
        try {
            string check;
            DuctSystem after;
            using (var sandbox = DocumentSandbox.BeginCommit(doc, (preview ? DocumentSandbox.TransactionNamePrefix : "") + $"Pe Assign Fan ({system.Name})")) {
                var options = sandbox.Transaction.GetFailureHandlingOptions();
                _ = options.SetFailuresPreprocessor(new DelegatingFailuresPreprocessor(a => PeToolsFailureHandling.RejectErrors(a, diagnostics)));
                _ = options.SetClearAfterRollback(true);
                _ = options.SetForcedModalHandling(false);
                sandbox.Transaction.SetFailureHandlingOptions(options);
                check = Write(doc, system, port, out after);
                sandbox.Complete();
            }
            return new DuctAssignFanResult(preview, request.SystemId, request.UnitId, preview ? "planned" : "assigned", null, port.Id, check, before, after);
        } catch (Refused r) {
            return Refuse(r.Message, port.Id);
        } catch (Exception ex) when (DuctSnapshots.IsRevitFailure(ex) || ex is ArgumentException) {
            Log.Error(ex, "ducts.assign-fan {System} <- {Unit} failed", request.SystemId, request.UnitId);
            var detail = string.Join("; ", diagnostics.Where(d => d.IsError).Select(d => d.Message));
            return Refuse($"Revit refused and the write rolled back ({ex.Message}{(detail.Length > 0 ? ": " + detail : "")})", port.Id);
        } finally {
            _ = all?.RollBack();
        }
    }

    /// <summary>
    ///     The unit's one duct port that can be the system's base: same air classification as the system, and either
    ///     a member of it or joined to an element of it. The system must have no base equipment yet.
    /// </summary>
    private static Connector Port(Document doc, MechanicalSystem system, long unitId) {
        if (system.BaseEquipment is { } current)
            throw new Refused(current.Id.Value() == unitId
                ? $"{unitId} is already the base equipment of {system.Name}"
                : $"{system.Name} already has base equipment ({Label(current)}); a swap drops it from the system's members and Revit does not put it back, so changing it is a person's, in Revit (Duct Systems > Select Equipment)");
        var unit = doc.GetElement(unitId.ToElementId()) ?? throw new Refused($"element {unitId} is not in the document");
        if (unit is not FamilyInstance || unit.Category?.ToBuiltInCategory() != BuiltInCategory.OST_MechanicalEquipment)
            throw new Refused($"{Label(unit)} is {unit.Category?.Name ?? "no category"}, not mechanical equipment");
        var ports = DuctSnapshots.HvacConnectors(unit).Where(c => c.ConnectorType == ConnectorType.End).ToList();
        if (ports.Count == 0) throw new Refused($"{Label(unit)} has no duct connector");
        var sameClass = ports.Where(c => Try(() => (DuctSystemType?)c.DuctSystemType) == system.SystemType).ToList();
        if (sameClass.Count == 0)
            throw new Refused($"{Label(unit)} has no {Word(system.SystemType)} port (its ports are {string.Join(", ", ports.Select(c => Word(c.DuctSystemType)).Distinct())}); {system.Name} is {Word(system.SystemType)}");
        var members = sameClass.Where(c => SystemOf(c) == system.Id.Value()).ToList();
        var joined = sameClass.Where(c => SystemOf(c) is null && Partners(c).Any(p => SystemOf(p) == system.Id.Value())).ToList();
        var found = members.Count > 0 ? members : joined;
        if (found.Count == 1) return found[0];
        if (found.Count > 1)
            throw new Refused($"{Label(unit)} has {found.Count} {Word(system.SystemType)} ports in {system.Name}; which one is the base is a person's, in Revit");
        var elsewhere = sameClass.Select(c => Try(() => c.MEPSystem?.Name)).OfType<string>().Distinct().ToList();
        throw new Refused(elsewhere.Count > 0
            ? $"{Label(unit)}'s {Word(system.SystemType)} port is in {string.Join(", ", elsewhere)}, not {system.Name}; it is not connected to {system.Name}'s ducts"
            : $"{Label(unit)} is not connected to {system.Name}'s ducts");
    }

    /// <summary>Out of the members, then the base (the spike's ProbeD); read back: the base is the unit, nothing else moved.</summary>
    private static string Write(Document doc, MechanicalSystem system, Connector port, out DuctSystem after) {
        var (id, name, type, kind) = (system.Id, system.Name, system.GetTypeId(), system.SystemType);
        var unit = port.Owner.Id;
        if (SystemOf(port) == id.Value()) {
            var set = new ConnectorSet();
            set.Insert(port);
            system.Remove(set);
        }
        system.BaseEquipmentConnector = port;
        doc.Regenerate();
        var read = doc.GetElement(id) as MechanicalSystem ?? throw new Refused($"read back: system {id.Value()} is gone");
        var problems = new List<string>();
        if (read.BaseEquipment?.Id != unit)
            problems.Add($"the base equipment reads {(read.BaseEquipment is { } b ? Label(b) : "none")}, not {unit.Value()}");
        if (read.BaseEquipmentConnector?.Id != port.Id) problems.Add("the base connector is not the unit's port");
        if (read.Name != name) problems.Add($"the name changed from {name} to {read.Name}");
        if (read.GetTypeId() != type) problems.Add("the system type changed");
        if (read.SystemType != kind) problems.Add($"the classification changed from {Word(kind)} to {Word(read.SystemType)}");
        if (problems.Count > 0) throw new Refused("read back failed: " + string.Join("; ", problems));
        after = DuctSnapshots.RevitSystem(read);
        return $"{read.Name}: base equipment {Label(read.BaseEquipment!)} (connector {port.Id}), name, type and {Word(kind)} unchanged, {after.CriticalPathLossInWg?.ToString("0.###") ?? "no"} in-wg critical path";
    }

    private static IEnumerable<Connector> Partners(Connector c) =>
        c.IsConnected ? c.AllRefs.Cast<Connector>().Where(r => r.Owner.Id != c.Owner.Id) : [];

    private static long? SystemOf(Connector c) => Try(() => c.MEPSystem?.Id.Value());

    /// <summary>The firm tag (PE_G___TagInstance), else Mark, else the type name, with the id.</summary>
    private static string Label(Element e) {
        var tag = new[] { e.LookupParameter("PE_G___TagInstance"), e.get_Parameter(BuiltInParameter.ALL_MODEL_MARK) }
            .Select(p => p?.StorageType == StorageType.String ? p.AsString() : null)
            .FirstOrDefault(t => !string.IsNullOrWhiteSpace(t));
        return $"{tag ?? e.Name} ({e.Id.Value()})";
    }

    /// <summary>"SupplyAir" as a person says it: "Supply Air".</summary>
    private static string Word(DuctSystemType t) => System.Text.RegularExpressions.Regex.Replace(t.ToString(), "([a-z])([A-Z])", "$1 $2");

    private static T? Try<T>(Func<T?> read) {
        try {
            return read();
        } catch (Exception ex) when (DuctSnapshots.IsRevitFailure(ex)) {
            return default;
        }
    }
}
