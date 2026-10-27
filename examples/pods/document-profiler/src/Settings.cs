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
}

public sealed class ProfilerCandidate
{
    public string Name { get; set; }
    public string[] UniqueIds { get; set; }
}
