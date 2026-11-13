using Newtonsoft.Json;
using Pe.Revit.Operations;
using Pe.Shared.HostContracts.Bridge;
using Pe.Shared.HostContracts.Operations;
using Pe.Shared.RevitData;
using DbDocument = Autodesk.Revit.DB.Document;

namespace Pe.Revit.Global.Services.Host;

/// <summary>
///     One finished call. <see cref="Touched" /> is stated whether or not the handler succeeded: a failed or
///     cancelled call may still have written. <see cref="Error" /> is the handler's exception, or the runner's
///     own when a call committed what its scope does not allow.
/// </summary>
internal sealed record OpRun(object? Response, Touched Touched, string? EvidenceJson, Exception? Error);

/// <summary>
///     The runner (ADR 0042): hands an op the scope its signature names, watches Revit's change events while it
///     runs, and states what it touched. An op cannot state that itself.
/// </summary>
internal static class OpRunner {
    /// <summary>
    ///     Call on the thread the op needs. The scope and the watch open before the handler's first await, and the
    ///     watch closes when the handler's task does, on whatever thread that is. Never throws for a handler failure.
    /// </summary>
    public static async Task<OpRun> RunAsync(Op op, string payloadJson, object? document, CancellationToken cancellationToken, string? derivedCommand = null) {
        var scope = Scope(op.Definition.Effect, document switch {
            RevitDocument wrapped => wrapped.Value,
            ProjectDocument wrapped => wrapped.Value,
            FamilyDocument wrapped => wrapped.Value,
            _ => null
        });
        // An op off the Revit thread cannot commit; watching it would only mark the calls beside it as overlapped.
        using var window = op.Thread == OpThread.Revit ? OperationMonitor.Watch(scope) : null;
        object? response = null;
        Exception? error = null;
        try {
            response = await op.ExecuteAsync(payloadJson, document, scope, cancellationToken, derivedCommand).ConfigureAwait(false);
        } catch (Exception exception) {
            error = exception;
        }

        var touched = Touch(op.Definition.Effect, scope?.Facts() ?? ScopeFacts.None, window?.Changes ?? [], window?.Overlapped ?? false);
        if (touched is Touched.Unauthorized unauthorized) {
            // The runner detects; it does not roll back (sight plan 4.4). The call fails and says what changed.
            var message = $"'{op.Key}' is a {op.Definition.Effect} and committed {string.Join(", ", unauthorized.Transactions.Select(name => $"'{name}'"))} "
                          + $"(added {unauthorized.Added}, modified {unauthorized.Modified}, deleted {unauthorized.Deleted}). The change was not rolled back.";
            return new OpRun(null, touched, null, BridgeOperationExceptions.Unexpected("UnauthorizedCommit",
                new InvalidOperationException(message, error), "Undo the change in Revit, and report the operation: it wrote outside its scope."));
        }

        // Evidence crosses by interface, never by a field name; a response type without it sends none.
        var evidence = response is IEvidenced<IObserved> evidenced
            ? JsonConvert.SerializeObject(evidenced.Evidence, SdkOperations.Json)
            : null;
        return new OpRun(response, touched, evidence, error);
    }

    private static OperationScope? Scope(OpEffect effect, DbDocument? document) => effect switch {
        OpEffect.TransactRead => new TransactRead(document),
        OpEffect.SessionWrite => new SessionWrite(document),
        OpEffect.ModelWrite => new ModelWrite(document),
        _ => null
    };

    /// <summary>What the scope knows it did, cross-checked against what Revit reported. Pure, so it is tested without Revit.</summary>
    internal static Touched Touch(OpEffect effect, ScopeFacts scope, IReadOnlyList<ObservedChange> changes, bool overlapped) {
        if (scope.Posted)
            return new Touched.Unknown(TouchedUnknownReason.PostedCommand);
        var left = scope.Restores.Where(restore => !restore.Held).ToList();
        if (left.Count != 0)
            return new Touched.RestoreFailed(left.Select(restore => new ViewLeft(View(restore),
                restore.What.Codes().Select(code => (ViewLeftover)Enum.Parse(typeof(ViewLeftover), code, true)).ToList())).ToList());

        // A commit nothing was discarding, other than the set and undo of the scope's own temporaries. A discard
        // that did not happen (a rollback that failed, a scratch document left open) contained nothing.
        var stray = changes.Where(change => (!change.Contained || scope.Undiscarded)
            && !(change.Transactions.Count != 0 && change.Transactions.All(scope.Own.Contains))).ToList();
        var names = stray.SelectMany(change => change.Transactions).Distinct(StringComparer.Ordinal).ToList();
        int added = stray.Sum(change => change.Added), modified = stray.Sum(change => change.Modified), deleted = stray.Sum(change => change.Deleted);
        switch (effect) {
            case OpEffect.SessionWrite or OpEffect.ModelWrite when stray.Count != 0:
                // Not checked: that a SessionWrite changed views only. Spike A (fresh Revit 2025) shows a crop commit
                // lists the view and two non-View elements beside it, so a strict "views only" rule would refuse
                // the capture itself. The transaction names and counts are stated instead.
                return new Touched.Wrote(names, added, modified, deleted);
            case OpEffect.SessionWrite when scope.Restores.Count != 0:
                return new Touched.Restored(scope.Restores.Select(View).Distinct().ToList());
            case OpEffect.Read or OpEffect.TransactRead when stray.Count != 0 && overlapped:
                // Another call's window was open, so the commit may be its own. It is never called clean
                // (purger N1). The call is not refused: overlap is only known after both ran, and failing a
                // read because a write ran beside it would punish the innocent one.
                return new Touched.Unknown(TouchedUnknownReason.Overlapped);
            case OpEffect.Read or OpEffect.TransactRead when stray.Count != 0:
                return new Touched.Unauthorized(names, added, modified, deleted);
            case OpEffect.TransactRead when scope.Undiscarded:
                // Nothing was seen to commit, but the discard the scope promised did not happen.
                return new Touched.Unknown(TouchedUnknownReason.CancelledMidEffect);
            case OpEffect.TransactRead when scope.Used || changes.Any(change => change.Contained):
                return new Touched.RolledBack();
            default:
                return new Touched.None();
        }
    }

    private static ViewRef View(ScopeRestore restore) => new(restore.DocumentKey, restore.UniqueId, restore.ViewId);
}
