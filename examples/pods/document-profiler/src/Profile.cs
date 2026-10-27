public sealed class Profile : PeScriptContainer
{
    public override void Execute()
    {
        if (doc == null) { Result(new { refused = "No active document." }); return; }
        Profiler.Validate();
        var budget = new ProfilerBudget(ct);
        var provenance = Profiler.Provenance(doc);
        var memoryBefore = Profiler.Memory();
        var diagnostics = new List<string>();
        var elements = new List<ProfilerElement>();
        var samples = new List<ProfilerSample>();
        var strata = new List<object>();
        var ownership = new ProfilerViewOwnership();
        var capped = false;
        var censusComplete = false;
        string status = "completed";
        try {
            Profiler.ViewOwnership(doc, budget, ownership);
            Profiler.Strata(doc, budget, strata);
            Profiler.Census(doc, budget, elements, out capped);
            censusComplete = !capped;
            Profiler.Measure(doc, Profiler.Anchors(elements), budget, samples);
            if (capped || !ownership.Complete) status = "partial-census";
        } catch (TimeoutException e) { status = "budget-exhausted"; diagnostics.Add(e.Message); }
        catch (System.OperationCanceledException e) { status = "cancelled"; diagnostics.Add(e.Message); }
        var memberArtifacts = new List<string>();
        for (var offset = 0; offset < elements.Count; offset += 2000)
            memberArtifacts.Add(Artifacts.WriteJson("census-" + offset + ".json", elements.Skip(offset).Take(2000).ToArray()).RelativePath);
        var artifact = Artifacts.WriteJson("profile.json", new {
            schemaVersion = 1, status, provenance, limits = Profiler.Limits, diagnostics,
            budgetSeconds = ProfilerSettings.BudgetSeconds, maxElements = ProfilerSettings.MaxElements,
            maxScanIds = ProfilerSettings.MaxScanIds,
            viewOwnership = new { scope = "all non-type view-owned host elements, native inverted invalid-owner quick filter",
                maxElements = ProfilerSettings.MaxViewOwnedElements, totalMatchingElements = ownership.TotalViewOwnedElements,
                visitedElements = ownership.VisitedElements, capped = ownership.Capped, complete = ownership.Complete,
                unvisitedElements = ownership.TotalViewOwnedElements - ownership.VisitedElements,
                observedOwnerViews = ownership.Views.Count, listedOwnerViews = Math.Min(5000, ownership.Views.Count),
                viewRowsCapped = ownership.Views.Count > 5000,
                ordering = "Observed owned count descending, scenario selection inventory only; no measured cost or navigation benefit.",
                views = ownership.Views.Values.OrderByDescending(v => v.OwnedCount).ThenBy(v => v.Id).Take(5000).ToArray() },
            census = new { scope = "bounded non-type host elements", visited = elements.Count, capped,
                complete = censusComplete, memberArtifacts },
            strata,
            hypotheses = elements.GroupBy(e => new { e.CategoryId, e.Category, e.Family, e.Kind }).Select(g => new {
                group = g.Key, observedCount = g.Count(), sampleUniqueIds = g.Take(8).Select(e => e.UniqueId).ToArray(),
                interpretation = "Inventory only; no measured deletion benefit. Membership may be partial."
            }).ToArray(),
            survivorUniqueIds = Profiler.Anchors(elements),
            fixedAcrossRuns = ProfilerSettings.SurvivorUniqueIds.Length > 0,
            viewUniqueIds = ProfilerSettings.ViewUniqueIds, samples, summaries = Profiler.Summaries(samples),
            memoryBefore, memoryAfter = Profiler.Memory()
        });
        WriteLine("Inventory is a hypothesis list. Timings measure API workloads; view queries do not measure rendered UI. See profile.json.");
        Result(new { status, artifact = artifact.FullPath, visited = elements.Count, capped, diagnostics });
    }
}
