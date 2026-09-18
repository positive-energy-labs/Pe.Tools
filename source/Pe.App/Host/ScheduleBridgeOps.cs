using Autodesk.Revit.DB;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using Pe.App.Pods;
using Pe.Revit.DocumentData.Schedules;
using Pe.Revit.Failures;
using Pe.Revit.DocumentData.Schedules.Runtime;
using Pe.Revit.Extensions.ProjDocument;
using Pe.Revit.Operations;
using Pe.Revit.Scripting.Pods;
using Pe.Revit.Global.Services.Document;
using Pe.Revit.SettingsRuntime.Json;
using Pe.Revit.SettingsRuntime.Json.ContractResolvers;
using Pe.Revit.SettingsRuntime.Modules;
using Pe.Revit.SettingsRuntime.Modules.Schedules;
using Pe.Revit.Ui.Core;
using Pe.Shared.HostContracts.Operations;
using Pe.Shared.HostContracts.Scripting;
using System.IO;
using System.Diagnostics;
using SharedScheduleProfile = Pe.Shared.RevitData.Schedules.ScheduleProfile;

namespace Pe.App.Host;

/// <summary>Schedule definitions: capture one as a spec, apply a spec as a new schedule. Cell values are the grid's `push`.</summary>
internal static class ScheduleBridgeOps {
    [Op("schedule.capture", Does = "Capture one schedule's definition (fields, sort/group, filters, header groups, view template) as a schedule spec. Never captures cell values.", Title = "Capture Schedule", Finds = ["schedule", "capture", "spec", "definition"], Cost = OpCost.Bounded)]
    private static Task<ScheduleSpecCaptureData> Capture(ScheduleSpecCaptureRequest request, ProjectDocument document, CancellationToken cancellationToken) =>
        PaletteThreading.RunRevitAsync(() => {
            if (document.Value.GetElement(request.ScheduleId.ToElementId()) is not ViewSchedule schedule)
                throw BridgeOperationExceptions.BadRequest($"Element id {request.ScheduleId} is not a schedule.");
            return new ScheduleSpecCaptureData(schedule.Name, CaptureSpec(schedule));
        }, cancellationToken);

    [Op("schedule.apply", Does = "Create a new schedule from a saved schedule spec and write the run receipt into the source pod. Never edits an existing schedule.", Title = "Apply Schedule", Finds = ["schedule", "apply", "spec", "create", "receipt"], Intent = OpIntent.Mutate, Cost = OpCost.Mutation)]
    private static Task<ScheduleSpecApplyData> Apply(ScheduleSpecApplyRequest request, ProjectDocument document, CancellationToken cancellationToken) =>
        PaletteThreading.RunRevitAsync(() => {
            try {
                var spec = ModuleSettingsStorage<SharedScheduleProfile>.ReadPrepared(request.SpecJson, request.SpecJson, $"{request.Source.Pod}:{request.Source.Path}");
                return ApplySpec(document.Value, spec, request.SpecJson, request.Source).Data;
            } catch (JsonValidationException exception) {
                throw BridgeOperationExceptions.BadRequest(string.Join(Environment.NewLine, exception.ValidationErrors));
            } catch (Exception exception) when (exception is InvalidDataException or DirectoryNotFoundException or FileNotFoundException) {
                throw BridgeOperationExceptions.Conflict(exception.Message);
            }
        }, cancellationToken);

    /// <summary>The spec a capture writes: the authored profile plus the `$schema` that says what it is.</summary>
    internal static string CaptureSpec(ViewSchedule schedule) {
        var spec = JObject.Parse(JsonConvert.SerializeObject(schedule.CaptureAuthoredScheduleProfile(), RevitJsonFormatting.CreateRevitIndentedSettings()));
        spec.AddFirst(new JProperty("$schema", PodMembers.SchemaUrl(ScheduleManagerSettingsRegistration.Profiles)));
        return spec.ToString(Formatting.Indented);
    }

    /// <summary>The one apply edge for bridge op and palette: new schedule, then the run in the source pod.</summary>
    internal static (ScheduleSpecApplyData Data, ScheduleCreationResult Result) ApplySpec(Document document, SharedScheduleProfile spec, string specJson, PodMemberSource source) {
        var podFolder = PodMembers.VerifiedFolder(source);
        EngineEdge.RequireReachableCentral(document);
        var run = PodRuns.NewRunFolder(podFolder);
        var inputOutputs = PodRuns.WriteInputIn(run, new {
            operation = "schedule.apply",
            source,
            target = DocumentTarget(document),
            unavailableEvidence = new[] { "authored root bytes", "dependency bytes", "reviewed draft revision" }
        }, specJson);
        var handled = new List<(bool IsError, string Message)>();
        ScheduleCreationResult result;
        try {
            result = EngineEdge.NoModal(handled, () => {
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
            _ = PodRuns.WriteReceiptIn(run, new PodReceipt(source.Pod, source.Path, source.Sha256, "schedule.apply", null, "Failed", inputOutputs, exception.Message),
                EngineEdge.WarningsOutput(handled));
            throw;
        }
        var skipped = result.SkippedFields.Concat(result.SkippedSortGroups).Concat(result.SkippedFilters).Concat(result.SkippedHeaderGroups)
            .Concat(result.SkippedCalculatedFields.Select(f => $"Calculated field '{f.FieldName}' needs manual creation: {f.Guidance}"))
            .Concat(result.SkippedViewTemplate is { } template ? [$"View template: {template}"] : [])
            .Concat(result.FilterBySheetSkipped is { } sheet ? [$"Filter by sheet: {sheet}"] : [])
            .ToList();
        var resultJson = System.Text.Encoding.UTF8.GetBytes(JsonConvert.SerializeObject(ResultReport(result), Formatting.Indented));
        var receiptPath = PodRuns.WriteReceiptIn(run,
            new PodReceipt(source.Pod, source.Path, source.Sha256, "schedule.apply", null, "Succeeded", [.. inputOutputs, $"schedule:{result.Schedule.Id.Value()}"], null),
            [("result.json", resultJson), .. EngineEdge.WarningsOutput(handled)]);
        return (new ScheduleSpecApplyData(result.Schedule.Id.Value(), result.ScheduleName, result.AppliedFields.Count, skipped, result.Warnings, receiptPath), result);
    }

    private static object DocumentTarget(Document document) {
        var tracked = DocumentTrackerAccessor.Current?.Find(document);
        return new {
            kind = "project-document",
            openId = tracked?.OpenId(),
            document.Title,
            path = string.IsNullOrWhiteSpace(document.PathName) ? null : document.PathName,
            process = ProcessEvidence(),
            unavailableEvidence = tracked is null ? new[] { "document tracker openId" } : Array.Empty<string>()
        };
    }

    private static object ProcessEvidence() {
        using var process = Process.GetCurrentProcess();
        return new { processId = process.Id, processStartUtc = process.StartTime.ToUniversalTime() };
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
