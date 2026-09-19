using Pe.Revit.Failures;
using Pe.Revit.Tasks;
using Pe.Shared.RevitData.Families;

namespace Pe.Revit.DocumentData.Families.Loaded;

public sealed class LoadedFamiliesMatrixEvaluationContext : IDisposable {
    private bool _disposed;

    internal LoadedFamiliesMatrixEvaluationContext(
        Document projectDocument,
        IReadOnlyList<Family> families,
        IReadOnlyDictionary<long, Family> familiesById,
        IReadOnlyDictionary<long, List<FamilySymbol>> symbolsByFamilyId
    ) {
        this.ProjectDocument = projectDocument;
        this.Families = families;
        this.FamiliesById = familiesById;
        this.SymbolsByFamilyId = symbolsByFamilyId;
    }

    public Document ProjectDocument { get; }
    public IReadOnlyList<Family> Families { get; }
    public IReadOnlyDictionary<long, Family> FamiliesById { get; }
    public IReadOnlyDictionary<long, List<FamilySymbol>> SymbolsByFamilyId { get; }
    public Dictionary<long, TempPlacedSymbolRecord> TempPlacementsBySymbolId { get; } = new();
    public Dictionary<long, List<TempPlacedSymbolRecord>> TempPlacementsByFamilyId { get; } = new();

    public Dictionary<ElementId, List<TempPlacedSymbolRecord>> TempPlacementsByCategoryId { get; } =
        new(ElementIdEqualityComparer.Instance);

    public Dictionary<long, List<ProjectLoadedFamilyIssue>> IssuesByFamilyId { get; } = new();

    /// <summary>What Revit posted in the throwaway evaluation, named by family and type; filled when the evaluation rolls back.</summary>
    public List<ProjectLoadedFamilyIssue> EvaluationIssues { get; } = [];

    private readonly List<(bool IsError, string Message, IReadOnlyList<long> ElementIds)> _failures = [];
    private DocumentSandbox? _sandbox;
    public Transaction? EvaluationTransaction => this._sandbox?.Transaction;
    public int PlacementAttempts { get; internal set; }
    public int PlacementSuccesses { get; internal set; }

    public void Dispose() {
        if (this._disposed)
            return;

        this.RollBackTransaction();
        this._disposed = true;
    }

    public IReadOnlyList<TempPlacedSymbolRecord> GetPlacedInstancesForFamily(long familyId) =>
        this.TempPlacementsByFamilyId.TryGetValue(familyId, out var placements)
            ? placements
            : [];

    public IReadOnlyList<TempPlacedSymbolRecord> GetPlacedInstancesForCategory(ElementId categoryId) =>
        this.TempPlacementsByCategoryId.TryGetValue(categoryId, out var placements)
            ? placements
            : [];

    public void BeginTransaction(string transactionName) {
        if (this._sandbox != null)
            throw new InvalidOperationException("Evaluation transaction is already active.");

        this._failures.Clear();
        this.EvaluationIssues.Clear();
        this._sandbox = PeToolsFailureHandling.BeginReadSandbox(this.ProjectDocument, transactionName, this._failures);
        this.ResetPlacementState();
    }

    public void RollBackTransaction() {
        if (this._sandbox is null) {
            this.ResetPlacementState();
            return;
        }
        // Read the placements before they are reset: a failing element id names the temp instance, so its family and type.
        var placements = this.TempPlacementsBySymbolId.Values.ToDictionary(p => p.InstanceId.Value());
        this._sandbox.Dispose();
        this._sandbox = null;
        foreach (var (isError, message, elementIds) in this._failures) {
            List<TempPlacedSymbolRecord?> named = [.. elementIds.Where(placements.ContainsKey).Select(id => placements[id]).Distinct()];
            foreach (var placement in named.Count == 0 ? [null] : named) {
                var family = placement is null ? null : this.FamiliesById[placement.FamilyId].Name;
                var subject = placement is null ? "The throwaway evaluation" : $"Evaluation of '{family}' type '{placement.SymbolName}'";
                this.EvaluationIssues.Add(new ProjectLoadedFamilyIssue(
                    isError ? "FamilyEvaluationRolledBack" : "FamilyEvaluationWarning",
                    isError ? ProjectLoadedFamilyIssueSeverity.Error : ProjectLoadedFamilyIssueSeverity.Warning,
                    isError ? $"{subject} rolled back: Revit posted '{message}'. Values read from it may not be regenerated."
                        : $"{subject}: Revit warned '{message}' (acknowledged).",
                    family, placement?.SymbolName, null));
            }
        }
        this.ResetPlacementState();
    }

    internal void AddIssue(long familyId, ProjectLoadedFamilyIssue issue) {
        if (!this.IssuesByFamilyId.TryGetValue(familyId, out var issues)) {
            issues = [];
            this.IssuesByFamilyId[familyId] = issues;
        }

        issues.Add(issue);
    }

    internal void RegisterPlacement(TempPlacedSymbolRecord placement) {
        this.TempPlacementsBySymbolId[placement.SymbolId] = placement;

        if (!this.TempPlacementsByFamilyId.TryGetValue(placement.FamilyId, out var familyPlacements)) {
            familyPlacements = [];
            this.TempPlacementsByFamilyId[placement.FamilyId] = familyPlacements;
        }

        familyPlacements.Add(placement);

        if (!this.TempPlacementsByCategoryId.TryGetValue(placement.CategoryId, out var categoryPlacements)) {
            categoryPlacements = [];
            this.TempPlacementsByCategoryId[placement.CategoryId] = categoryPlacements;
        }

        categoryPlacements.Add(placement);
    }

    private void ResetPlacementState() {
        this.TempPlacementsBySymbolId.Clear();
        this.TempPlacementsByFamilyId.Clear();
        this.TempPlacementsByCategoryId.Clear();
        this.IssuesByFamilyId.Clear();
        this.PlacementAttempts = 0;
        this.PlacementSuccesses = 0;
    }
}

public sealed record TempPlacedSymbolRecord(
    long FamilyId,
    long SymbolId,
    string SymbolName,
    ElementId CategoryId,
    ElementId InstanceId,
    FamilyInstance Instance,
    bool PlacementSucceeded
);

internal sealed class ElementIdEqualityComparer : IEqualityComparer<ElementId> {
    public static ElementIdEqualityComparer Instance { get; } = new();

    public bool Equals(ElementId? x, ElementId? y) =>
        x?.Value() == y?.Value();

    public int GetHashCode(ElementId obj) =>
        obj.Value().GetHashCode();
}
