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
public enum ViewTemporary { Crop = 1, ScopeBox = 2, AnnotationCrop = 4, SheetFilter = 8, Phase = 16, PhaseFilter = 32 }

public static class ViewTemporaryCodes {
    /// <summary>The wire codes of `Touched.restoreFailed.views[].left`: crop, scopeBox, annotationCrop, sheetFilter, phase, phaseFilter.</summary>
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
public sealed record ScopeFacts(bool Used, bool Posted, IReadOnlyCollection<string> Own, IReadOnlyList<ScopeRestore> Restores,
    bool Undiscarded = false) {
    public static readonly ScopeFacts None = new(false, false, [], []);
}

/// <summary>What the runner hands a handler, whatever its effect. <see cref="Document" /> is null for an op that needs none.</summary>
public abstract class OperationScope(Document? document) {
    private readonly List<Document> _discarding = [];
    protected Document Document => document
        ?? throw new InvalidOperationException("This operation has no document, so its scope cannot open a transaction.");

    /// <summary>True once the handler asked the scope for anything.</summary>
    public bool Used { get; protected set; }
    /// <summary>Names of the set and undo transactions of the scope's temporaries: expected commits, not writes.</summary>
    public HashSet<string> Own { get; } = new(StringComparer.Ordinal);
    public List<ScopeRestore> Restores { get; } = [];
    /// <summary>The handler posted a ribbon command: Revit runs it after the call returns, where nothing here can see it.</summary>
    public bool Posted { get; protected set; }
    /// <summary>A rollback that did not roll back, or a disposable document still open when the handler returned.</summary>
    protected bool RollbackFailed { get; set; }
    protected List<Document> Disposables { get; } = [];
    protected bool IsOpDocument(Document other) => document is not null && document.Equals(other);
    /// <summary>True when <paramref name="changed" /> is the op's own document; false once that document is closed.</summary>
    public bool IsFor(Document changed) => document is { IsValidObject: true } && document.Equals(changed);
    public ScopeFacts Facts() => new(this.Used, this.Posted, this.Own.ToList(), this.Restores.ToList(),
        this.RollbackFailed || this.Disposables.Any(owned => owned.IsValidObject));
    /// <summary>
    ///     True while the scope is discarding what is committed in <paramref name="changed" />. Read by the change
    ///     monitor on the API thread. Compared with Document.Equals: Revit hands each event its own wrapper, so
    ///     ReferenceEquals is always false (spike A fact 4, fresh Revit 2025, spike/kernel2-a 55cfb68c).
    /// </summary>
    public bool Discards(Document? changed) => changed is not null && this._discarding.Any(document => document.Equals(changed));

    protected T Discarding<T>(Document document, Func<T> work) {
        this.Used = true;
        this._discarding.Add(document);
        try { return work(); } finally { _ = this._discarding.Remove(document); }
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
    public T Run<T>(string name, Func<T> work) => this.Discarding(this.Document, () => {
        using var group = new TransactionGroup(this.Document, DocumentSandbox.TransactionNamePrefix + name);
        if (group.Start() != TransactionStatus.Started)
            throw new InvalidOperationException($"'{name}' rollback group could not start.");
        try { return work(); } finally { this.RollbackFailed |= group.RollBack() != TransactionStatus.RolledBack; }
    });

    /// <summary>
    ///     <paramref name="work" /> may commit only in <paramref name="owned" />, a document the handler opened and
    ///     discards. No transaction is opened here: LoadFamily and EditFamily refuse one. The op's own document is
    ///     never disposable, and the runner reads <paramref name="owned" /> back after the handler returns: if it is
    ///     still open, what was committed in it was not discarded.
    /// </summary>
    public T InDisposable<T>(Document owned, string name, Func<T> work) {
        if (owned is null) throw new ArgumentNullException(nameof(owned));
        if (this.IsOpDocument(owned)) throw new ArgumentException($"'{name}' cannot discard the operation's own document.", nameof(owned));
        this.Disposables.Add(owned);
        return this.Discarding(owned, work);
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
/// <param name="Contained">Sandbox churn, or a commit in a document the call's scope was discarding when it fired.</param>
public sealed record ObservedChange(
    string DocumentTitle, IReadOnlyList<string> Transactions, int Added, int Modified, int Deleted, bool Contained) {
    /// <summary>The commit's element ids. Kept only by a window that named this commit's document in <see cref="OperationMonitor.Watch" />.</summary>
    public ObservedIds? Ids { get; init; }
    /// <summary>The window's scope was discarding this commit's document when it fired, told by Document.Equals: a script run's fenced sibling.</summary>
    public bool Discarded { get; init; }
    /// <summary>A transaction group that held this commit was rolled back afterwards (<see cref="OperationMonitor.RolledBack" />), so it is not in the document.</summary>
    public bool RolledBack { get; init; }
}

/// <summary>Every element id of one commit, as Revit reported it.</summary>
public sealed record ObservedIds(IReadOnlyList<long> Added, IReadOnlyList<long> Modified, IReadOnlyList<long> Deleted);

/// <summary>
///     The one DocumentChanged subscription for op calls and script runs. Subscribed once per process, in API
///     context, and never removed: Revit refuses event changes outside API context, and an op may finish off it.
///     A call opens a <see cref="Window" /> and closes it from any thread.
/// </summary>
public static class OperationMonitor {
    private static readonly object Gate = new();
    private static readonly List<Window> Open = [];
    private static Autodesk.Revit.ApplicationServices.Application? _attached;
    private static long _commits;

    /// <summary>A point in the order of the commits Revit reported, for <see cref="RolledBack" />.</summary>
    public static long Mark() { lock (Gate) return _commits; }

    /// <summary>
    ///     Tells every open window that a transaction group on <paramref name="document" /> was rolled back, so no
    ///     commit seen there since <paramref name="mark" /> is in the document. The one who rolled back says so:
    ///     Revit's own TransactionGroupRolledBack event names no element and no commit (fresh Revit 2025, spike
    ///     b4bd4100, 2026-11-18), and a script's own nested group may roll back less than the run.
    /// </summary>
    public static void RolledBack(Document document, long mark) {
        lock (Gate)
            foreach (var window in Open) window.RollBack(document, mark);
    }

    public static void Attach(Autodesk.Revit.ApplicationServices.Application application) {
        lock (Gate) {
            if (_attached != null) return;
            _attached = application;
        }
        application.DocumentChanged += OnDocumentChanged;
    }

    /// <summary>
    ///     Starts collecting changes. <paramref name="scope" /> is the call's scope, null for a Read. A window given
    ///     <paramref name="idsOf" /> also keeps the element ids of every commit in that document; an op call keeps counts only.
    /// </summary>
    public static Window Watch(OperationScope? scope = null, Document? idsOf = null) {
        var window = new Window(scope, idsOf);
        lock (Gate) {
            // ponytail: two calls open at once cannot tell their commits apart (both may target one document), so
            // both are marked and the runner calls nothing unauthorized on a marked call. Give each commit its
            // call (an ambient scope on the API thread) if a real overlap ever hides a real unauthorized write.
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
        var document = args.GetDocument();
        var title = document?.Title ?? "<unknown>";
        ObservedIds? ids = null;
        static List<long> Values(ICollection<ElementId> elementIds) => elementIds.Select(id => id.Value()).ToList();
        lock (Gate) {
            var order = ++_commits;
            foreach (var window in Open) {
                var discarded = window.Scope?.Discards(document) == true;
                window.Add(order, document is not null && window.Owns(document), new ObservedChange(title, names, added, modified, deleted, sandbox || discarded) {
                    // Document.Equals, never ReferenceEquals: Revit hands each event its own wrapper.
                    Ids = window.IdsOf is { } wanted && document is not null && wanted.Equals(document)
                        ? ids ??= new ObservedIds(Values(args.GetAddedElementIds()), Values(args.GetModifiedElementIds()), Values(args.GetDeletedElementIds()))
                        : null,
                    Discarded = discarded
                });
            }
        }
    }

    public sealed class Window : IDisposable {
        // Own: the commit was in the window's own document, told while the event's wrapper was alive. No
        // wrapper from an event is kept: a document a script closes leaves one that must not be asked anything.
        private readonly List<(long Order, bool Own, ObservedChange Change)> _changes = [];
        internal Window(OperationScope? scope, Document? idsOf) => (this.Scope, this.IdsOf) = (scope, idsOf);
        public OperationScope? Scope { get; }
        internal Document? IdsOf { get; }
        /// <summary>Another window was open at some point in this one's life, so its changes may be another call's.</summary>
        public bool Overlapped { get; internal set; }
        public IReadOnlyList<ObservedChange> Changes { get { lock (Gate) return this._changes.Select(seen => seen.Change).ToList(); } }
        /// <summary>The window's own document: the one it keeps ids of, or its scope's. Document.Equals, never ReferenceEquals.</summary>
        internal bool Owns(Document document) =>
            (this.IdsOf is { IsValidObject: true } wanted && wanted.Equals(document)) || this.Scope?.IsFor(document) == true;
        internal void Add(long order, bool own, ObservedChange change) => this._changes.Add((order, own, change));
        internal void RollBack(Document document, long mark) {
            if (!this.Owns(document)) return;
            for (var index = 0; index < this._changes.Count; index++) {
                var (order, own, change) = this._changes[index];
                if (order > mark && own)
                    this._changes[index] = (order, own, change with { Contained = true, RolledBack = true });
            }
        }
        public void Dispose() { lock (Gate) _ = Open.Remove(this); }
    }
}
