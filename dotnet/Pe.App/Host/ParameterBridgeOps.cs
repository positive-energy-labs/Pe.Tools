using Pe.Revit.DocumentData.Parameters;
using Pe.Revit.Operations;
using Pe.Revit.Ui.Core;
using Pe.Shared.HostContracts.Operations;
using Pe.Shared.RevitData;

namespace Pe.App.Host;

/// <summary>
///     The direct parameter write edge, for parameters no schedule shows. Same safety as `schedule.cells.apply`: every
///     wet edit carries the evidence it was reviewed against, the domain compares it to a fresh read inside its
///     transaction, and conflicting aliases refuse. A refused edit is an answer, never a reason to retry by name.
/// </summary>
internal static class ParameterBridgeOps {
    [Op("revit.apply.parameter-values", Does = "Write element parameter values in one transaction, including parameters no schedule shows. Read first: a dry run resolves each edit (parameterId exactly, or parameterName for discovery) and returns its current evidence (element, parameter, storage, read-only, hasValue, raw value). A wet run addresses each edit by parameterId and carries that evidence as expected; stale or missing evidence refuses the edit, identical edits to one parameter write once, and differing edits to one parameter refuse together.", Title = "Apply Parameter Values", Finds = ["parameters", "apply", "mutation", "elements", "unscheduled", "evidence", "expected", "write"], Intent = OpIntent.Mutate, Actor = OpActor.Any, Cost = OpCost.Mutation, Example = "{ \"dryRun\": true, \"edits\": [{ \"elementId\": 12345, \"parameterName\": \"Mark\", \"value\": \"AHU-1\" }] }")]
    private static Task<ParameterValueApplyData> Apply(ParameterValueApplyRequest request, RevitDocument document, CancellationToken cancellationToken) =>
        PaletteThreading.RunRevitAsync(() => {
            if (!request.DryRun && document.Value.IsReadOnly)
                throw BridgeOperationExceptions.Conflict("The document is read-only. Open a writable document, or dry-run to read evidence.");
            if (!request.DryRun)
                EngineEdge.RequireReachableCentral(document.Value);
            try { return ParameterValueApplier.Apply(document.Value, request); }
            catch (ArgumentException exception) { throw BridgeOperationExceptions.BadRequest(exception.Message); }
        }, cancellationToken);
}
