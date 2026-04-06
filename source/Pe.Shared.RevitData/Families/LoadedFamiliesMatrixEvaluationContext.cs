using Pe.RevitData.PolyFill;
    
namespace Pe.RevitData.Families;

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
    public Transaction? EvaluationTransaction { get; private set; }
    public int PlacementAttempts { get; internal set; }
    public int PlacementSuccesses { get; internal set; }

    public IReadOnlyList<TempPlacedSymbolRecord> GetPlacedInstancesForFamily(long familyId) =>
        this.TempPlacementsByFamilyId.TryGetValue(familyId, out var placements)
            ? placements
            : [];

    public IReadOnlyList<TempPlacedSymbolRecord> GetPlacedInstancesForCategory(ElementId categoryId) =>
        this.TempPlacementsByCategoryId.TryGetValue(categoryId, out var placements)
            ? placements
            : [];

    public void BeginTransaction(string transactionName) {
        if (this.EvaluationTransaction?.HasStarted() == true)
            throw new InvalidOperationException("Evaluation transaction is already active.");

        this.EvaluationTransaction = new Transaction(this.ProjectDocument, transactionName);
        _ = this.EvaluationTransaction.Start();
        this.ResetPlacementState();
    }

    public void RollBackTransaction() {
        if (this.EvaluationTransaction?.HasStarted() == true)
            _ = this.EvaluationTransaction.RollBack();

        this.EvaluationTransaction?.Dispose();
        this.EvaluationTransaction = null;
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

    public void Dispose() {
        if (this._disposed)
            return;

        this.RollBackTransaction();
        this._disposed = true;
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
