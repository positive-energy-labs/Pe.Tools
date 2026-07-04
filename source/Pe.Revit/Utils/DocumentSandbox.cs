namespace Pe.Revit.Utils;

/// <summary>
///     Shared transaction-isolation primitive for host-owned document work.
///     <para>
///         Rollback mode (<see cref="BeginRollback" />) never persists changes: the transaction is rolled back on
///         dispose, always. Its transaction name carries <see cref="TransactionNamePrefix" /> so document-event
///         consumers (e.g. bridge invalidation) can recognize sandbox churn and ignore it.
///     </para>
///     <para>
///         Commit mode (<see cref="BeginCommit" />) persists only via <see cref="Complete" />; disposing without
///         completing rolls back. Commit-mode transactions use the plain name — committed work is a real document
///         change and must look like one to event consumers and the undo stack.
///     </para>
/// </summary>
public sealed class DocumentSandbox : IDisposable {
    public const string TransactionNamePrefix = "PeSandbox::";

    [ThreadStatic] private static int _rollbackScopeDepth;

    private readonly bool _commitMode;
    private bool _completed;
    private bool _disposed;

    private DocumentSandbox(Transaction transaction, bool commitMode) {
        this.Transaction = transaction;
        this._commitMode = commitMode;
    }

    public Transaction Transaction { get; }

    /// <summary>True while a rollback sandbox is open on the current (Revit API) thread.</summary>
    public static bool RollbackScopeActive => _rollbackScopeDepth > 0;

    /// <summary>Starts a sandbox whose changes are always rolled back on dispose.</summary>
    public static DocumentSandbox BeginRollback(Document document, string name) =>
        Begin(document, TransactionNamePrefix + name, commitMode: false);

    /// <summary>Starts a sandbox that commits only via <see cref="Complete" /> and rolls back otherwise.</summary>
    public static DocumentSandbox BeginCommit(Document document, string name) =>
        Begin(document, name, commitMode: true);

    /// <summary>
    ///     True when the event's transaction names identify pure sandbox churn: at least one name, and every name
    ///     carries the sandbox prefix. Any unprefixed name means real work is mixed in — not sandbox churn.
    /// </summary>
    public static bool IsSandboxTransaction(IEnumerable<string> transactionNames) {
        var sawAny = false;
        foreach (var name in transactionNames) {
            sawAny = true;
            if (name == null || !name.StartsWith(TransactionNamePrefix, StringComparison.Ordinal))
                return false;
        }

        return sawAny;
    }

    /// <summary>Commits a commit-mode sandbox. Throws if the transaction did not commit cleanly.</summary>
    public void Complete() {
        if (!this._commitMode)
            throw new InvalidOperationException("Complete() is only valid on a commit-mode sandbox.");
        if (this._completed)
            return;

        var status = this.Transaction.Commit();
        this._completed = true;
        if (status != TransactionStatus.Committed)
            throw new InvalidOperationException($"The sandbox transaction did not commit successfully: {status}.");
    }

    public void Dispose() {
        if (this._disposed)
            return;

        this._disposed = true;
        if (!this._commitMode)
            _rollbackScopeDepth--;

        try {
            if (this.Transaction.HasStarted() && !this.Transaction.HasEnded())
                _ = this.Transaction.RollBack();
        } catch {
            // Dispose must not throw; a rollback that fails here has no recovery path and the
            // transaction's own dispose will still abort it.
        } finally {
            this.Transaction.Dispose();
        }
    }

    private static DocumentSandbox Begin(Document document, string transactionName, bool commitMode) {
        var transaction = new Transaction(document, transactionName);
        TransactionStatus status;
        try {
            status = transaction.Start();
        } catch {
            transaction.Dispose();
            throw;
        }

        if (status != TransactionStatus.Started) {
            transaction.Dispose();
            throw new InvalidOperationException($"Failed to start the sandbox transaction: {status}.");
        }

        if (!commitMode)
            _rollbackScopeDepth++;

        return new DocumentSandbox(transaction, commitMode);
    }
}
