namespace Pe.Shared.Scripting.Execution;

/// <summary>
/// Decides whether a DocumentChanged event escaped the ReadOnly rollback guard. Revit may return a
/// different Document wrapper for the event, so transaction names—not reference identity—are the
/// reliable boundary. Guard-owned and unnamed regeneration events are contained by the rollback.
/// </summary>
public static class ReadOnlyGuardMutationClassifier
{
    public static bool EscapedGuard(IEnumerable<string> transactionNames, string guardTransactionName) =>
        transactionNames.Any(name =>
            !string.IsNullOrWhiteSpace(name) &&
            !string.Equals(name, guardTransactionName, StringComparison.Ordinal));
}
