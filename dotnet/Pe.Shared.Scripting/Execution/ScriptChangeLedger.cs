using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.CSharp.Syntax;
using Pe.Shared.HostContracts.Scripting;

namespace Pe.Shared.Scripting.Execution;

/// <summary>One commit Revit reported in the run's document, in order.</summary>
public sealed record ScriptCommit(
    IReadOnlyList<string> Transactions, IReadOnlyList<long> Added, IReadOnlyList<long> Modified, IReadOnlyList<long> Deleted);

/// <summary>
///     One failure as Revit raised it. <paramref name="CommitsBefore" /> is how many commits, in any document,
///     the run had seen when it was raised: Revit commits in order on one thread, so its transaction committed
///     only if the very next commit carries its name. <paramref name="Dismissed" /> is a warning the host's own
///     handling acknowledged.
/// </summary>
public sealed record ScriptRaisedFailure(
    string Message, string Severity, string DefinitionId, IReadOnlyList<long> ElementIds, string Transaction,
    int CommitsBefore, bool Dismissed = false);

/// <summary>
///     One commit the run made in a document it was not run on. The run's sibling fence rolled it back, so
///     nothing changed there (RevitScriptExecutionService SiblingFence).
/// </summary>
public sealed record ScriptFencedCommit(string Document, IReadOnlyList<string> Transactions, int Elements);

/// <summary>How a write run's transactions sit in Revit's undo list.</summary>
/// <param name="Undo">The one entry's name, when the run's transactions are one entry.</param>
/// <param name="Ungrouped">Why they are separate entries, when they are.</param>
/// <param name="RolledBack">The run did not finish and its group was rolled back: nothing it committed is in the document.</param>
public sealed record ScriptUndo(string? Undo = null, string? Ungrouped = null, bool RolledBack = false);

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

    /// <summary>
    ///     The first call in <paramref name="sources" /> that Revit refuses inside a transaction group; null when
    ///     there is none. The caller passes the entrypoint's dependency closure (ScriptSourceClosure), never the
    ///     whole Pod: a helper the entrypoint uses that saves must ungroup it, and a sibling script that saves must not.
    /// </summary>
    public static string? GroupRefusal(ScriptSourceSet sources) => sources.Files
        .SelectMany(file => CSharpSyntaxTree.ParseText(file.Content).GetRoot().DescendantNodes().OfType<InvocationExpressionSyntax>())
        .Select(call => call.Expression is MemberAccessExpressionSyntax member ? member.Name.Identifier.ValueText : null)
        .FirstOrDefault(name => name is not null && RefusedInGroup.Contains(name));

    /// <summary>
    ///     The names <paramref name="sources" /> gives a `new Transaction(document, "name")` that are not in
    ///     <paramref name="committed" />: the candidates for a transaction a script left open, which Revit does not name.
    /// </summary>
    public static List<string> StartedNotCommitted(ScriptSourceSet sources, IEnumerable<string> committed) => sources.Files
        .SelectMany(file => CSharpSyntaxTree.ParseText(file.Content).GetRoot().DescendantNodes().OfType<ObjectCreationExpressionSyntax>())
        .Where(creation => creation.Type.ToString().EndsWith("Transaction", StringComparison.Ordinal))
        .Select(creation => creation.ArgumentList?.Arguments.ElementAtOrDefault(1)?.Expression)
        .OfType<LiteralExpressionSyntax>().Where(literal => literal.Token.Value is string)
        .Select(literal => literal.Token.ValueText)
        .Distinct(StringComparer.Ordinal).Except(committed, StringComparer.Ordinal).ToList();

    /// <summary>What a run says when its script ended with a transaction still open on <paramref name="document" />.</summary>
    /// <param name="candidates">The names from <see cref="StartedNotCommitted" />.</param>
    public static string LeakedWords(string document, IReadOnlyList<string> candidates) =>
        $"The script ended with a transaction still open on '{document}', and the run could not end it: Revit ends a transaction only through the script's own Transaction object. "
        + (candidates.Count == 0 ? "Revit does not name the open transaction. "
            : $"Revit does not name it; the script's source starts {Quoted(candidates)}, which did not commit. ")
        + "What that transaction changed is not committed, and Revit discards it when the run returns. "
        + "Start every transaction in a `using` block, so that a throw ends it.";

    /// <param name="committed">The transaction names of every commit the run saw, in order, in any document.</param>
    /// <remarks>
    ///     ponytail: a commit that changed no element raises no change event, so a warning in one reads RolledBack.
    ///     Read the event's own rollback notice if that ever misleads.
    /// </remarks>
    public static List<ScriptFailure> Failures(
        ScriptPermissionMode mode, IReadOnlyList<IReadOnlyList<string>> committed, IReadOnlyList<ScriptRaisedFailure> raised) => raised
        // Revit may hand one failure of one attempt to several readers (a preprocessor, then the event); it is one failure.
        .GroupBy(failure => (failure.Transaction, failure.CommitsBefore, failure.DefinitionId, failure.Message, Elements: string.Join(",", failure.ElementIds)))
        .Select(group => group.First() with { Dismissed = group.Any(failure => failure.Dismissed) })
        .Select(failure => new ScriptFailure(failure.Message, failure.Severity, failure.DefinitionId, failure.ElementIds.ToList(),
            failure.Transaction,
            mode == ScriptPermissionMode.ReadOnly ? ScriptFailureOutcome.RolledBack
            : failure.Dismissed ? ScriptFailureOutcome.Dismissed
            : committed.ElementAtOrDefault(failure.CommitsBefore)?.Contains(failure.Transaction, StringComparer.Ordinal) == true
                ? ScriptFailureOutcome.Committed
                : ScriptFailureOutcome.RolledBack))
        .ToList();

    /// <summary>
    ///     The <c>failures</c> rows for what the sibling fence rolled back, in the host's words: Revit raised none
    ///     of these, so they carry no definition id and no element ids (the ids belong to another document).
    /// </summary>
    public static List<ScriptFailure> FencedFailures(IReadOnlyList<ScriptFencedCommit> fenced) => fenced
        .Select(commit => new ScriptFailure(
            $"A script changes only the document it runs on. This run committed {Quoted(commit.Transactions)} in '{commit.Document}' " +
            $"({commit.Elements} element{(commit.Elements == 1 ? "" : "s")}), and that was rolled back: nothing changed there. " +
            $"To change '{commit.Document}', run the script on it.",
            "Error", "", [], string.Join(", ", commit.Transactions), ScriptFailureOutcome.RolledBack))
        .ToList();

    /// <summary>One sentence for every fenced commit of a run; empty when there is none.</summary>
    public static string FencedWords(IReadOnlyList<ScriptFencedCommit> fenced) {
        if (fenced.Count == 0) return "";
        var documents = fenced.Select(commit => commit.Document).Distinct(StringComparer.Ordinal).Select(title => $"'{title}'");
        return $"The run also committed {fenced.Count} transaction{(fenced.Count == 1 ? "" : "s")} in {string.Join(", ", documents)}, " +
               $"which it was not run on. {(fenced.Count == 1 ? "That was" : "Those were")} rolled back: a script changes only the document it runs on.";
    }

    /// <summary>
    ///     Why Revit refused a save during a run, naming every hold the run has: Revit's exception does not say
    ///     which document it refused, so the words blame neither hold alone. Null when the run holds nothing,
    ///     so the refusal is not the run's doing.
    /// </summary>
    /// <param name="targetHold">Why the run's own document has a transaction or group open; null when it has none.</param>
    /// <param name="siblings">The titles of the other open documents the run's fence holds.</param>
    public static string? SaveRefusedWords(string? targetHold, IReadOnlyList<string> siblings) {
        if (targetHold is null && siblings.Count == 0) return null;
        var holds = new List<string>();
        if (targetHold is not null) holds.Add($"its own document ({targetHold})");
        if (siblings.Count != 0)
            holds.Add($"every other open document ({string.Join(", ", siblings.Select(title => $"'{title}'"))}), so that a script changes only the document it runs on");
        return "Revit refuses Save, SaveAs and synchronize on a document that has a transaction or a transaction group open. "
               + $"This run holds one on {string.Join(", and one on ", holds)}."
               + (targetHold is null ? "" : " To save the run's own document, use a NoTransaction script whose own source calls Save.")
               + (siblings.Count == 0 ? "" : " To save another document, run the script on it.");
    }

    private static string Quoted(IReadOnlyList<string> names) =>
        names.Count == 0 ? "a transaction" : string.Join(", ", names.Select(name => $"'{name}'"));

    /// <param name="failures">The failures Revit raised (<see cref="Failures" />), without the fence's own rows.</param>
    /// <param name="overlapped">Another call's window was open during this run, so a commit here may be that call's.</param>
    /// <param name="fenced">What the run committed in documents it was not run on, which was rolled back.</param>
    /// <param name="failed">The script did not finish: it threw, timed out or was cancelled.</param>
    /// <remarks>
    ///     A run whose group was rolled back (<see cref="ScriptUndo.RolledBack" />) is not kept: like a ReadOnly
    ///     run, its lists are what it had committed, and none of that is in the document.
    /// </remarks>
    public static ScriptChanges Changes(
        ScriptPermissionMode mode, IReadOnlyList<ScriptCommit> commits, IReadOnlyList<ScriptFailure> failures, ScriptUndo undo,
        bool overlapped = false, IReadOnlyList<ScriptFencedCommit>? fenced = null, bool failed = false) {
        // Net over the run, in commit order: added then modified is added; added then deleted is nothing.
        HashSet<long> added = [], modified = [], deleted = [];
        foreach (var commit in commits) {
            foreach (var id in commit.Added) { _ = added.Add(id); }
            foreach (var id in commit.Modified) { if (!added.Contains(id)) _ = modified.Add(id); }
            foreach (var id in commit.Deleted) { if (!added.Remove(id)) { _ = modified.Remove(id); _ = deleted.Add(id); } }
        }

        var kept = mode != ScriptPermissionMode.ReadOnly && !undo.RolledBack;
        // A ReadOnly run commits under the guard's own name, which names nothing the script did.
        var transactions = mode == ScriptPermissionMode.ReadOnly ? [] : commits.SelectMany(commit => commit.Transactions).ToList();
        static ScriptChangedIds Bound(HashSet<long> ids) => new(ids.OrderBy(id => id).Take(IdCap).ToList(), ids.Count);
        var grouped = kept && added.Count + modified.Count + deleted.Count != 0;
        // One commit is one undo entry whether or not a group held it; it carries the script's own name for it.
        var entry = !grouped ? null : undo.Undo ?? (commits.Count == 1 ? commits[0].Transactions.FirstOrDefault() : null);
        var ungrouped = grouped && entry is null ? undo.Ungrouped ?? "the run was not grouped." : null;
        return new ScriptChanges(Bound(added), Bound(modified), Bound(deleted), transactions, kept,
            Summary(mode, added.Count, modified.Count, deleted.Count, commits.Count, failures, entry, ungrouped, undo.RolledBack, failed)
            + (fenced is { Count: > 0 } ? " " + FencedWords(fenced) : "")
            + (overlapped ? " Another call ran at the same time; these may include its changes." : ""),
            entry, ungrouped, overlapped);
    }

    private static string Summary(
        ScriptPermissionMode mode, int added, int modified, int deleted, int commits, IReadOnlyList<ScriptFailure> failures,
        string? undo, string? ungrouped, bool rolledBackWhole, bool failed) {
        var total = added + modified + deleted;
        var counts = $"{total} element{(total == 1 ? "" : "s")} ({added} added, {modified} modified, {deleted} deleted)";
        var lost = failures.Where(failure => failure.Outcome == ScriptFailureOutcome.RolledBack).ToList();
        var lostNames = lost.Select(failure => failure.Transaction).Distinct(StringComparer.Ordinal).ToList();
        var why = lost.Count == 0 ? "" : $" Revit said: {lost[0].Message}{(lost.Count > 1 ? $" (and {lost.Count - 1} more)" : "")}";
        if (mode == ScriptPermissionMode.ReadOnly)
            return (total == 0 ? "ReadOnly run: it would change no element." : $"ReadOnly run: it would change {counts}. Nothing was kept.")
                   + (lost.Count == 0 ? "" : $" Revit raised {lost.Count} failure{(lost.Count == 1 ? "" : "s")}.{why}");
        if (rolledBackWhole)
            return commits == 0 ? "The script did not finish. No element changed."
                : $"The script did not finish, so the run was rolled back and nothing changed: it had committed {counts} in {commits} transaction{(commits == 1 ? "" : "s")}, and none of that is in the model.";
        var rolledBack = lostNames.Count == 0 ? ""
            : $" Revit rolled back {lostNames.Count} transaction{(lostNames.Count == 1 ? "" : "s")} ({string.Join(", ", lostNames.Select(name => $"'{name}'"))}).{why}";
        if (commits == 0)
            return lostNames.Count == 0 ? "No element changed."
                : $"Nothing changed: Revit rolled back every transaction this run tried to commit ({string.Join(", ", lostNames.Select(name => $"'{name}'"))}).{why}";
        var entry = undo is not null ? $" One undo entry: '{undo}'."
            : ungrouped is not null ? $" {commits} undo entries, not one: {ungrouped}"
            : "";
        // A run Revit could not roll back (ungrouped, or a transaction left open) keeps what it committed.
        var lead = failed ? "The script did not finish, and what it had committed is still in the model:" : "Changed";
        return $"{lead} {counts} in {commits} transaction{(commits == 1 ? "" : "s")}.{entry}{rolledBack}";
    }
}
