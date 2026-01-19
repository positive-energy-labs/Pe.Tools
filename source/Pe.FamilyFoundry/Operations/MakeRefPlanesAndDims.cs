using Pe.Extensions.FamDocument;
using Pe.FamilyFoundry.Helpers;
using Pe.FamilyFoundry.OperationSettings;
using System.Text.Json.Serialization;

namespace Pe.FamilyFoundry.Operations;

/// <summary>
///     Operation group that creates reference planes and dimensions from MirrorSpecs and OffsetSpecs.
///     Split into three operations to ensure proper transaction boundaries:
///     1. MakeRefPlanes - creates reference planes
///     2. MakeDimensions - creates dimensions and labels them (unsets formulas before labeling)
///     3. RestoreDeferredFormulas - restores formulas and re-applies per-type values
/// </summary>
public class MakeRefPlanesAndDims(
    MakeRefPlaneAndDimsSettings settings)
    : OperationGroup<MakeRefPlaneAndDimsSettings>("Create reference planes and dimensions for the family",
        InitializeOperations(settings),
        settings.MirrorSpecs.Select(s => s.ToString()).Concat(settings.OffsetSpecs.Select(s => s.ToString()))) {
    private static List<IOperation> InitializeOperations(
        MakeRefPlaneAndDimsSettings settings
    ) {
        var sharedState = new SharedCreatorState();
        return [
            new MakeRefPlanes(settings, sharedState),
            new MakeDimensions(settings, sharedState),
        ];
    }
}

/// <summary>
///     Caches ReferencePlane lookups by name for performance.
/// </summary>
[JsonConverter(typeof(JsonStringEnumConverter))]
public class PlaneQuery(Document doc) {
    private readonly Dictionary<string, ReferencePlane?> _cache = new();

    public ReferencePlane? Get(string name) {
        if (string.IsNullOrEmpty(name)) return null;
        if (this._cache.TryGetValue(name, out var value)) return value;
        value = new FilteredElementCollector(doc)
            .OfClass(typeof(ReferencePlane))
            .Cast<ReferencePlane>()
            .FirstOrDefault(rp => rp.Name == name);
        this._cache[name] = value;

        return value;
    }

    public ReferencePlane? ReCache(string name) =>
        string.IsNullOrEmpty(name)
            ? null
            : this._cache[name] = new FilteredElementCollector(doc)
                .OfClass(typeof(ReferencePlane))
                .Cast<ReferencePlane>()
                .FirstOrDefault(rp => rp.Name == name);
}


/// <summary>
///     Shared state between plane and dimension operations.
/// </summary>
public class SharedCreatorState {
    public PlaneQuery? Query { get; set; }
    public List<LogEntry>? Logs { get; set; }
}

/// <summary>
///     First operation: creates all reference planes.
/// </summary>
public class MakeRefPlanes(MakeRefPlaneAndDimsSettings settings, SharedCreatorState shared)
    : DocOperation<MakeRefPlaneAndDimsSettings>(settings) {
    public override string Description => "Create reference planes for the family";

    public override OperationLog Execute(
        FamilyDocument doc,
        FamilyProcessingContext processingContext,
        OperationContext groupContext
    ) {
        shared.Logs = new List<LogEntry>();
        shared.Query = new PlaneQuery(doc);

        var creator = new RefPlaneDimCreator(doc, shared.Query, shared.Logs);

        // Create all planes first
        foreach (var spec in this.Settings.MirrorSpecs)
            creator.CreateMirrorPlanes(spec);

        foreach (var spec in this.Settings.OffsetSpecs)
            creator.CreateOffsetPlane(spec);

        return new OperationLog(this.Name, shared.Logs);
    }
}

/// <summary>
///     Second operation: creates all dimensions (after planes are committed).
///     If a dimension is labeled with a formula-driven param, the formula is unset
///     and tracked in SharedCreatorState.DeferredFormulas for restoration in the next operation.
/// </summary>
public class MakeDimensions(MakeRefPlaneAndDimsSettings settings, SharedCreatorState shared)
    : DocOperation<MakeRefPlaneAndDimsSettings>(settings) {
    public override string Description => "Create dimensions for reference planes";

    public override OperationLog Execute(
        FamilyDocument doc,
        FamilyProcessingContext processingContext,
        OperationContext groupContext
    ) {
        // Re-query planes from the committed document
        shared.Query = new PlaneQuery(doc);
        shared.Logs ??= new List<LogEntry>();
        var creator = new RefPlaneDimCreator(doc, shared.Query, shared.Logs);

        var staggerIndex = 0;

        // Create dimensions for all specs
        foreach (var spec in this.Settings.MirrorSpecs) {
            creator.CreateMirrorDimensions(spec, staggerIndex);
            staggerIndex += 2; // Mirror uses 2 stagger slots (EQ dim + param dim)
        }

        foreach (var spec in this.Settings.OffsetSpecs) {
            creator.CreateOffsetDimension(spec, staggerIndex);
            staggerIndex++;
        }

        return new OperationLog(this.Name, shared.Logs);
    }
}
