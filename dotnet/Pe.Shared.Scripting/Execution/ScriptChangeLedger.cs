using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.CSharp.Syntax;
using Pe.Shared.HostContracts.Scripting;

namespace Pe.Shared.Scripting.Execution;

/// <summary>One commit Revit reported in the run's document, in order.</summary>
public sealed record ScriptCommit(
    IReadOnlyList<string> Transactions, IReadOnlyList<long> Added, IReadOnlyList<long> Modified, IReadOnlyList<long> Deleted);

/// <summary>
///     One failure as Revit raised it. <paramref name="CommitsBefore" /> is how many commits the run had seen when
///     it was raised: its transaction committed only if a later commit carries its name.
///     <paramref name="Dismissed" /> is a warning the host's own handling acknowledged.
/// </summary>
public sealed record ScriptRaisedFailure(
    string Message, string Severity, string DefinitionId, IReadOnlyList<long> ElementIds, string Transaction,
    int CommitsBefore, bool Dismissed = false);

/// <summary>How a write run's transactions sit in Revit's undo list.</summary>
/// <param name="Undo">The one entry's name, when the run's transactions are one entry.</param>
/// <param name="Ungrouped">Why they are separate entries, when they are.</param>
public sealed record ScriptUndo(string? Undo = null, string? Ungrouped = null);

/// <summary>
///     What a script run tells the person and Pea about its changes: the result's `changes` and `failures`, from
///     plain facts with no Revit type in them, so the words are tested without Revit.
/// </summary>
public static class ScriptChangeLedger {
    public const int IdCap = 2000;

    /// <summary>
    ///     Calls Revit refuses while a transaction group is open on the document they act on ("Operation is not
    ///     permitted when there is any open transaction phase"; Save and SaveAs proven on fresh Revit 2025,
    ///     2026-11-14; EditFamily and LoadFamily are allowed). A script that makes one runs ungrouped.
    ///     ponytail: matched by member name in the script's own sources, so `stream.Save()` also ungroups a run, and
    ///     a save inside a called library is not seen and fails with Revit's words. Bind the symbol if either bites.
    /// </summary>
    private static readonly HashSet<string> RefusedInGroup = new(StringComparer.Ordinal) { "Save", "SaveAs", "SynchronizeWithCentral" };

    /// <summary>The first call in <paramref name="sources" /> that Revit refuses inside a transaction group; null when there is none.</summary>
    public static string? GroupRefusal(ScriptSourceSet sources) => sources.Files
        .SelectMany(file => CSharpSyntaxTree.ParseText(file.Content).GetRoot().DescendantNodes().OfType<InvocationExpressionSyntax>())
        .Select(call => call.Expression is MemberAccessExpressionSyntax member ? member.Name.Identifier.ValueText : null)
        .FirstOrDefault(name => name is not null && RefusedInGroup.Contains(name));

    public static List<ScriptFailure> Failures(
        ScriptPermissionMode mode, IReadOnlyList<ScriptCommit> commits, IReadOnlyList<ScriptRaisedFailure> raised) => raised
        // Revit may process one failure in several passes; it is one failure.
        .GroupBy(failure => (failure.Transaction, failure.DefinitionId, failure.Message, Elements: string.Join(",", failure.ElementIds)))
        .Select(group => group.Last())
        .Select(failure => new ScriptFailure(failure.Message, failure.Severity, failure.DefinitionId, failure.ElementIds.ToList(),
            failure.Transaction,
            mode == ScriptPermissionMode.ReadOnly ? ScriptFailureOutcome.RolledBack
            : failure.Dismissed ? ScriptFailureOutcome.Dismissed
            : commits.Skip(failure.CommitsBefore).Any(commit => commit.Transactions.Contains(failure.Transaction, StringComparer.Ordinal))
                ? ScriptFailureOutcome.Committed
                : ScriptFailureOutcome.RolledBack))
        .ToList();

    public static ScriptChanges Changes(
        ScriptPermissionMode mode, IReadOnlyList<ScriptCommit> commits, IReadOnlyList<ScriptFailure> failures, ScriptUndo undo) {
        // Net over the run, in commit order: added then modified is added; added then deleted is nothing.
        HashSet<long> added = [], modified = [], deleted = [];
        foreach (var commit in commits) {
            foreach (var id in commit.Added) { _ = added.Add(id); }
            foreach (var id in commit.Modified) { if (!added.Contains(id)) _ = modified.Add(id); }
            foreach (var id in commit.Deleted) { if (!added.Remove(id)) { _ = modified.Remove(id); _ = deleted.Add(id); } }
        }

        var kept = mode != ScriptPermissionMode.ReadOnly;
        // A ReadOnly run commits under the guard's own name, which names nothing the script did.
        var transactions = mode == ScriptPermissionMode.ReadOnly ? [] : commits.SelectMany(commit => commit.Transactions).ToList();
        static ScriptChangedIds Bound(HashSet<long> ids) => new(ids.OrderBy(id => id).Take(IdCap).ToList(), ids.Count);
        var grouped = kept && added.Count + modified.Count + deleted.Count != 0;
        // One commit is one undo entry whether or not a group held it; it carries the script's own name for it.
        var entry = !grouped ? null : undo.Undo ?? (commits.Count == 1 ? commits[0].Transactions.FirstOrDefault() : null);
        var ungrouped = grouped && entry is null ? undo.Ungrouped ?? "the run was not grouped." : null;
        return new ScriptChanges(Bound(added), Bound(modified), Bound(deleted), transactions, kept,
            Summary(mode, added.Count, modified.Count, deleted.Count, commits.Count, failures, entry, ungrouped),
            entry, ungrouped);
    }

    private static string Summary(
        ScriptPermissionMode mode, int added, int modified, int deleted, int commits, IReadOnlyList<ScriptFailure> failures,
        string? undo, string? ungrouped) {
        var total = added + modified + deleted;
        var counts = $"{total} element{(total == 1 ? "" : "s")} ({added} added, {modified} modified, {deleted} deleted)";
        var lost = failures.Where(failure => failure.Outcome == ScriptFailureOutcome.RolledBack).ToList();
        var lostNames = lost.Select(failure => failure.Transaction).Distinct(StringComparer.Ordinal).ToList();
        var why = lost.Count == 0 ? "" : $" Revit said: {lost[0].Message}{(lost.Count > 1 ? $" (and {lost.Count - 1} more)" : "")}";
        if (mode == ScriptPermissionMode.ReadOnly)
            return (total == 0 ? "ReadOnly run: it would change no element." : $"ReadOnly run: it would change {counts}. Nothing was kept.")
                   + (lost.Count == 0 ? "" : $" Revit raised {lost.Count} failure{(lost.Count == 1 ? "" : "s")}.{why}");
        var rolledBack = lostNames.Count == 0 ? ""
            : $" Revit rolled back {lostNames.Count} transaction{(lostNames.Count == 1 ? "" : "s")} ({string.Join(", ", lostNames.Select(name => $"'{name}'"))}).{why}";
        if (commits == 0)
            return lostNames.Count == 0 ? "No element changed."
                : $"Nothing changed: Revit rolled back every transaction this run tried to commit ({string.Join(", ", lostNames.Select(name => $"'{name}'"))}).{why}";
        var entry = undo is not null ? $" One undo entry: '{undo}'."
            : ungrouped is not null ? $" {commits} undo entries, not one: {ungrouped}"
            : "";
        return $"Changed {counts} in {commits} transaction{(commits == 1 ? "" : "s")}.{entry}{rolledBack}";
    }
}
