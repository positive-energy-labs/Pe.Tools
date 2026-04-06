using Pe.Revit.Extensions.FamDocument;
using Pe.FamilyFoundry.Helpers;
using Pe.FamilyFoundry.OperationSettings;

namespace Pe.FamilyFoundry.Operations;

/// <summary>
///     Creates reference planes and dimensions from resolved ParamDrivenSolids plane plans.
/// </summary>
public class MakeParamDrivenPlanesAndDims(
    MakeParamDrivenPlanesAndDimsSettings settings)
    : OperationGroup<MakeParamDrivenPlanesAndDimsSettings>(
        "Create reference planes and dimensions for the family",
        InitializeOperations(settings),
        settings.SymmetricPairs
            .Select(spec => $"{spec.PlaneNameBase} @ {spec.CenterPlaneName}")
            .Concat(settings.Offsets.Select(spec => $"{spec.PlaneName} @ {spec.AnchorPlaneName}"))) {
    private static List<IOperation> InitializeOperations(
        MakeParamDrivenPlanesAndDimsSettings settings
    ) {
        var sharedState = new SharedCreatorState();
        return [
            new MakeParamDrivenPlanes(settings, sharedState),
            new MakeParamDrivenDimensions(settings, sharedState)
        ];
    }
}

/// <summary>
///     Caches ReferencePlane lookups by name for performance.
/// </summary>
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

public class MakeParamDrivenPlanes(MakeParamDrivenPlanesAndDimsSettings settings, SharedCreatorState shared)
    : DocOperation<MakeParamDrivenPlanesAndDimsSettings>(settings) {
    public override string Description => "Create reference planes for the family";

    public override OperationLog Execute(
        FamilyDocument doc,
        FamilyProcessingContext processingContext,
        OperationContext groupContext
    ) {
        shared.Logs = new List<LogEntry>();
        shared.Query = new PlaneQuery(doc);

        var creator = new RefPlaneDimCreator(doc, shared.Query, shared.Logs);
        var pendingPairs = this.Settings.SymmetricPairs.ToList();
        var pendingOffsets = this.Settings.Offsets.ToList();

        while (pendingPairs.Count > 0 || pendingOffsets.Count > 0) {
            var createdThisPass = false;

            for (var index = pendingPairs.Count - 1; index >= 0; index--) {
                var spec = pendingPairs[index];
                if (shared.Query.Get(spec.CenterPlaneName) == null)
                    continue;

                creator.CreateSymmetricPlanes(spec);
                pendingPairs.RemoveAt(index);
                createdThisPass = true;
            }

            for (var index = pendingOffsets.Count - 1; index >= 0; index--) {
                var spec = pendingOffsets[index];
                if (shared.Query.Get(spec.AnchorPlaneName) == null)
                    continue;

                creator.CreateOffsetPlane(spec);
                pendingOffsets.RemoveAt(index);
                createdThisPass = true;
            }

            if (createdThisPass)
                continue;

            break;
        }

        foreach (var spec in pendingPairs)
            shared.Logs.Add(new LogEntry($"Symmetric planes: {spec.PlaneNameBase} @ {spec.CenterPlaneName}")
                .Error("Center anchor was not available after heuristic dependency ordering."));

        foreach (var spec in pendingOffsets)
            shared.Logs.Add(new LogEntry($"Offset plane: {spec.PlaneName}")
                .Error($"Anchor '{spec.AnchorPlaneName}' was not available after heuristic dependency ordering."));

        return new OperationLog(this.Name, shared.Logs);
    }
}

public class MakeParamDrivenDimensions(MakeParamDrivenPlanesAndDimsSettings settings, SharedCreatorState shared)
    : DocOperation<MakeParamDrivenPlanesAndDimsSettings>(settings) {
    public override string Description => "Create dimensions for reference planes";

    public override OperationLog Execute(
        FamilyDocument doc,
        FamilyProcessingContext processingContext,
        OperationContext groupContext
    ) {
        shared.Query = new PlaneQuery(doc);
        shared.Logs ??= new List<LogEntry>();
        var creator = new RefPlaneDimCreator(doc, shared.Query, shared.Logs);

        var staggerIndex = 0;

        foreach (var spec in this.Settings.SymmetricPairs) {
            creator.CreateSymmetricDimensions(spec, staggerIndex);
            staggerIndex += 2;
        }

        foreach (var spec in this.Settings.Offsets) {
            creator.CreateOffsetDimension(spec, staggerIndex);
            staggerIndex++;
        }

        return new OperationLog(this.Name, shared.Logs);
    }
}
