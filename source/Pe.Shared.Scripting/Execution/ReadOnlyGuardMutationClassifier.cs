namespace Pe.Shared.Scripting.Execution;

/// <summary>
/// Decides, from a DocumentChanged event's transaction names alone, whether a change escaped the
/// ReadOnly rollback guard. Name-based on purpose: Revit hands the event a Document wrapper that is
/// not reference-equal to the one the guard captured from context.Document, so a Document-reference
/// check misreads the guard's own rolled-back churn as a foreign write — the ViewSchedule.GetTableData
/// regeneration false positive. A change escaped the guard only if it carries a real transaction name
/// that is not the guard's: a committed transaction the TransactionGroup rollback does not cover (for
/// example a change to another open document). A regeneration the script's reads force reports the
/// guard's own transaction name, or none at all, and is contained by the rollback.
/// </summary>
public static class ReadOnlyGuardMutationClassifier
{
    public static bool EscapedGuard(IEnumerable<string> transactionNames, string guardTransactionName) =>
        transactionNames.Any(name =>
            !string.IsNullOrWhiteSpace(name) &&
            !string.Equals(name, guardTransactionName, StringComparison.Ordinal));
}
