using Autodesk.Revit.DB;
using Autodesk.Revit.DB.Events;
using Pe.Revit.Extensions.ProjDocument;
using Pe.Revit.Tasks;

namespace Pe.Revit.Operations;

// A handler's effect is the scope type in its signature. No scope parameter = Read.
// Signature rule (OpRegistry.Define): (request[, document][, scope][, CancellationToken]).
// The runner (Pe.Revit.Global OpRunner) hands the scope in and reads it back with the change monitor to state
// what the call touched. An op never states that itself, and a scope an op builds for itself is read by nobody.

/// <summary>What a temporary change sets on a view; named on the answer when its undo does not hold.</summary>
[Flags]
public enum ViewTemporary { Crop = 1, ScopeBox = 2, AnnotationCrop = 4, SheetFilter = 8 }

public static class ViewTemporaryCodes {
    /// <summary>The wire codes of `Touched.restoreFailed.views[].left`: crop, scopeBox, annotationCrop, sheetFilter.</summary>
    public static List<string> Codes(this ViewTemporary what) =>
        Enum.GetValues(typeof(ViewTemporary)).Cast<ViewTemporary>().Where(flag => what.HasFlag(flag))
            .Select(flag => char.ToLowerInvariant(flag.ToString()[0]) + flag.ToString().Substring(1)).ToList();
}

/// <summary>One temporary change a <see cref="SessionWrite" /> made, and whether its undo committed.</summary>
public sealed record ScopeRestore(string DocumentKey, string UniqueId, long ViewId, ViewTemporary What, bool Held);

/// <summary>
///     What a scope did, as plain facts with no Revit type in them, so the runner's statement of `touched` is
///     tested without Revit. <see cref="Own" /> holds the names of the set and undo transactions of the scope's
///     temporaries: expected commits, not writes.
/// </summary>
public sealed record ScopeFacts(bool Used, bool Posted, IReadOnlyCollection<string> Own, IReadOnlyList<ScopeRestore> Restores) {
    public static readonly ScopeFacts None = new(false, false, [], []);
}

/// <summary>What the runner hands a handler, whatever its effect. <see cref="Document" /> is null for an op that needs none.</summary>
public abstract class OperationScope(Document? document) {
    private int _contained;
    protected Document Document => document
        ?? throw new InvalidOperationException("This operation has no document, so its scope cannot open a transaction.");

    /// <summary>True once the handler asked the scope for anything.</summary>
    public bool Used { get; protected set; }
    /// <summary>Names of the set and undo transactions of the scope's temporaries: expected commits, not writes.</summary>
    public HashSet<string> Own { get; } = new(StringComparer.Ordinal);
    public List<ScopeRestore> Restores { get; } = [];
    /// <summary>The handler posted a ribbon command: Revit runs it after the call returns, where nothing here can see it.</summary>
    public bool Posted { get; protected set; }
    public ScopeFacts Facts() => new(this.Used, this.Posted, this.Own.ToList(), this.Restores.ToList());
    /// <summary>True while the scope is inside work whose commits it discards. Read by the change monitor on the API thread.</summary>
    public bool Containing => this._contained > 0;

    protected T Contained<T>(Func<T> work) {
        this.Used = true;
        this._contained++;
        try { return work(); } finally { this._contained--; }
    }

    protected void Commit(string name, Action apply) {
        this.Used = true;
        using var transaction = new Transaction(this.Document, name);
        if (transaction.Start() != TransactionStatus.Started)
            throw new InvalidOperationException($"'{name}' transaction could not start.");
        apply();
        if (transaction.Commit() != TransactionStatus.Committed)
            throw new InvalidOperationException(
                $"'{name}' transaction did not commit (a Revit failure/warning likely rolled it back).");
    }
}

public sealed class TransactRead(Document? document) : OperationScope(document) {
    /// <summary>Runs <paramref name="work" /> inside a transaction group on the op's document and always rolls it back.</summary>
    public T Run<T>(string name, Func<T> work) => this.Contained(() => {
        using var group = new TransactionGroup(this.Document, DocumentSandbox.TransactionNamePrefix + name);
        if (group.Start() != TransactionStatus.Started)
            throw new InvalidOperationException($"'{name}' rollback group could not start.");
        try { return work(); } finally { _ = group.RollBack(); }
    });

    /// <summary>
    ///     <paramref name="work" /> may commit only in <paramref name="owned" />, a document the handler opened and
    ///     discards. No transaction is opened here: LoadFamily and EditFamily refuse one.
    /// </summary>
    // ponytail: containment is by time, not by document. A commit to another document inside this call reads as
    // discarded. Compare the event's document to `owned` once spike A (fact 4) proves Document.Equals survives
    // Revit's per-event wrappers; RevitScriptExecutionService's guard found that ReferenceEquals does not.
    public T InDisposable<T>(Document owned, string name, Func<T> work) {
        _ = owned ?? throw new ArgumentNullException(nameof(owned));
        return this.Contained(work);
    }
}

public sealed class SessionWrite(Document? document) : OperationScope(document) {
    /// <summary>Commits one transaction. Views and session state only.</summary>
    public T Commit<T>(string name, Func<T> work) {
        T result = default!;
        this.Commit(name, () => result = work());
        return result;
    }

    /// <summary>
    ///     Sets a temporary change on <paramref name="view" />, uses it, and undoes it, each in its own committed
    ///     transaction ("PE temporary {name}", "PE restore {name}"): a crop write does not render until committed.
    ///     A failed undo never replaces the result. It is recorded for the runner, and <paramref name="whenLeft" />
    ///     lets the result say so too.
    /// </summary>
    public T Temporarily<T>(View view, ViewTemporary what, string name, Action set, Func<T> use, Action undo,
        Func<T, T>? whenLeft = null) {
        // Read before the change: a failed undo can leave the view in a state that cannot be asked.
        var (documentKey, uniqueId, viewId) = (this.Document.GetDocumentKey(), view.UniqueId, view.Id.Value());
        void Record(bool held) => this.Restores.Add(new ScopeRestore(documentKey, uniqueId, viewId, what, held));
        _ = this.Own.Add($"PE temporary {name}");
        _ = this.Own.Add($"PE restore {name}");
        this.Commit($"PE temporary {name}", set);
        T result;
        try {
            result = use();
        } catch {
            Record(this.TryUndo(name, undo));
            throw;
        }

        var held = this.TryUndo(name, undo);
        Record(held);
        return held || whenLeft is null ? result : whenLeft(result);
    }

    private bool TryUndo(string name, Action undo) {
        try {
            this.Commit($"PE restore {name}", undo);
            return true;
        } catch (Exception exception) {
            Serilog.Log.Warning(exception, "'PE restore {Name}' did not hold; the view keeps its temporary state.", name);
            return false;
        }
    }
}

public sealed class ModelWrite(Document? document) : OperationScope(document) {
    public T Transact<T>(string name, Func<T> work) {
        this.Used = true;
        using var sandbox = DocumentSandbox.BeginCommit(this.Document, name);
        var result = work();
        sandbox.Complete();
        return result;
    }

    /// <summary>Posts a ribbon command. What it then does is outside the call.</summary>
    public T Post<T>(Func<T> post) {
        this.Used = true;
        this.Posted = true;
        return post();
    }
}

/// <summary>One committed change Revit reported while a call was running.</summary>
/// <param name="Contained">Sandbox churn, or a commit a scope was discarding when it fired.</param>
public sealed record ObservedChange(
    string DocumentTitle, IReadOnlyList<string> Transactions, int Added, int Modified, int Deleted, bool Contained);

/// <summary>
///     The one DocumentChanged subscription for op calls and script runs. Subscribed once per process, in API
///     context, and never removed: Revit refuses event changes outside API context, and an op may finish off it.
///     A call opens a <see cref="Window" /> and closes it from any thread.
/// </summary>
public static class OperationMonitor {
    private static readonly object Gate = new();
    private static readonly List<Window> Open = [];
    private static Autodesk.Revit.ApplicationServices.Application? _attached;

    public static void Attach(Autodesk.Revit.ApplicationServices.Application application) {
        lock (Gate) {
            if (_attached != null) return;
            _attached = application;
        }
        application.DocumentChanged += OnDocumentChanged;
    }

    /// <summary>Starts collecting changes. <paramref name="scope" /> is the call's scope, null for a Read.</summary>
    public static Window Watch(OperationScope? scope = null) {
        var window = new Window(scope);
        lock (Gate) {
            // ponytail: two calls open at once cannot tell their commits apart, so both are marked and the runner
            // calls nothing unauthorized on a marked call. Attribute by document once spike A proves an identity.
            if (Open.Count != 0) {
                window.Overlapped = true;
                foreach (var other in Open) other.Overlapped = true;
            }
            Open.Add(window);
        }
        return window;
    }

    private static void OnDocumentChanged(object? sender, DocumentChangedEventArgs args) {
        int added = args.GetAddedElementIds().Count, modified = args.GetModifiedElementIds().Count,
            deleted = args.GetDeletedElementIds().Count;
        if (added == 0 && modified == 0 && deleted == 0) return;
        var names = args.GetTransactionNames().ToList();
        var sandbox = DocumentSandbox.RollbackScopeActive || DocumentSandbox.IsSandboxTransaction(names);
        var title = args.GetDocument()?.Title ?? "<unknown>";
        lock (Gate)
            foreach (var window in Open)
                window.Add(new ObservedChange(title, names, added, modified, deleted,
                    sandbox || window.Scope?.Containing == true));
    }

    public sealed class Window : IDisposable {
        private readonly List<ObservedChange> _changes = [];
        internal Window(OperationScope? scope) => this.Scope = scope;
        public OperationScope? Scope { get; }
        /// <summary>Another window was open at some point in this one's life, so its changes may be another call's.</summary>
        public bool Overlapped { get; internal set; }
        public IReadOnlyList<ObservedChange> Changes { get { lock (Gate) return this._changes.ToList(); } }
        internal void Add(ObservedChange change) => this._changes.Add(change);
        public void Dispose() { lock (Gate) _ = Open.Remove(this); }
    }
}
