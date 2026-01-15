using Pe.Extensions.FamDocument;
using Pe.FamilyFoundry.Helpers;
using Pe.FamilyFoundry.OperationSettings;

namespace Pe.FamilyFoundry.Operations;

/// <summary>
///     Operation group that creates reference planes and dimensions from MirrorSpecs and OffsetSpecs.
///     Split into two operations to ensure planes are committed before dimensioning.
/// </summary>
public class MakeRefPlanesAndDims(MakeRefPlaneAndDimsSettings settings) : OperationGroup<MakeRefPlaneAndDimsSettings>(
    "Create reference planes and dimensions for the family",
    InitializeOperations(settings),
    settings.MirrorSpecs.Select(s => s.ToString()).Concat(settings.OffsetSpecs.Select(s => s.ToString()))) {

    private static List<IOperation> InitializeOperations(MakeRefPlaneAndDimsSettings settings) {
        var sharedState = new SharedCreatorState();
        return [
            new MakeRefPlanes(settings, sharedState),
            new MakeDimensions(settings, sharedState)
        ];
    }
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
public class MakeRefPlanes : DocOperation<MakeRefPlaneAndDimsSettings> {
    private readonly SharedCreatorState _shared;

    public MakeRefPlanes(MakeRefPlaneAndDimsSettings settings, SharedCreatorState shared) : base(settings) =>
        _shared = shared;

    public override string Description => "Create reference planes for the family";

    public override OperationLog Execute(
        FamilyDocument doc,
        FamilyProcessingContext processingContext,
        OperationContext groupContext
    ) {
        this._shared.Logs = new List<LogEntry>();
        this._shared.Query = new PlaneQuery(doc);
        var creator = new RefPlaneDimCreator(doc, this._shared.Query, this._shared.Logs);

        // Create all planes first
        foreach (var spec in this.Settings.MirrorSpecs)
            creator.CreateMirrorPlanes(spec);

        foreach (var spec in this.Settings.OffsetSpecs)
            creator.CreateOffsetPlane(spec);

        return new OperationLog(this.Name, this._shared.Logs);
    }
}

/// <summary>
///     Second operation: creates all dimensions (after planes are committed).
/// </summary>
public class MakeDimensions : DocOperation<MakeRefPlaneAndDimsSettings> {
    private readonly SharedCreatorState _shared;

    public MakeDimensions(MakeRefPlaneAndDimsSettings settings, SharedCreatorState shared) : base(settings) =>
        _shared = shared;

    public override string Description => "Create dimensions for reference planes";

    public override OperationLog Execute(
        FamilyDocument doc,
        FamilyProcessingContext processingContext,
        OperationContext groupContext
    ) {
        // Re-query planes from the committed document
        this._shared.Query = new PlaneQuery(doc);
        this._shared.Logs ??= new List<LogEntry>();
        var creator = new RefPlaneDimCreator(doc, this._shared.Query, this._shared.Logs);

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

        return new OperationLog(this.Name, this._shared.Logs);
    }
}
