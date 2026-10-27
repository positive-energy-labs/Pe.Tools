public sealed class DeletionExperiment : PeScriptContainer
{
    public override void Execute()
    {
        if (doc == null) { Result(new { refused = "No active document." }); return; }
        try { Interventions.Guard(doc); }
        catch (ArgumentException e) { Result(new { refused = e.Message }); return; }
        var budget = new ProfilerBudget(ct);
        var provenance = Profiler.Provenance(doc);
        var deltas = new List<ProfilerDelta>();
        var closures = new Dictionary<string, List<ProfilerElement>>();
        var diagnostics = new List<string>();
        var status = "completed";
        try {
            for (var c = 0; c < ProfilerSettings.Candidates.Length; c++) {
                var candidate = ProfilerSettings.Candidates[c];
                var roots = Interventions.Roots(doc, candidate);
                var closure = Interventions.Preview(doc, roots, budget);
                closures.Add(candidate.Name, closure);
                var closureParts = ClosureReceipts.Write(Artifacts, "candidate-" + c + "-closure-part", closure, budget, ProfilerSettings.Trials);
                Artifacts.WriteJson("candidate-" + c + "-closure.json", new { candidate, requested = roots.Select(id => id.Value).ToArray(),
                    count = closure.Count, maxClosureElements = ProfilerSettings.MaxClosureElements, closureParts });
                for (var trial = 0; trial < ProfilerSettings.Trials; trial++) {
                    var before = Profiler.Measure(doc, ProfilerSettings.SurvivorUniqueIds, budget);
                    ProfilerArm sham, treatment;
                    // Alternate order to expose order effects; record order with every checkpoint.
                    if (trial % 2 == 0) {
                        sham = Interventions.Arm(doc, null, closure, "sham", budget);
                        treatment = Interventions.Arm(doc, roots, closure, "delete", budget);
                    } else {
                        treatment = Interventions.Arm(doc, roots, closure, "delete", budget);
                        sham = Interventions.Arm(doc, null, closure, "sham", budget);
                    }
                    var after = Profiler.Measure(doc, ProfilerSettings.SurvivorUniqueIds, budget);
                    var comparison = Interventions.Compare(candidate.Name, trial, before, sham.Samples, treatment.Samples, after);
                    deltas.AddRange(comparison);
                    Artifacts.WriteJson("candidate-" + c + "-trial-" + trial + ".json", new {
                        candidate = candidate.Name, trial, order = trial % 2 == 0 ? "sham,delete" : "delete,sham",
                        before, sham, treatment, after, comparison
                    });
                }
            }
        } catch (Exception e) { status = "stopped"; diagnostics.Add(e.GetType().Name + ": " + e.Message); }
        var ranking = deltas.GroupBy(d => new { d.Candidate, d.Workload }).Select(g => new {
            candidate = g.Key.Candidate, workload = g.Key.Workload,
            eligible = g.Count() == ProfilerSettings.Trials && g.All(d => d.Eligible && d.ExceedsControlVariation) &&
                Profiler.Median(g.Select(d => d.BenefitMs.Value)) > ControlVariation(g),
            medianBenefitMs = g.Any(d => !d.BenefitMs.HasValue) ? (double?)null : Profiler.Median(g.Select(d => d.BenefitMs.Value)),
            repeatedControlVariationMs = g.Any(d => !d.Eligible) ? (double?)null : ControlVariation(g),
            trials = g.ToArray(), interpretation = "Provisional warm-session API effect; eligible requires every repeated benefit to exceed observed control drift. Overlapping closures are not additive."
        }).OrderBy(r => r.workload).ThenByDescending(r => r.eligible).ThenByDescending(r => r.medianBenefitMs).ToArray();
        var overlap = closures.SelectMany((a, i) => closures.Skip(i + 1).Select(b => new {
            a = a.Key, b = b.Key, sharedDeletionCount = a.Value.Select(e => e.Id).Intersect(b.Value.Select(e => e.Id)).Count(),
            sharedDeletionIdSample = a.Value.Select(e => e.Id).Intersect(b.Value.Select(e => e.Id)).Take(20).ToArray(),
            exactMembership = "Intersect the complete closure-part receipts; sample is not exhaustive."
        })).ToArray();
        var artifact = Artifacts.WriteJson("experiments.json", new { schemaVersion = 1, status, provenance,
            limits = Profiler.Limits, diagnostics, ranking, overlap, deltas,
            ramBenefit = "unmeasured; rollback cannot establish RAM savings", renderedResponsiveness = "unmeasured" });
        WriteLine("Provisional API rankings are workload-specific. Read control drift and exact closure receipts. RAM and rendered GUI remain unmeasured.");
        Result(new { status, artifact = artifact.FullPath, diagnostics, comparisons = deltas.Count });
    }

    private static double ControlVariation(IEnumerable<ProfilerDelta> deltas)
    {
        var controls = deltas.SelectMany(d => new[] { d.ArmMedianMs[0], d.ArmMedianMs[1], d.ArmMedianMs[3] }).ToArray();
        return controls.Max() - controls.Min();
    }
}
