public sealed class ProfilerArm
{
    public string Arm;
    public double DeleteMs;
    public double RegenerateMs;
    public double CommitMs;
    public double RollbackMs;
    public long[] DeletedIds = new long[0];
    public List<ProfilerSample> Samples = new List<ProfilerSample>();
    public bool Restored;
}

public static class Interventions
{
    public static void Guard(Document d)
    {
        GuardCopy(d, ProfilerSettings.EnableExperiments);
        if (ProfilerSettings.SurvivorUniqueIds.Length == 0 || ProfilerSettings.Candidates.Length < 1 || ProfilerSettings.Candidates.Length > 8)
            throw new ArgumentException("Supply 1..8 candidates and an explicit fixed surviving UniqueId workload.");
        foreach (var uid in ProfilerSettings.SurvivorUniqueIds.Concat(ProfilerSettings.ViewUniqueIds))
            if (d.GetElement(uid) == null) throw new ArgumentException("Preserved workload anchor absent: " + uid);
    }

    public static void GuardCopy(Document d, bool enabled)
    {
        Profiler.Validate();
        if (!enabled || ProfilerSettings.CopyAcknowledgement != "I own this disposable copy; never use the original")
            throw new ArgumentException("Operation disabled. Explicit disposable-copy acknowledgement is required.");
        if (string.IsNullOrWhiteSpace(ProfilerSettings.ExpectedCopyPath) || string.IsNullOrWhiteSpace(ProfilerSettings.OriginalPath) ||
            !Path.IsPathRooted(ProfilerSettings.ExpectedCopyPath) || !Path.IsPathRooted(ProfilerSettings.OriginalPath) ||
            !SamePath(d.PathName, ProfilerSettings.ExpectedCopyPath) || SamePath(d.PathName, ProfilerSettings.OriginalPath))
            throw new ArgumentException("Active document must match ExpectedCopyPath and differ from the explicit OriginalPath.");
        if (d.IsReadOnly || d.IsModifiable || d.IsFamilyDocument)
            throw new ArgumentException("Requires a writable project copy outside a transaction; request NoTransaction.");
    }

    public static bool SamePath(string a, string b) => !string.IsNullOrWhiteSpace(a) && !string.IsNullOrWhiteSpace(b) &&
        string.Equals(Path.GetFullPath(a), Path.GetFullPath(b), StringComparison.OrdinalIgnoreCase);

    public static List<ElementId> Roots(Document d, ProfilerCandidate candidate)
    {
        if (string.IsNullOrWhiteSpace(candidate.Name) || candidate.UniqueIds == null || candidate.UniqueIds.Length < 1 || candidate.UniqueIds.Length > 200)
            throw new ArgumentException("Candidate needs a name and 1..200 explicit root UniqueIds.");
        return candidate.UniqueIds.Distinct().Select(uid => d.GetElement(uid)?.Id ??
            throw new ArgumentException("Candidate root absent: " + uid)).ToList();
    }

    // The preview itself warms Revit. Metadata is reacquired after rollback, never from invalid wrappers.
    public static List<ProfilerElement> Preview(Document d, List<ElementId> roots, ProfilerBudget budget)
    {
        var arm = Arm(d, roots, null, "closure-preview", budget, false);
        var metadata = new List<ProfilerElement>();
        foreach (var id in arm.DeletedIds) {
            budget.Check();
            var element = d.GetElement(new ElementId(id));
            if (element == null) throw new InvalidOperationException("Preview rollback did not restore every deleted ID.");
            metadata.Add(Profiler.Describe(element));
        }
        var protectedIds = new HashSet<string>(ProfilerSettings.SurvivorUniqueIds.Concat(ProfilerSettings.ViewUniqueIds));
        if (metadata.Any(e => protectedIds.Contains(e.UniqueId)))
            throw new ArgumentException("Deletion closure intersects a preserved survivor/view. Candidate refused after rolled-back preview.");
        return metadata;
    }

    public static ProfilerArm Arm(Document d, List<ElementId> roots, List<ProfilerElement> expected, string name, ProfilerBudget budget, bool measure = true)
    {
        budget.Check();
        var arm = new ProfilerArm { Arm = name };
        using (var group = new TransactionGroup(d, "Profiler temporary " + name)) {
            if (group.Start() != TransactionStatus.Started) throw new InvalidOperationException("Group did not start.");
            try {
                using (var transaction = new Transaction(d, "Profiler " + name)) {
                    if (transaction.Start() != TransactionStatus.Started) throw new InvalidOperationException("Transaction did not start.");
                    var clock = Stopwatch.StartNew();
                    if (roots != null) arm.DeletedIds = d.Delete(roots).Select(id => id.Value).OrderBy(id => id).ToArray();
                    arm.DeleteMs = clock.Elapsed.TotalMilliseconds;
                    if (arm.DeletedIds.Length > ProfilerSettings.MaxClosureElements)
                        throw new InvalidOperationException("Actual deletion closure exceeds configured MaxClosureElements; refusing the trial.");
                    if (expected != null && roots != null && !arm.DeletedIds.SequenceEqual(expected.Select(e => e.Id).OrderBy(id => id)))
                        throw new InvalidOperationException("Actual deletion closure changed after preview; trial invalid.");
                    clock.Restart(); d.Regenerate(); arm.RegenerateMs = clock.Elapsed.TotalMilliseconds;
                    clock.Restart();
                    if (transaction.Commit() != TransactionStatus.Committed) throw new InvalidOperationException("Transaction did not commit.");
                    arm.CommitMs = clock.Elapsed.TotalMilliseconds;
                }
                if (measure) arm.Samples = Profiler.Measure(d, ProfilerSettings.SurvivorUniqueIds, budget);
            } finally {
                if (group.GetStatus() == TransactionStatus.Started) {
                    var clock = Stopwatch.StartNew();
                    var status = group.RollBack(); arm.RollbackMs = clock.Elapsed.TotalMilliseconds;
                    if (status != TransactionStatus.RolledBack || group.GetStatus() != TransactionStatus.RolledBack)
                        throw new InvalidOperationException("Rollback incomplete. Stop this document trial and inspect SDK state.");
                }
            }
        }
        arm.Restored = true;
        foreach (var id in arm.DeletedIds) {
            budget.Check();
            if (d.GetElement(new ElementId(id)) == null) { arm.Restored = false; break; }
        }
        if (expected != null)
        foreach (var e in expected) {
            budget.Check();
            if (d.GetElement(e.UniqueId)?.Id.Value != e.Id) { arm.Restored = false; break; }
        }
        if (!arm.Restored) throw new InvalidOperationException("Rollback identity readback failed; stop this document trial.");
        return arm;
    }

    public static List<ProfilerDelta> Compare(string name, int trial, params List<ProfilerSample>[] arms)
    {
        var rows = new List<ProfilerDelta>();
        foreach (var workload in arms[0].Select(s => s.Workload).Distinct()) {
            var parts = arms.Select(a => a.Where(s => s.Workload == workload && s.Index > 0).ToList()).ToArray();
            var row = new ProfilerDelta { Candidate = name, Trial = trial, Workload = workload };
            row.Eligible = parts.All(p => p.Count == ProfilerSettings.Samples - 1 && p.All(s => s.Error == null && s.AbsentAnchors.Length == 0 && !s.Capped));
            row.Denominators = parts.Select(p => p.Select(s => s.Visited).Distinct().ToArray()).ToArray();
            if (workload.StartsWith("fixed-survivors/", StringComparison.Ordinal) && row.Denominators.SelectMany(a => a).Distinct().Count() != 1)
                row.Eligible = false;
            if (workload.StartsWith("fixed-survivors/", StringComparison.Ordinal) &&
                parts.SelectMany(p => p).Select(s => s.Checksum).Distinct().Count() != 1)
                row.Eligible = false;
            row.Exclusion = row.Eligible ? null : "Missing/error/capped workload, changed survivor denominator or checksum, or incomplete samples.";
            if (row.Eligible) {
                row.ArmMedianMs = parts.Select(p => Profiler.Median(p.Select(s => s.Milliseconds))).ToArray();
                // Arms are baseline, sham, treatment, restored baseline; all are separately retained.
                row.BenefitMs = row.ArmMedianMs[1] - row.ArmMedianMs[2];
                var controls = new[] { row.ArmMedianMs[0], row.ArmMedianMs[1], row.ArmMedianMs[3] };
                row.ControlVariationMs = controls.Max() - controls.Min();
                row.ExceedsControlVariation = row.BenefitMs > row.ControlVariationMs;
            }
            rows.Add(row);
        }
        return rows;
    }
}

public sealed class ProfilerDelta
{
    public string Candidate;
    public int Trial;
    public string Workload;
    public bool Eligible;
    public double[] ArmMedianMs;
    public int[][] Denominators;
    public double? BenefitMs;
    public double? ControlVariationMs;
    public bool ExceedsControlVariation;
    public string Exclusion;
}
