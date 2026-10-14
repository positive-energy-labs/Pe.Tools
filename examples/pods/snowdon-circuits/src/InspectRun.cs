public sealed class InspectRun : PeScriptContainer
{
    public override void Execute()
    {
        if (doc == null) { Result(new { error = "No active document." }); return; }
        var ids = new HashSet<long>(selection.Select(id => id.Value));
        var rows = new List<object>();
        foreach (var circuit in Probe.Circuits(doc))
        {
            ThrowIfCancelled();
            if (!ids.Contains(circuit.Id.Value) && !circuit.Elements.Cast<Element>().Any(e => ids.Contains(e.Id.Value))) continue;
            rows.Add(Probe.Read(circuit));
            if (rows.Count >= Probe.MaxCircuits) break;
        }
        Result(new { v = 1, document = doc.Title, copyOnly = Probe.IsCopy(doc), rows, unavailable = rows.Count == 0 ? "Select a circuit or one of its connected loads in Revit." : null });
    }
}
