// Numeric options arrive as script input (C1): pe.script("src/Profile.cs", { input: { maxElements: 2000 } }) from the Page,
// pe_read script:@document-profiler/src/Profile.cs { input } from Pea. A name left out keeps the fallback written here.
// Everything that names a model (copy paths, the acknowledgement, candidates, anchors) stays source: a caller's input
// must never be able to arm an experiment. Edit the captured Pod source, never the user's original model.
public static class ProfilerSettings
{
    public static int MaxElements, BudgetSeconds, Samples;
    // ReadCostCensus: samples bound what the census itself expands; the census must never be the expensive read.
    public static int CensusBudgetSeconds, CensusFirstTouchSample, CensusChunk, CensusCategoryWalk,
        CensusOrientationSample, CensusObbSample, CensusFidelitySample, CensusSeed;

    // Every entrypoint calls this first with (name, fallback) => Arg(name, fallback). Statics are assigned on every run,
    // so one run's input never leaks into the next. Profiler.Validate and ReadCostCensus check the bounds.
    public static void FromInput(Func<string, int, int> arg)
    {
        MaxElements = arg("maxElements", 10000);
        BudgetSeconds = arg("budgetSeconds", 45);
        Samples = arg("samples", 5);
        CensusBudgetSeconds = arg("censusBudgetSeconds", 180);
        CensusFirstTouchSample = arg("firstTouchSample", 1000);
        CensusChunk = arg("chunk", 250);
        // A bounded walk of the largest model category: ~13 KB/element on Chadds' IFC link, so 5000 is ~65 MiB.
        CensusCategoryWalk = arg("categoryWalk", 5000);
        CensusOrientationSample = arg("orientationSample", 2000);
        CensusObbSample = arg("obbSample", 200);
        CensusFidelitySample = arg("fidelitySample", 500);
        CensusSeed = arg("seed", 20261027);
    }

    // Native ID scans do not expand element wrappers. Separate from the metadata census bound.
    public static int MaxScanIds = 1000000;
    public static int MaxViewOwnedElements = 500000;
    public static int MaxClosureElements = 100000;
    public static int Trials = 3;
    // Supply the SAME surviving UniqueIds and view UniqueIds on every copy for comparative work.
    // Empty anchors use a baseline-only sample, which is NOT a cross-run fixed workload.
    public static string[] SurvivorUniqueIds = new string[0];
    public static string[] ViewUniqueIds = new string[0];
    public static bool EnableExperiments = false;
    public static bool EnableViewOpenProbe = false;
    public static string CopyAcknowledgement = ""; // Required: I own this disposable copy; never use the original
    public static string ExpectedCopyPath = "";
    public static string OriginalPath = "";
    public static ProfilerCandidate[] Candidates = new ProfilerCandidate[0];
    // SaveVariant uses exactly one candidate; destination must be a new .rvt file.
    public static string VariantPath = "";
}

public sealed class ProfilerCandidate
{
    public string Name { get; set; }
    public string[] UniqueIds { get; set; }
}
