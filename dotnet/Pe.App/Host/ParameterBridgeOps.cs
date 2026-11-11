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
    [Op("revit.apply.parameter-values", OpSubject.Elements, OpTouches.Metadata, OpEffect.ModelWrite, Internal = true, Does = "Write element parameter values in one transaction, including parameters no schedule shows. Read first: a dry run resolves each edit (parameterId exactly, or parameterName for discovery) and returns its current evidence (element, parameter, storage, read-only, hasValue, raw value). A wet run addresses each edit by parameterId and carries that evidence as expected; stale or missing evidence refuses the edit, identical edits to one parameter write once, and differing edits to one parameter refuse together.", Title = "Apply Parameter Values", Finds = ["parameters", "apply", "mutation", "elements", "unscheduled", "evidence", "expected", "write"], Intent = OpIntent.Mutate, Actor = OpActor.Any, Cost = OpCost.Mutation, Example = "{ \"dryRun\": true, \"edits\": [{ \"elementId\": 12345, \"parameterName\": \"Mark\", \"value\": \"AHU-1\" }] }")]
    private static Task<ParameterValueApplyData> Apply(ParameterValueApplyRequest request, RevitDocument document, CancellationToken cancellationToken) =>
        PaletteThreading.RunRevitAsync(() => {
            // The mode is the entry (ADR 0028): the evidence read is revit.detail.parameter-values.
            if (request.DryRun)
                throw BridgeOperationExceptions.BadRequest("This entry writes; read evidence through revit.detail.parameter-values.");
            if (document.Value.IsReadOnly)
                throw BridgeOperationExceptions.Conflict("The document is read-only. Open a writable document, or plan to read evidence.");
            EngineEdge.RequireReachableCentral(document.Value);
            try { return ParameterValueApplier.Apply(document.Value, request); }
            catch (ArgumentException exception) { throw BridgeOperationExceptions.BadRequest(exception.Message); }
        }, cancellationToken);

    [Op("revit.detail.parameter-values", OpSubject.Elements, OpTouches.Metadata, OpEffect.Read, Internal = true, Does = "Read the evidence revit.apply.parameter-values needs, without a transaction: resolve each edit (element by UniqueId or ElementId; parameterId exactly, or parameterName), parse its value in the parameter's units, and return Current per edit (element, parameter id, storage, read-only, hasValue, raw value) and the parsed raw and display values. Send Current back as each wet edit's expected.", Title = "Plan Parameter Values", Finds = ["parameters", "plan", "evidence", "elements", "dry run"], Actor = OpActor.Any, Cost = OpCost.Bounded, Example = "{ \"edits\": [{ \"elementId\": 0, \"uniqueId\": \"<UniqueId>\", \"parameterName\": \"Diameter\", \"value\": \"25\", \"unit\": \"Millimeters\" }] }")]
    private static Task<ParameterValueApplyData> Plan(ParameterValueApplyRequest request, RevitDocument document, CancellationToken cancellationToken) =>
        PaletteThreading.RunRevitAsync(() => {
            try { return ParameterValueApplier.Apply(document.Value, request with { DryRun = true }); }
            catch (ArgumentException exception) { throw BridgeOperationExceptions.BadRequest(exception.Message); }
        }, cancellationToken);
}
