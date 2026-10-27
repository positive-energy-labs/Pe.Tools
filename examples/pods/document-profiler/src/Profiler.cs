public sealed class ProfilerBudget
{
    private readonly Stopwatch clock = Stopwatch.StartNew();
    private readonly System.Threading.CancellationToken token;
    private readonly int seconds;
    public ProfilerBudget(System.Threading.CancellationToken token, int seconds = 0)
    { this.token = token; this.seconds = seconds > 0 ? seconds : ProfilerSettings.BudgetSeconds; }
    public double Elapsed => clock.Elapsed.TotalSeconds;
    public void Check()
    {
        token.ThrowIfCancellationRequested();
        if (clock.Elapsed.TotalSeconds > seconds)
            throw new TimeoutException("Cooperative Pod budget expired; one Revit API call cannot be preempted.");
    }
}

public sealed class ProfilerElement
{
    public long Id;
    public string UniqueId;
    public string Name;
    public string Category;
    public long? CategoryId;
    public string Family;
    public string Kind;
    public long TypeId;
    public long OwnerViewId;
}

public sealed class ProfilerSample
{
    public string Workload;
    public int Index;
    public double Milliseconds;
    public int Visited;
    public bool Capped;
    public string[] AbsentAnchors;
    public string Error;
    public string Checksum;
}

public static class Profiler
{
    public static void Validate()
    {
        if (ProfilerSettings.MaxElements < 1 || ProfilerSettings.MaxElements > 20000 ||
            ProfilerSettings.MaxScanIds < 1 || ProfilerSettings.MaxScanIds > 2000000 ||
            ProfilerSettings.MaxViewOwnedElements < 1 || ProfilerSettings.MaxViewOwnedElements > 2000000 ||
            ProfilerSettings.MaxClosureElements < 1 || ProfilerSettings.MaxClosureElements > 200000 ||
            ProfilerSettings.BudgetSeconds < 1 || ProfilerSettings.BudgetSeconds > 300 ||
            ProfilerSettings.Samples < 3 || ProfilerSettings.Samples > 15 ||
            ProfilerSettings.Trials < 2 || ProfilerSettings.Trials > 5 ||
            ProfilerSettings.SurvivorUniqueIds.Length > 200 || ProfilerSettings.ViewUniqueIds.Length > 5)
            throw new ArgumentException("Bounds: 1..20000 metadata rows, 1..2000000 scan IDs/view-owned elements, 1..200000 closure elements, 1..300 seconds, 3..15 samples, 2..5 trials, <=200 survivors, <=5 views.");
    }

    public static object Provenance(Document d) => new {
        title = d.Title, path = d.PathName, creationGuid = d.CreationGUID.ToString(),
        projectInformationUniqueId = d.ProjectInformation?.UniqueId,
        revitVersion = d.Application.VersionNumber, revitBuild = d.Application.VersionBuild,
        isWorkshared = d.IsWorkshared, isModified = d.IsModified, isReadOnly = d.IsReadOnly,
        recordedUtc = DateTime.UtcNow.ToString("o")
    };

    public static ProfilerElement Describe(Element e) => new ProfilerElement {
        Id = e.Id.Value, UniqueId = e.UniqueId, Name = Short(e.Name),
        Category = e.Category?.Name, CategoryId = e.Category?.Id.Value,
        Family = e is FamilyInstance fi ? Short(fi.Symbol?.FamilyName) : e is Family f ? Short(f.Name) : null,
        Kind = e is RevitLinkInstance ? "link" : e is ImportInstance ? "import" : e is View ? "view" : e is Family ? "family-definition" : "element",
        TypeId = e.GetTypeId().Value, OwnerViewId = e.OwnerViewId.Value
    };

    private static string Short(string s) => s == null || s.Length <= 160 ? s : s.Substring(0, 160);

    public static void Census(Document d, ProfilerBudget budget, List<ProfilerElement> result, out bool capped)
    {
        capped = false;
        using (var collector = new FilteredElementCollector(d).WhereElementIsNotElementType())
        foreach (var e in collector) {
            budget.Check();
            if (result.Count == ProfilerSettings.MaxElements) { capped = true; break; }
            result.Add(Describe(e));
        }
    }

    public static string[] Anchors(List<ProfilerElement> elements) =>
        ProfilerSettings.SurvivorUniqueIds.Length > 0 ? ProfilerSettings.SurvivorUniqueIds :
        elements.Where(e => e.Kind == "element").Take(100).Select(e => e.UniqueId).ToArray();

    public static void ViewOwnership(Document d, ProfilerBudget budget, ProfilerViewOwnership inventory)
    {
        budget.Check();
        // Invalid owner matches view-independent elements; invert this native quick filter before expansion.
        using (var filter = new ElementOwnerViewFilter(ElementId.InvalidElementId, true)) {
            using (var count = new FilteredElementCollector(d).WhereElementIsNotElementType().WherePasses(filter))
                inventory.TotalViewOwnedElements = count.GetElementCount();
            using (var collector = new FilteredElementCollector(d).WhereElementIsNotElementType().WherePasses(filter))
            foreach (var element in collector) {
                budget.Check();
                if (inventory.VisitedElements == ProfilerSettings.MaxViewOwnedElements) { inventory.Capped = true; break; }
                var owner = element.OwnerViewId.Value;
                if (!inventory.Views.TryGetValue(owner, out var row)) {
                    var view = d.GetElement(element.OwnerViewId) as View;
                    row = new ProfilerOwnedView { Id = owner, UniqueId = view?.UniqueId, Name = view?.Name,
                        ViewKind = view?.ViewType.ToString() ?? "unresolved-owner" };
                    inventory.Views.Add(owner, row);
                }
                row.OwnedCount++;
                inventory.VisitedElements++;
            }
        }
        inventory.Complete = !inventory.Capped && inventory.VisitedElements == inventory.TotalViewOwnedElements;
    }

    public static List<ProfilerSample> Measure(Document d, string[] anchors, ProfilerBudget budget, List<ProfilerSample> result = null)
    {
        result = result ?? new List<ProfilerSample>();
        for (var i = 0; i < ProfilerSettings.Samples; i++) {
            result.Add(Timed("whole-document/non-type-ids", i, budget, () => {
                using (var c = new FilteredElementCollector(d).WhereElementIsNotElementType())
                    return Visit(c, budget);
            }));
            var absent = new List<string>();
            var consumed = new StringBuilder();
            var sample = Timed("fixed-survivors/GetElement+Comments", i, budget, () => {
                var found = 0;
                foreach (var uid in anchors) {
                    budget.Check();
                    var e = d.GetElement(uid);
                    if (e == null) { absent.Add(uid); continue; }
                    // Consume the same parameter on the same anchors; missing parameters stay in the denominator.
                    var p = e.get_Parameter(BuiltInParameter.ALL_MODEL_INSTANCE_COMMENTS);
                    var value = p?.AsString();
                    consumed.Append(uid.Length).Append(':').Append(uid).Append('|')
                        .Append(p == null ? "absent" : p.HasValue ? "value" : "unset").Append('|')
                        .Append(value == null ? -1 : value.Length).Append(':').Append(value).Append('\n');
                    found++;
                }
                return (found, false);
            });
            sample.AbsentAnchors = absent.ToArray();
            sample.Checksum = Checksum(consumed.ToString());
            result.Add(sample);
            foreach (var uid in ProfilerSettings.ViewUniqueIds) {
                result.Add(Timed("view-query/" + uid, i, budget, () => {
                    var view = d.GetElement(uid) as View;
                    if (view == null || !FilteredElementCollector.IsViewValidForElementIteration(d, view.Id))
                        throw new InvalidOperationException("View absent or invalid for iteration; workload excluded.");
                    using (var c = new FilteredElementCollector(d, view.Id).WhereElementIsNotElementType())
                        return Visit(c, budget);
                }));
            }
        }
        return result;
    }

    // Deterministic FNV-1a over UTF-8; an integrity checksum, never a security/provenance hash.
    private static string Checksum(string value)
    {
        ulong hash = 14695981039346656037UL;
        foreach (var b in Encoding.UTF8.GetBytes(value)) unchecked { hash = (hash ^ b) * 1099511628211UL; }
        return "fnv1a64/utf8:" + value.Length + ":" + hash.ToString("x16");
    }

    private static (int, bool) Visit(FilteredElementCollector collector, ProfilerBudget budget)
    {
        var n = 0;
        using (var ids = collector.GetElementIdIterator())
        while (ids.MoveNext()) { budget.Check(); if (n == ProfilerSettings.MaxScanIds) return (n, true); n++; }
        return (n, false);
    }

    public static void Strata(Document d, ProfilerBudget budget, List<object> rows)
    {
        foreach (var type in new[] { typeof(Family), typeof(ElementType), typeof(RevitLinkInstance), typeof(ImportInstance), typeof(View), typeof(Autodesk.Revit.DB.Group) }) {
            budget.Check();
            using (var c = new FilteredElementCollector(d).OfClass(type)) {
                var count = c.GetElementCount();
                var members = new List<ProfilerElement>();
                using (var sample = new FilteredElementCollector(d).OfClass(type))
                foreach (var e in sample) { budget.Check(); if (members.Count >= 200) break; members.Add(Describe(e)); }
                rows.Add(new { kind = type.Name, totalCount = count, sampled = members.Count, capped = count > members.Count, members });
            }
        }
        budget.Check();
        var unused = d.GetUnusedElements(new HashSet<ElementId>());
        var unusedMembers = new List<ProfilerElement>();
        foreach (var id in unused.Take(200)) { budget.Check(); var e = d.GetElement(id); if (e != null) unusedMembers.Add(Describe(e)); }
        rows.Add(new { kind = "GetUnusedElements/all-categories", totalCount = unused.Count,
            sampled = unusedMembers.Count, capped = unused.Count > unusedMembers.Count, members = unusedMembers,
            interpretation = "One-pass purge eligibility, not measured cost or approval. More may become unused after deletion." });
    }

    private static ProfilerSample Timed(string name, int index, ProfilerBudget budget, Func<(int, bool)> action)
    {
        budget.Check();
        var sample = new ProfilerSample { Workload = name, Index = index, AbsentAnchors = new string[0] };
        var clock = Stopwatch.StartNew();
        try { var measured = action(); sample.Visited = measured.Item1; sample.Capped = measured.Item2; }
        catch (Autodesk.Revit.Exceptions.ApplicationException e) { sample.Error = e.Message; }
        catch (InvalidOperationException e) { sample.Error = e.Message; }
        sample.Milliseconds = clock.Elapsed.TotalMilliseconds;
        return sample;
    }

    public static double Median(IEnumerable<double> values)
    {
        var sorted = values.OrderBy(x => x).ToArray();
        if (sorted.Length == 0) throw new ArgumentException("No valid samples.");
        return (sorted[(sorted.Length - 1) / 2] + sorted[sorted.Length / 2]) / 2;
    }

    public static object Summaries(List<ProfilerSample> samples) => samples.GroupBy(s => s.Workload).Select(g => new {
        workload = g.Key, firstTouchMs = g.First().Milliseconds,
        warm = Summary(g.Where(s => s.Index > 0).ToList())
    }).ToArray();

    public static object Summary(List<ProfilerSample> samples)
    {
        var valid = samples.Where(s => s.Error == null && s.AbsentAnchors.Length == 0).ToList();
        return new { eligible = valid.Count == samples.Count && valid.Count > 0 && valid.All(s => !s.Capped),
            samples = samples.Count, validSamples = valid.Count,
            medianMs = valid.Count == 0 ? (double?)null : Median(valid.Select(s => s.Milliseconds)),
            minMs = valid.Count == 0 ? (double?)null : valid.Min(s => s.Milliseconds),
            maxMs = valid.Count == 0 ? (double?)null : valid.Max(s => s.Milliseconds),
            denominators = valid.Select(s => s.Visited).Distinct().ToArray(),
            capped = valid.Any(s => s.Capped) };
    }

    public static object Memory()
    {
        using (var p = Process.GetCurrentProcess()) {
            p.Refresh();
            return new { processId = p.Id, privateBytes = p.PrivateMemorySize64, workingSetBytes = p.WorkingSet64,
                managedBytes = GC.GetTotalMemory(false), measuredUtc = DateTime.UtcNow.ToString("o"),
                attribution = "Whole-process observation, including other documents, caches and profiler overhead. No per-element RAM estimate." };
        }
    }

    public static readonly string[] Limits = {
        "Counts and groups are deletion hypotheses, not costs or recommendations. Links are inventoried as host instances; linked documents are not traversed.",
        "No geometry expansion or rendered GUI measurement. View-query timings include collector/cache work, not visible frame time.",
        "Index zero is first access by this run, not a cold-process guarantee. Warm samples exclude it.",
        "Bounds are cooperative; indivisible Revit calls and collector setup/materialization may exceed the budget.",
        "Process RAM cannot be attributed to elements. Rollback does not reset native allocation, graphics, undo or caches. Compare saved variants in repeated fresh processes externally.",
        "API timings are descriptive on this process and workload. Control drift and absent anchors can invalidate comparisons. No inference of model quality or permission to delete.",
        "The survivor checksum covers UniqueId and built-in Comments presence/value only. Surviving elements may change in other ways; this is not a whole-model equivalence certificate."
    };
}

public sealed class ProfilerViewOwnership
{
    public int? TotalViewOwnedElements;
    public int VisitedElements;
    public bool Capped;
    public bool Complete;
    public Dictionary<long, ProfilerOwnedView> Views = new Dictionary<long, ProfilerOwnedView>();
}

public sealed class ProfilerOwnedView
{
    public long Id;
    public string UniqueId;
    public string Name;
    public string ViewKind;
    public int OwnedCount;
}
