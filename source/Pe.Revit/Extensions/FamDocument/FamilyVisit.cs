using Autodesk.Revit.DB.Events;
using Pe.Revit.Failures;
using Pe.Revit.Tasks;

namespace Pe.Revit.Extensions.FamDocument;

/// <summary>Who owns the transaction on the family document while it is edited.</summary>
public enum FamilyVisitTransaction {
    /// <summary>The visit opens a `Transaction` per edit (desktop commands, tests).</summary>
    Owned,
    /// <summary>`DocumentSandbox.BeginCommit` per edit: the sanctioned primitive for pods and scripts, which may not create a `Transaction`.</summary>
    Sandbox
}

/// <summary>Why a visit did not start. Typed so a pod can branch on it instead of parsing a message.</summary>
public enum FamilyVisitRefusal {
    None,
    /// <summary>Gotcha 25: `EditFamily` and `LoadFamily` throw while the project is modifiable. The caller must park its transaction on another document (the pod parks; the visit never changes the active document).</summary>
    ProjectIsModifiable,
    /// <summary>The document is itself a family document; use <see cref="FamilyVisit.InPlace" />.</summary>
    DocumentIsFamily,
    /// <summary>`Family.IsEditable` is false (in-place or system family).</summary>
    FamilyNotEditable
}

public sealed class FamilyVisitOptions {
    public FamilyVisitTransaction Transaction { get; init; } = FamilyVisitTransaction.Owned;

    /// <summary>Load the edited family back into the project (overwrite parameter values) and verify it by re-reading it.</summary>
    public bool Load { get; init; } = true;

    public IFamilyLoadOptions LoadOptions { get; init; } = new DefaultFamilyLoadOptions();

    /// <summary>
    ///     The caller's park: invoked before `EditFamily` when the project is modifiable, disposed after the load.
    ///     The pod's park activates a marker family document so the host transaction rides there; the visit
    ///     itself never activates a document.
    /// </summary>
    public Func<Document, IDisposable>? Park { get; init; }

    /// <summary>Auto-resolve warnings on commit and record them as diagnostics instead of showing a dialog.</summary>
    public bool SuppressWarnings { get; init; }
}

/// <summary>The open family document plus the edit primitive that wraps each edit in the right transaction.</summary>
public sealed class FamilyVisitScope {
    private readonly FamilyVisitOptions _options;

    internal FamilyVisitScope(FamilyDocument document, FamilyVisitOptions options) {
        this.Document = document;
        this._options = options;
    }

    public FamilyDocument Document { get; }

    /// <summary>Commit diagnostics per named edit; `IsError` false is a suppressed warning.</summary>
    public List<(string Edit, bool IsError, string Message)> Diagnostics { get; } = [];

    /// <summary>One edit = one transaction (owned) or one sandbox commit. A family document already modifiable (the host holds it) runs the edit inline.</summary>
    public void Edit(string name, Action<FamilyDocument> edit) {
        var doc = this.Document.Document;
        var diagnostics = new List<(bool IsError, string Message)>();

        void OnFailures(object? _, FailuresProcessingEventArgs args) {
            var accessor = args.GetFailuresAccessor();
            if (accessor?.GetDocument()?.Equals(doc) != true) return;
            foreach (var failure in accessor.GetFailureMessages()) {
                var severity = failure.GetSeverity();
                if (this._options.SuppressWarnings && severity == FailureSeverity.Warning) continue;
                var text = failure.GetDescriptionText();
                diagnostics.Add((severity != FailureSeverity.Warning, string.IsNullOrWhiteSpace(text) ? failure.GetFailureDefinitionId().Guid.ToString() : text));
            }
        }

        doc.Application.FailuresProcessing += OnFailures;
        try {
            if (doc.IsModifiable) {
                edit(this.Document); // the caller's transaction already holds this document
            } else if (this._options.Transaction == FamilyVisitTransaction.Sandbox) {
                using var sandbox = DocumentSandbox.BeginCommit(doc, name);
                Suppress(sandbox.Transaction, diagnostics);
                edit(this.Document);
                sandbox.Complete();
            } else {
                using var transaction = new Transaction(doc, name);
                _ = transaction.Start();
                Suppress(transaction, diagnostics);
                edit(this.Document);
                _ = transaction.Commit();
            }
        } finally {
            doc.Application.FailuresProcessing -= OnFailures;
        }
        this.Diagnostics.AddRange(diagnostics.Select(d => (name, d.IsError, d.Message)));
    }

    private void Suppress(Transaction transaction, List<(bool IsError, string Message)> diagnostics) {
        if (!this._options.SuppressWarnings) return;
        var options = transaction.GetFailureHandlingOptions();
        _ = options.SetFailuresPreprocessor(PeToolsFailureHandling.CreatePreprocessor(diagnostics));
        _ = options.SetForcedModalHandling(false);
        transaction.SetFailureHandlingOptions(options);
    }
}

public sealed record FamilyVisitResult(
    FamilyVisitRefusal Refusal,
    string? Message,
    Family? Loaded,
    bool Verified,
    IReadOnlyList<(string Edit, bool IsError, string Message)> Diagnostics
) {
    public bool Ran => this.Refusal == FamilyVisitRefusal.None;
}

/// <summary>
///     The one family round-trip primitive: `EditFamily` → edits under the caller's transaction discipline →
///     `LoadFamily` back → post-verify → close. Replaces the choreography four pods re-derived (c-ff §7.5).
///     It detects the caller's transaction state and refuses, with a typed reason, the one state Revit
///     cannot serve (gotcha 25) unless the caller supplied a park. No FF dependency: pods call it directly.
/// </summary>
public static class FamilyVisit {
    public static FamilyVisitResult Run(Document project, Family family, Action<FamilyVisitScope> visit, FamilyVisitOptions? options = null) {
        options ??= new FamilyVisitOptions();
        if (project.IsFamilyDocument)
            return Refused(FamilyVisitRefusal.DocumentIsFamily, "The document is a family document; use FamilyVisit.InPlace.");
        if (!family.IsEditable)
            return Refused(FamilyVisitRefusal.FamilyNotEditable, $"Family '{family.Name}' is not editable (in-place or system family).");
        if (project.IsModifiable && options.Park is null)
            return Refused(FamilyVisitRefusal.ProjectIsModifiable,
                $"The project holds an open transaction; EditFamily/LoadFamily throw (gotcha 25). Park it on another document (FamilyVisitOptions.Park) or run outside the transaction.");

        using var park = project.IsModifiable ? options.Park!(project) : null;
        if (project.IsModifiable)
            return Refused(FamilyVisitRefusal.ProjectIsModifiable, "The park did not release the project; it is still modifiable.");

        var familyName = family.Name;
        var famDoc = new FamilyDocument(project.EditFamily(family)).EnsureDefaultType();
        var scope = new FamilyVisitScope(famDoc, options);
        try {
            visit(scope);
            if (!options.Load) return new FamilyVisitResult(FamilyVisitRefusal.None, null, null, false, scope.Diagnostics);

            var loadDiagnostics = new List<(bool IsError, string Message)>();
            var loaded = PeToolsFailureHandling.ExecuteWithFailureHandling(project,
                () => famDoc.LoadFamily(project, options.LoadOptions), loadDiagnostics, famDoc.Document);
            scope.Diagnostics.AddRange(loadDiagnostics.Select(d => ("LoadFamily", d.IsError, d.Message)));
            // post-verify: the family is in the project by name and is the element LoadFamily handed back
            var verified = loaded is not null && project.GetElement(loaded.Id) is Family reread && reread.Name == familyName;
            return new FamilyVisitResult(FamilyVisitRefusal.None, verified ? null : $"LoadFamily returned {(loaded is null ? "null" : $"'{loaded.Name}'")} for '{familyName}'.", loaded, verified, scope.Diagnostics);
        } finally {
            _ = famDoc.Close(false);
        }
    }

    /// <summary>The family-document path: no EditFamily, no Load. Edits run under the same transaction discipline.</summary>
    public static FamilyVisitResult InPlace(FamilyDocument document, Action<FamilyVisitScope> visit, FamilyVisitOptions? options = null) {
        var scope = new FamilyVisitScope(document.Document.IsModifiable ? document : document.EnsureDefaultType(), options ?? new FamilyVisitOptions());
        visit(scope);
        return new FamilyVisitResult(FamilyVisitRefusal.None, null, null, true, scope.Diagnostics);
    }

    private static FamilyVisitResult Refused(FamilyVisitRefusal refusal, string message) => new(refusal, message, null, false, []);
}

/// <summary>
///     Coalesces repeated visits to one family into one `EditFamily`/`LoadFamily` round-trip: queue edits per
///     family, then <see cref="Flush" /> visits each family once with its edits in order.
/// </summary>
public sealed class FamilyVisitSession(Document project, FamilyVisitOptions? options = null) {
    private readonly Dictionary<ElementId, (Family Family, List<(string Name, Action<FamilyDocument> Edit)> Edits)> _pending = new();

    public FamilyVisitSession Add(Family family, string name, Action<FamilyDocument> edit) {
        if (!this._pending.TryGetValue(family.Id, out var entry)) this._pending[family.Id] = entry = (family, []);
        entry.Edits.Add((name, edit));
        return this;
    }

    public IReadOnlyList<(Family Family, FamilyVisitResult Result)> Flush() {
        var results = new List<(Family, FamilyVisitResult)>();
        foreach (var (family, edits) in this._pending.Values.ToList()) {
            results.Add((family, FamilyVisit.Run(project, family, scope => {
                foreach (var (name, edit) in edits) scope.Edit(name, edit);
            }, options)));
        }
        this._pending.Clear();
        return results;
    }
}
