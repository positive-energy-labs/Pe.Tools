// Edit the captured Pod source, never the user's original model. Script requests have no parameter bag.
public static class ProfilerSettings
{
    public static int MaxElements = 10000;
    // Native ID scans do not expand element wrappers. Separate from the metadata census bound.
    public static int MaxScanIds = 1000000;
    public static int MaxViewOwnedElements = 500000;
    public static int MaxClosureElements = 100000;
    public static int BudgetSeconds = 45;
    public static int Samples = 5;
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
    // ReadCostCensus: samples bound what the census itself expands; the census must never be the expensive read.
    public static int CensusBudgetSeconds = 180;
    public static int CensusFirstTouchSample = 1000;
    public static int CensusChunk = 250;
    // A bounded walk of the largest model category: ~13 KB/element on Chadds' IFC link, so 5000 is ~65 MiB.
    public static int CensusCategoryWalk = 5000;
    public static int CensusOrientationSample = 2000;
    public static int CensusObbSample = 200;
    public static int CensusFidelitySample = 500;
    public static int CensusSeed = 20261027;
}

public sealed class ProfilerCandidate
{
    public string Name { get; set; }
    public string[] UniqueIds { get; set; }
}
