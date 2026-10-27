public sealed class SaveVariant : PeScriptContainer
{
    public override void Execute()
    {
        if (doc == null) { Result(new { refused = "No active document." }); return; }
        try {
            Interventions.Guard(doc);
            if (ProfilerSettings.Candidates.Length != 1 || string.IsNullOrWhiteSpace(ProfilerSettings.VariantPath) ||
                !Path.IsPathRooted(ProfilerSettings.VariantPath) ||
                !string.Equals(Path.GetExtension(ProfilerSettings.VariantPath), ".rvt", StringComparison.OrdinalIgnoreCase) ||
                File.Exists(ProfilerSettings.VariantPath) || Interventions.SamePath(ProfilerSettings.VariantPath, doc.PathName) ||
                Interventions.SamePath(ProfilerSettings.VariantPath, ProfilerSettings.OriginalPath))
                throw new ArgumentException("Exactly one candidate and a NEW distinct .rvt VariantPath are required.");
        } catch (ArgumentException e) { Result(new { refused = e.Message }); return; }
        var budget = new ProfilerBudget(ct);
        var provenance = Profiler.Provenance(doc);
        var candidate = ProfilerSettings.Candidates[0];
        var roots = Interventions.Roots(doc, candidate);
        var closure = Interventions.Preview(doc, roots, budget);
        var closureParts = ClosureReceipts.Write(Artifacts, "variant-closure-part", closure, budget, 0);
        // Checkpoint intent before a permanent effect. External SDK custody owns reopening a fresh seed for each variant.
        Artifacts.WriteJson("variant-plan.json", new { provenance, candidate, closureCount = closure.Count,
            maxClosureElements = ProfilerSettings.MaxClosureElements, closureParts, destination = ProfilerSettings.VariantPath, limits = Profiler.Limits });
        using (var t = new Transaction(doc, "Profiler save variant")) {
            if (t.Start() != TransactionStatus.Started) throw new InvalidOperationException("Transaction did not start.");
            var deleted = doc.Delete(roots).Select(id => id.Value).OrderBy(id => id).ToArray();
            if (!deleted.SequenceEqual(closure.Select(e => e.Id).OrderBy(id => id)))
                throw new InvalidOperationException("Deletion closure changed; refusing commit.");
            budget.Check();
            if (t.Commit() != TransactionStatus.Committed) throw new InvalidOperationException("Deletion did not commit.");
        }
        // SaveAs after transaction closes. A save failure leaves only the explicitly acknowledged copy modified.
        using (var options = new SaveAsOptions { OverwriteExistingFile = false }) {
            if (doc.IsWorkshared) {
                // A detached copy retains its worksets and becomes a new central at the distinct destination.
                using (var worksharing = new WorksharingSaveAsOptions { SaveAsCentral = true }) {
                    options.SetWorksharingOptions(worksharing);
                    doc.SaveAs(ProfilerSettings.VariantPath, options);
                }
            } else doc.SaveAs(ProfilerSettings.VariantPath, options);
        }
        var absent = closure.Where(e => doc.GetElement(e.UniqueId) != null).Select(e => e.UniqueId).ToArray();
        var missingSurvivors = ProfilerSettings.SurvivorUniqueIds.Concat(ProfilerSettings.ViewUniqueIds).Where(uid => doc.GetElement(uid) == null).ToArray();
        var artifact = Artifacts.WriteJson("variant.json", new { provenance, saved = Profiler.Provenance(doc), candidate,
            closureCount = closure.Count, closureParts, deletionReadbackPassed = absent.Length == 0, unexpectedlyPresent = absent, missingSurvivors,
            fileBytes = new FileInfo(doc.PathName).Length, memoryBenefit = "unmeasured; orchestrate repeated matched fresh-process baseline/variant runs externally" });
        Result(new { status = absent.Length == 0 && missingSurvivors.Length == 0 ? "saved" : "readback-failed", artifact = artifact.FullPath, path = doc.PathName });
    }
}
