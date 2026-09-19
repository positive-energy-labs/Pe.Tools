using Autodesk.Revit.DB;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using Pe.App.Pods;
using Pe.Revit.DocumentData.Schedules;
using Pe.Revit.DocumentData.Schedules.Apply;
using Pe.Revit.Failures;
using Pe.Revit.DocumentData.Schedules.Runtime;
using Pe.Revit.Extensions.ProjDocument;
using Pe.Revit.Operations;
using Pe.Revit.Scripting.Pods;
using Pe.Revit.SettingsRuntime.Json;
using Pe.Revit.SettingsRuntime.Json.ContractResolvers;
using Pe.Revit.SettingsRuntime.Modules;
using Pe.Revit.SettingsRuntime.Modules.Schedules;
using Pe.Revit.Ui.Core;
using Pe.Shared.HostContracts.Operations;
using Pe.Shared.HostContracts.Scripting;
using System.IO;
using Pe.Shared.RevitData.Schedules;
using SharedScheduleProfile = Pe.Shared.RevitData.Schedules.ScheduleProfile;

namespace Pe.App.Host;

/// <summary>Schedule definitions (capture one as a spec, apply a spec as a new schedule) and reviewed cell values (`schedule.cells.apply`).</summary>
internal static class ScheduleBridgeOps {
    [Op("schedule.capture", Does = "Capture one schedule's definition (fields, sort/group, filters, header groups, view template) as a schedule spec. Never captures cell values.", Title = "Capture Schedule", Finds = ["schedule", "capture", "spec", "definition"], Cost = OpCost.Bounded)]
    private static Task<ScheduleSpecCaptureData> Capture(ScheduleSpecCaptureRequest request, ProjectDocument document, CancellationToken cancellationToken) =>
        PaletteThreading.RunRevitAsync(() => {
            if (document.Value.GetElement(request.ScheduleId.ToElementId()) is not ViewSchedule schedule)
                throw BridgeOperationExceptions.BadRequest($"Element id {request.ScheduleId} is not a schedule.");
            return new ScheduleSpecCaptureData(schedule.Name, CaptureSpec(schedule));
        }, cancellationToken);

    /// <summary>
    ///     The one reviewed-cell write edge. The domain compares every reviewed target against a fresh read inside its
    ///     transaction and answers per cell; a refused cell is an answer, never a reason to retry by parameter name.
    ///     The host journal seals this exact request as the step input before dispatch.
    /// </summary>
    [Op("schedule.cells.apply", Does = "Write reviewed schedule cells by their exact reviewed bindings (target element id, parameter id, storage, read-only, hasValue, raw value) in one transaction. Stale, missing, blocked, or conflicting evidence refuses per cell; results keep the request cell index and each cell's own target index.", Title = "Apply Schedule Cells", Finds = ["schedule", "cells", "apply", "binding", "reviewed", "write"], Intent = OpIntent.Mutate, Cost = OpCost.Mutation, Actor = OpActor.Human)]
    private static Task<ScheduleCellApplyData> ApplyCells(ScheduleCellApplyRequest request, ProjectDocument document, CancellationToken cancellationToken) =>
        PaletteThreading.RunRevitAsync(() => {
            if (!request.DryRun && document.Value.IsReadOnly)
                throw BridgeOperationExceptions.Conflict("The document is read-only.");
            EngineEdge.RequireReachableCentral(document.Value);
            try { return document.Value.ApplyReviewedScheduleCells(request, cancellationToken); }
            catch (ArgumentException exception) { throw BridgeOperationExceptions.BadRequest(exception.Message); }
        }, cancellationToken);

    [Op("schedule.apply", Does = "Create a new schedule from a saved schedule spec and write the run receipt into the source pod. Never edits an existing schedule.", Title = "Apply Schedule", Finds = ["schedule", "apply", "spec", "create", "receipt"], Intent = OpIntent.Mutate, Cost = OpCost.Mutation, Actor = OpActor.Human)]
    private static Task<ScheduleSpecApplyData> Apply(ScheduleSpecApplyRequest request, ProjectDocument document, CancellationToken cancellationToken) =>
        PaletteThreading.RunRevitAsync(() => {
            try {
                return ApplySpec(document.Value, request.SpecJson, request.Source).Data;
            } catch (JsonValidationException exception) {
                throw BridgeOperationExceptions.BadRequest(string.Join(Environment.NewLine, exception.ValidationErrors));
            }
        }, cancellationToken);

    /// <summary>The spec a capture writes: the authored profile plus the `$schema` that says what it is.</summary>
    internal static string CaptureSpec(ViewSchedule schedule) {
        var spec = JObject.Parse(JsonConvert.SerializeObject(schedule.CaptureAuthoredScheduleProfile(), RevitJsonFormatting.CreateRevitIndentedSettings()));
        spec.AddFirst(new JProperty("$schema", PodMembers.SchemaUrl(ScheduleManagerSettingsRegistration.Profiles)));
        return spec.ToString(Formatting.Indented);
    }

    /// <summary>
    ///     The one apply edge for bridge op and palette: new schedule, then the run in the source pod. The profile is
    ///     read here from the exact JSON the run records, so the recorded input is what the engine consumed.
    /// </summary>
    internal static (ScheduleSpecApplyData Data, ScheduleCreationResult Result) ApplySpec(Document document, string specJson, PodComposedSource composed) {
        var source = composed.Root;
        var spec = ModuleSettingsStorage<SharedScheduleProfile>.ReadPrepared(
            System.Text.Encoding.UTF8.GetString(Convert.FromBase64String(source.BytesBase64)), specJson, $"{source.Id}:{source.Path}");
        EngineEdge.RequireReachableCentral(document);
        var (run, inputOutputs) = EngineEdge.StartRun(composed, new {
            operation = "schedule.apply",
            target = EngineEdge.RunTarget(document)
        }, specJson);
        var handled = new List<(bool IsError, string Message)>();
        ScheduleCreationResult result;
        try {
            result = RevitDialogs.NoModal(handled, () => {
                using var transaction = new Transaction(document, $"Apply Schedule: {spec.Name}");
                _ = transaction.Start();
                // The verdict's other half: warnings are resolved and recorded here, never shown.
                var options = transaction.GetFailureHandlingOptions();
                _ = options.SetFailuresPreprocessor(PeToolsFailureHandling.CreatePreprocessor(handled));
                _ = options.SetClearAfterRollback(true);
                _ = options.SetForcedModalHandling(true);
                transaction.SetFailureHandlingOptions(options);
                var created = document.ApplyScheduleProfile(spec);
                if (transaction.Commit() != TransactionStatus.Committed)
                    throw new InvalidOperationException($"Apply Schedule '{spec.Name}' did not commit. Revit posted: {string.Join("; ", handled.Where(h => h.IsError).Select(h => h.Message).DefaultIfEmpty("no message"))}");
                return created;
            });
        } catch (Exception exception) {
            // The transaction rolled back; an unsaved failure receipt must not replace the failure itself.
            _ = PodRuns.SettleReceiptIn(run, PodReceipt.ForSource(source, "schedule.apply", null, PodRunOutcome.Failed, inputOutputs, exception.Message),
                EngineEdge.WarningsOutput(handled));
            throw;
        }
        var skipped = result.SkippedFields.Concat(result.SkippedSortGroups).Concat(result.SkippedFilters).Concat(result.SkippedHeaderGroups)
            .Concat(result.SkippedCalculatedFields.Select(f => $"Calculated field '{f.FieldName}' needs manual creation: {f.Guidance}"))
            .Concat(result.SkippedViewTemplate is { } template ? [$"View template: {template}"] : [])
            .Concat(result.FilterBySheetSkipped is { } sheet ? [$"Filter by sheet: {sheet}"] : [])
            .ToList();
        var resultJson = System.Text.Encoding.UTF8.GetBytes(JsonConvert.SerializeObject(ResultReport(result), Formatting.Indented));
        var (receiptPath, unsaved) = PodRuns.SettleReceiptIn(run,
            PodReceipt.ForSource(source, "schedule.apply", null, PodRunOutcome.Succeeded, [.. inputOutputs, $"schedule:{result.Schedule.Id.Value()}"], null),
            [("result.json", resultJson), .. EngineEdge.WarningsOutput(handled)]);
        return (new ScheduleSpecApplyData(result.Schedule.Id.Value(), result.ScheduleName, result.AppliedFields.Count, skipped,
            unsaved is null ? result.Warnings : [.. result.Warnings, unsaved], receiptPath), result);
    }

    private static object ResultReport(ScheduleCreationResult result) => new {
        result.ScheduleName,
        result.CategoryName,
        result.IsItemized,
        result.FilterBySheetApplied,
        result.FilterBySheetSkipped,
        AppliedFields = result.AppliedFields.Select(f => new { f.ParameterName, f.ColumnHeaderOverride, f.IsHidden, f.ColumnWidth, DisplayType = f.DisplayType.ToString() }).ToList(),
        result.SkippedFields,
        AppliedSortGroups = result.AppliedSortGroups.Select(sg => new { sg.FieldName, SortOrder = sg.SortOrder.ToString(), sg.ShowHeader, sg.ShowFooter, sg.ShowBlankLine }).ToList(),
        result.SkippedSortGroups,
        AppliedFilters = result.AppliedFilters.Select(f => new { f.FieldName, FilterType = f.FilterType.ToString(), f.Value, f.StorageType }).ToList(),
        result.SkippedFilters,
        result.AppliedHeaderGroups,
        result.SkippedHeaderGroups,
        CalculatedFields = result.SkippedCalculatedFields.Select(f => new { f.FieldName, f.CalculatedType, f.Guidance, f.PercentageOfField }).ToList(),
        result.AppliedViewTemplate,
        result.SkippedViewTemplate,
        result.Warnings
    };
}
