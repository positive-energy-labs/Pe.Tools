public static class ClosureReceipts
{
    // Keep full metadata once. Reserve room for trial checkpoints, the plan and final report.
    public static List<object> Write(Pe.Revit.Scripting.Storage.ScriptArtifactWriter artifacts,
        string prefix, List<ProfilerElement> closure, ProfilerBudget budget, int repeatedIdReceipts)
    {
        var chunks = new List<string>();
        for (var offset = 0; offset < closure.Count; offset += 2000) {
            budget.Check();
            var json = Newtonsoft.Json.JsonConvert.SerializeObject(closure.Skip(offset).Take(2000).ToArray(), Newtonsoft.Json.Formatting.Indented);
            if (Encoding.UTF8.GetByteCount(json) > 8 * 1024 * 1024)
                throw new InvalidOperationException("Closure metadata chunk exceeds the 8 MiB receipt bound; no permanent deletion was made.");
            chunks.Add(json);
        }
        var usedBytes = artifacts.Artifacts.Sum(a => a.SizeBytes);
        var reservedBytes = 2L * 1024 * 1024 + (long)closure.Count * 32 * repeatedIdReceipts;
        if (artifacts.Artifacts.Count + chunks.Count + 10 > 100 ||
            usedBytes + chunks.Sum(json => (long)Encoding.UTF8.GetByteCount(json)) + reservedBytes > 50L * 1024 * 1024)
            throw new InvalidOperationException("Full closure receipts exceed the run's artifact budget; split candidates across runs. No permanent deletion was made.");
        var parts = new List<object>();
        for (var i = 0; i < chunks.Count; i++) {
            budget.Check();
            var artifact = artifacts.WriteText(prefix + "-" + i + ".json", chunks[i], "application/json");
            parts.Add(new { path = artifact.RelativePath, offset = i * 2000, count = Math.Min(2000, closure.Count - i * 2000), bytes = artifact.SizeBytes });
        }
        return parts;
    }
}
