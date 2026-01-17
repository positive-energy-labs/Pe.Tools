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
    MakeRefPlaneAndDimsSettings settings,
    Dictionary<string, Dictionary<string, string>>? perTypeValuesToRestore = null)
    : OperationGroup<MakeRefPlaneAndDimsSettings>("Create reference planes and dimensions for the family",
        InitializeOperations(settings, perTypeValuesToRestore ?? []),
        settings.MirrorSpecs.Select(s => s.ToString()).Concat(settings.OffsetSpecs.Select(s => s.ToString()))) {
    private static List<IOperation> InitializeOperations(
        MakeRefPlaneAndDimsSettings settings,
        Dictionary<string, Dictionary<string, string>> perTypeValuesToRestore
    ) {
        var sharedState = new SharedCreatorState { PerTypeValuesToRestore = perTypeValuesToRestore };
        return [
            new MakeRefPlanes(settings, sharedState),
            new MakeDimensions(settings, sharedState),
            new RestoreDeferredFormulas(settings, sharedState)
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
    public List<DeferredFormula> DeferredFormulas { get; } = [];

    /// <summary>
    ///     Per-type values for dimension-labeled params that need to be re-applied after labeling.
    ///     Key: param name, Value: dictionary of type name → value string.
    /// </summary>
    public Dictionary<string, Dictionary<string, string>> PerTypeValuesToRestore { get; init; } = [];
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
        // Plane creation doesn't need deferred formulas - pass empty list
        var creator = new RefPlaneDimCreator(doc, shared.Query, shared.Logs, []);

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
        var creator = new RefPlaneDimCreator(doc, shared.Query, shared.Logs, shared.DeferredFormulas);

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

/// <summary>
///     Third operation: restores formulas that were unset during dimension labeling.
///     This runs in a separate transaction after dimensions are committed.
/// </summary>
public class RestoreDeferredFormulas(MakeRefPlaneAndDimsSettings settings, SharedCreatorState shared)
    : DocOperation<MakeRefPlaneAndDimsSettings>(settings) {
    public override string Description => "Restore formulas and per-type values for dimension-labeled parameters";

    public override OperationLog Execute(
        FamilyDocument doc,
        FamilyProcessingContext processingContext,
        OperationContext groupContext
    ) {
        var logs = new List<LogEntry>();
        var fm = doc.FamilyManager;

        // 1. Restore formulas
        foreach (var deferred in shared.DeferredFormulas) {
            var param = fm.get_Parameter(deferred.ParamName);
            if (param == null) {
                logs.Add(new LogEntry($"Restore formula: {deferred.ParamName}").Error("Parameter not found"));
                continue;
            }

            var success = doc.TrySetFormula(param, deferred.Formula, out var error);
            logs.Add(success
                ? new LogEntry($"Restore formula: {deferred.ParamName}").Success($"= {deferred.Formula}")
                : new LogEntry($"Restore formula: {deferred.ParamName}").Error(error ?? "Unknown error"));
        }

        // 2. Restore per-type values (dimension labeling overwrites these)
        if (shared.PerTypeValuesToRestore.Count > 0) {
            var familyTypes = fm.Types.Cast<FamilyType>().ToList();

            foreach (var (paramName, typeValues) in shared.PerTypeValuesToRestore) {
                var param = fm.get_Parameter(paramName);
                if (param == null) {
                    logs.Add(new LogEntry($"Restore per-type: {paramName}").Error("Parameter not found"));
                    continue;
                }

                // Skip if param now has a formula (formula takes precedence)
                if (!string.IsNullOrEmpty(param.Formula)) {
                    logs.Add(new LogEntry($"Restore per-type: {paramName}").Skip("Has formula"));
                    continue;
                }

                var successCount = 0;
                foreach (var familyType in familyTypes) {
                    if (!typeValues.TryGetValue(familyType.Name, out var value)) continue;

                    try {
                        fm.CurrentType = familyType;
                        fm.SetValueString(param, value);
                        successCount++;
                    } catch (Exception ex) {
                        logs.Add(new LogEntry($"Restore per-type: {paramName} [{familyType.Name}]").Error(ex.Message));
                    }
                }

                if (successCount > 0) {
                    logs.Add(new LogEntry($"Restore per-type: {paramName}").Success($"Set {successCount} type values"));
                }
            }
        }

        if (logs.Count == 0) {
            logs.Add(new LogEntry("Deferred values").Skip("Nothing to restore"));
        }

        return new OperationLog(this.Name, logs);
    }
}
