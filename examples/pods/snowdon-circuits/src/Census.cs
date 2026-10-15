public sealed class Census : PeScriptContainer
{
    public override void Execute()
    {
        if (doc == null) { Result(new { error = "No active document." }); return; }
        var circuits = Probe.Circuits(doc).ToList();
        var rows = new List<object>();
        foreach (var circuit in circuits.Take(Probe.MaxCircuits))
        {
            ThrowIfCancelled();
            rows.Add(Probe.Read(circuit));
        }
        Result(new { v = 1, document = doc.Title, revitVersion, total = circuits.Count, listed = rows.Count, copyOnly = Probe.IsCopy(doc), rows });
    }
}
