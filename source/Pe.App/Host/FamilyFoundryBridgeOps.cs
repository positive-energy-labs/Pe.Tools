using Autodesk.Revit.DB;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using Pe.App.Pods;
using Pe.Revit;
using Pe.Revit.Extensions.ProjDocument;
using Pe.Revit.FamilyFoundry;
using Pe.Revit.FamilyFoundry.Apply;
using Pe.Revit.FamilyFoundry.Capture;
using Pe.Revit.FamilyFoundry.Reconcile;
using Pe.Revit.Extensions.FamDocument;
using Pe.Revit.Operations;
using Pe.Revit.Scripting.Pods;
using Pe.Revit.Global.Services.Document;
using Pe.Revit.Ui.Core;
using Pe.Shared.HostContracts.Operations;
using Pe.Shared.HostContracts.Scripting;
using Pe.Shared.RevitData;
using Pe.Shared.RevitData.Families;
using Pe.Shared.StorageRuntime;
using Pe.Shared.StorageRuntime.Modules;
using FamilyDocument = Pe.Revit.Operations.FamilyDocument;
using System.IO;
using System.Diagnostics;

namespace Pe.App.Host;

/// <summary>`family.*` acts on the active family document; `families.*` on loaded families in a project.</summary>
internal static class FamilyFoundryBridgeOps {
    [Op("family.capture", Does = "Capture the active Revit family document as a family.json spec, with per-section coverage and the unmodeled ledger.", Title = "Capture Family", Finds = ["family", "family-json", "capture", "spec", "coverage"], Cost = OpCost.Bounded)]
    private static Task<FamilyCaptureData> CaptureFamily(FamilyCaptureRequest _, FamilyDocument document, CancellationToken cancellationToken) =>
        PaletteThreading.RunRevitAsync(() => CaptureActiveFamily(document.Value), cancellationToken);

    [Op("family.plan", Does = "Diff an inline family spec (`{ select, patch, run }`) against the active family document and return the plan with a deterministic hash.", Title = "Plan Family", Finds = ["family", "spec", "plan", "plan-hash", "reconcile"], Cost = OpCost.Expensive)]
    private static Task<FamilyFoundryPlanData> PlanFamily(FamilyPlanRequest request, FamilyDocument document, CancellationToken cancellationToken) =>
        PaletteThreading.RunRevitAsync(() => PlanFamilies(request.SpecJson, document.Value, null, request.ExecutionOptions), cancellationToken);

    [Op("family.apply", Does = "Reconcile the active family document to a saved spec, refusing plan drift, and write the run receipt into the source pod.", Title = "Apply Family", Finds = ["family", "spec", "apply", "plan-hash", "receipt"], Intent = OpIntent.Mutate, Cost = OpCost.Mutation)]
    private static Task<FamilyFoundryApplyData> ApplyFamily(FamilyApplyRequest request, FamilyDocument document, CancellationToken cancellationToken) =>
        PaletteThreading.RunRevitAsync(() => RefuseStaleSource(() => ApplyWithReceipt("family.apply", request.SpecJson, request.Source,
            request.ExpectedPlanHashes, document.Value, request.ExecutionOptions, cancellationToken: cancellationToken)), cancellationToken);

    [Op("families.capture", Does = "Open selected loaded families read-only and capture each as a family.json spec with coverage.", Title = "Capture Loaded Families", Finds = ["families", "family-json", "capture", "spec", "coverage"], Cost = OpCost.Expensive)]
    private static Task<FamiliesCaptureData> CaptureLoaded(FamiliesCaptureRequest request, ProjectDocument document, CancellationToken cancellationToken) =>
        PaletteThreading.RunRevitAsync(() => CaptureFamilies(request.FamilyIds, document.Value), cancellationToken);

    [Op("families.plan", Does = "Diff an inline family spec against exactly the passed `familyIds` (the spec's `select` only when none are passed) and return the plan per family with a deterministic hash.", Title = "Plan Loaded Families", Finds = ["families", "spec", "plan", "plan-hash", "reconcile", "bulk"], Cost = OpCost.Expensive)]
    private static Task<FamilyFoundryPlanData> PlanLoaded(FamiliesPlanRequest request, ProjectDocument document, CancellationToken cancellationToken) =>
        PaletteThreading.RunRevitAsync(() => PlanFamilies(request.SpecJson, document.Value, request.FamilyIds, request.ExecutionOptions, cancellationToken), cancellationToken);

    [Op("families.apply", Does = "Reconcile explicit loaded families to a saved spec, refusing plan drift per family, and write the run receipt into the source pod.", Title = "Apply Loaded Families", Finds = ["families", "spec", "apply", "plan-hash", "receipt", "bulk"], Intent = OpIntent.Mutate, Cost = OpCost.Mutation)]
    private static Task<FamilyFoundryApplyData> ApplyLoaded(FamiliesApplyRequest request, ProjectDocument document, CancellationToken cancellationToken) =>
        PaletteThreading.RunRevitAsync(() => RefuseStaleSource(() => ApplyWithReceipt("families.apply", request.SpecJson, request.Source, request.ExpectedPlanHashes, document.Value, request.ExecutionOptions, cancellationToken: cancellationToken)), cancellationToken);

    [Op("family.build", Does = "Build a new Revit family from a saved family model spec by reconciling a fresh document from the spec's template. The .rfa lands in a fresh run folder in the source pod beside the run receipt; the operation returns both paths.", Title = "Build Family", Finds = ["family", "family-json", "build", "template", "spec", "receipt"], Intent = OpIntent.Mutate, Cost = OpCost.Mutation)]
    private static Task<FamilyBuildData> BuildFamily(FamilyBuildRequest request, CancellationToken cancellationToken) =>
        PaletteThreading.RunRevitAsync(() => RefuseStaleSource(() => BuildWithReceipt(RevitUiSession.CurrentUIApplication.Application, request)), cancellationToken);

    /// <summary>A cancelled apply is its own outcome — finished families keep their receipts.</summary>
    private const string CancelledCode = "Cancelled";

    private static T RefuseStaleSource<T>(Func<T> apply) {
        try { return apply(); }
        catch (Exception exception) when (exception is InvalidDataException or DirectoryNotFoundException or FileNotFoundException) {
            throw BridgeOperationExceptions.Conflict(exception.Message);
        }
    }

    /// <summary>
    ///     The one build edge: bridge op and palette both land here, and both leave a run in the source pod.
    ///     The run folder is the output folder — a build never writes outside the pod it came from, so there
    ///     is nothing to overwrite and no path to validate.
    /// </summary>
    internal static FamilyBuildData BuildWithReceipt(Autodesk.Revit.ApplicationServices.Application application, FamilyBuildRequest request) {
        var parsed = FamilyModelJson.Parse(request.SpecJson);
        if (parsed.Value == null || parsed.Diagnostics.Count != 0)
            throw BridgeOperationExceptions.BadRequest(string.Join(Environment.NewLine, parsed.Diagnostics.Select(item => $"{item.Path}: {item.Message}")));
        var podFolder = PodMembers.VerifiedFolder(request.Source);
        var run = PodRuns.NewRunFolder(podFolder);
        var inputOutputs = PodRuns.WriteInputIn(run, new {
            operation = "family.build",
            source = request.Source,
            target = new { kind = "new-family-document", process = ProcessEvidence(), revitVersion = application.VersionNumber },
            options = new { request.ModelDirectory },
            unavailableEvidence = new[] { "authored root bytes", "dependency bytes", "reviewed draft revision" }
        }, request.SpecJson);
        var outputPath = Path.Combine(run, $"{FileName(parsed.Value.Family.Name)}.rfa");
        var source = request.Source;
        var handled = new List<(bool IsError, string Message)>();
        try {
            var (receipt, templatePath, reading) = EngineEdge.NoModal(handled, () => FamilyModelBuild.BuildAndSave(application, parsed.Value, outputPath, true,
                request.ModelDirectory is null ? null : ResolvePath(request.ModelDirectory, nameof(request.ModelDirectory))));
            var receiptPath = PodRuns.WriteReceiptIn(run, new PodReceipt(source.Pod, source.Path, source.Sha256, "family.build",
                receipt.PlanHash, receipt.Converged ? "Succeeded" : "Failed", [.. inputOutputs, outputPath], null), EngineEdge.WarningsOutput(handled));
            return new FamilyBuildData(reading, parsed.Value.Family.Name, outputPath, templatePath, receipt.Converged, receipt.Residue.Count, receiptPath);
        } catch (Exception exception) when (exception is ArgumentException or InvalidOperationException or FileNotFoundException or DirectoryNotFoundException) {
            _ = PodRuns.WriteReceiptIn(run, new PodReceipt(source.Pod, source.Path, source.Sha256, "family.build", null, "Failed", inputOutputs, exception.Message), EngineEdge.WarningsOutput(handled));
            throw BridgeOperationExceptions.BadRequest(exception.Message);
        }
    }

    /// <summary>The family name as a file name; Revit admits characters a path does not.</summary>
    private static string FileName(string familyName) =>
        string.Join("_", familyName.Split(Path.GetInvalidFileNameChars(), StringSplitOptions.RemoveEmptyEntries)) is { Length: > 0 } name
            ? name : "family";

    private static string ResolvePath(string? path, string field) {
        if (string.IsNullOrWhiteSpace(path)) throw BridgeOperationExceptions.BadRequest($"{field} is required.");
        try { return Path.GetFullPath(path); }
        catch (Exception exception) when (exception is ArgumentException or NotSupportedException or PathTooLongException) {
            throw BridgeOperationExceptions.BadRequest($"{field} is invalid: {exception.Message}");
        }
    }

    internal static FamilyCaptureData CaptureActiveFamily(Document document) {
        var model = document.CaptureFamilyModel();
        return new FamilyCaptureData(DateTime.UtcNow.ToString("O"), model.Family.Name, FamilyModelJson.Serialize(model),
            model.Unmodeled.Count, model.Coverage.ToDictionary(p => p.Key, p => p.Value.ToString()), model.CaptureIssues);
    }

    /// <summary>The one apply edge: bridge ops and palettes both land here, and both leave a run in the source pod.</summary>
    internal static FamilyFoundryApplyData ApplyWithReceipt(string operation, string specJson, PodMemberSource source,
        IReadOnlyDictionary<long, string> expectedPlanHashes, Document document, ExecutionOptions? executionOptions, LoadAndSaveOptions? loadAndSave = null,
        CancellationToken cancellationToken = default) {
        var podFolder = PodMembers.VerifiedFolder(source);
        EngineEdge.RequireReachableCentral(document);
        var run = PodRuns.NewRunFolder(podFolder);
        var inputOutputs = PodRuns.WriteInputIn(run, new {
            operation,
            source,
            target = DocumentTarget(document),
            executionOptions,
            selectedFamilyIds = expectedPlanHashes.Keys.OrderBy(id => id).ToList(),
            expectedPlanHashes,
            loadAndSave,
            unavailableEvidence = new[] { "authored root bytes", "dependency bytes", "reviewed draft revision" }
        }, specJson);
        var handled = new List<(bool IsError, string Message)>();
        var artifacts = Path.Combine(Path.GetTempPath(), "Pe.Tools", "family-apply", Guid.NewGuid().ToString("N"));
        try {
            var data = EngineEdge.NoModal(handled, () => ApplyFamilies(specJson, expectedPlanHashes, document, executionOptions, loadAndSave, artifacts, cancellationToken));
            var failures = Failures(data);
            var relative = data with {
                Reason = Reason(data, failures),
                Receipts = data.Receipts.Select(r => r with { ArtifactDirectory = r.ArtifactDirectory is { } dir ? RunPath(artifacts, dir) : null }).ToList()
            };
            var outputs = (Directory.Exists(artifacts) ? Directory.EnumerateFiles(artifacts, "*", SearchOption.AllDirectories) : [])
                .Select(file => (name: RunPath(artifacts, file), bytes: File.ReadAllBytes(file)))
                .Append((name: "apply.json", bytes: System.Text.Encoding.UTF8.GetBytes(JsonConvert.SerializeObject(relative, Formatting.Indented))))
                .Concat(failures.Count == 0 ? [] : [(name: "failures.json", bytes: System.Text.Encoding.UTF8.GetBytes(JsonConvert.SerializeObject(failures.Select(f => new { subject = f.Subject, message = f.Message }), Formatting.Indented)))])
                .Concat(EngineEdge.WarningsOutput(handled))
                .ToList();
            // One family applied is a run that changed Revit, so it succeeded; its failed siblings are on the receipts.
            var receiptPath = PodRuns.WriteReceiptIn(run, new PodReceipt(source.Pod, source.Path, source.Sha256, operation,
                    data.Receipts.Select(r => r.PlanHash).Where(h => h is not null).Distinct().ToList() is { Count: > 0 } hashes ? string.Join(",", hashes) : null,
                    data.Diagnostics.Any(d => d.Code == CancelledCode) ? "Cancelled"
                        : data.Receipts.Any(r => r.Success) ? "Succeeded" : "Failed",
                    inputOutputs,
                    relative.Reason),
                outputs);
            return relative with {
                ReceiptPath = receiptPath,
                Receipts = relative.Receipts.Select(r => r with { ArtifactDirectory = r.ArtifactDirectory is null ? null : Path.GetDirectoryName(receiptPath) }).ToList()
            };
        } finally {
            if (Directory.Exists(artifacts)) Directory.Delete(artifacts, true);
        }
    }

    private static object DocumentTarget(Document document) {
        var tracked = DocumentTrackerAccessor.Current?.Find(document);
        return new {
            kind = document.IsFamilyDocument ? "family-document" : "project-document",
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

    /// <summary>Every failure with its full text: op-level diagnostics first, then each family's own. The run keeps it as `failures.json`.</summary>
    private static List<(string Subject, string Message)> Failures(FamilyFoundryApplyData data) =>
        data.Diagnostics.Select(d => (Subject: d.Code, Message: d.Message))
            .Concat(data.Receipts.Where(r => !r.Success).Select(r => (
                Subject: r.FamilyName ?? r.FamilyId.ToString(System.Globalization.CultureInfo.InvariantCulture),
                Message: string.Join(Environment.NewLine, new[] { r.Error }.Concat(r.Errors).OfType<string>().Where(m => m.Length > 0).DefaultIfEmpty("failed with no message")))))
            .ToList();

    /// <summary>
    ///     One sentence naming the first failure (w8-revit trip 7: `reason` was kilobytes of stack trace). The innermost
    ///     exception message on its first line is the cause; the trace stays in `failures.json`.
    /// </summary>
    private static string? Reason(FamilyFoundryApplyData data, List<(string Subject, string Message)> failures) {
        if (failures.Count == 0) return null;
        var (subject, message) = failures[0];
        var line = message.Split('\n')[0].Trim();
        var cause = line.LastIndexOf("Exception: ", StringComparison.Ordinal) is var at and >= 0 ? line[(at + "Exception: ".Length)..] : line;
        var failed = data.Receipts.Count(r => !r.Success);
        return failed == 0 ? $"{subject}: {cause}" : $"{failed} of {data.Receipts.Count} families failed; the first, {subject}: {cause}";
    }

    /// <summary>Run outputs are flat file names; an artifact's relative path becomes its `--`-joined name prefix.</summary>
    private static string RunPath(string artifacts, string path) => path[(artifacts.Length + 1)..].Replace(Path.DirectorySeparatorChar.ToString(), "--");

    /// <summary>Plans exactly <paramref name="familyIds" /> when passed; the spec's `select` is the default scope, never a post-filter.</summary>
    internal static FamilyFoundryPlanData PlanFamilies(string specJson, Document document, IReadOnlyList<long>? familyIds = null, ExecutionOptions? executionOptions = null,
        CancellationToken cancellationToken = default) {
        var (patch, diagnostics) = ParseSpec(specJson);
        if (patch is null) return new FamilyFoundryPlanData([], diagnostics);
        executionOptions ??= new ExecutionOptions();

        if (familyIds is not null && !document.IsFamilyDocument) {
            var missing = familyIds.Where(id => document.GetElement(id.ToElementId()) is not Family).Distinct().ToList();
            if (missing.Count > 0)
                return new FamilyFoundryPlanData([], missing.Select(id => new FamilyFoundryDiagnostic("FamilyNotFound", "$.familyIds", $"Element id {id} is not a loaded family.")).ToList());
        }
        var families = document.IsFamilyDocument
            ? familyIds is null || familyIds.Contains(document.OwnerFamily.Id.Value()) ? new List<Family> { document.OwnerFamily } : []
            : familyIds is not null
            ? familyIds.Distinct().Select(id => (Family)document.GetElement(id.ToElementId())).ToList()
            : document.FamiliesMatching(patch.Select);
        if (families.Count == 0)
            return new FamilyFoundryPlanData([], [new FamilyFoundryDiagnostic("FamilyNotFound", "$.familyIds", familyIds is null ? "The spec selects no loaded family." : "The target resolves no loaded family.")]);

        return new FamilyFoundryPlanData(families.Select(family => {
            // A cancelled plan returns nothing: the confirmation sheet is only worth reading whole.
            cancellationToken.ThrowIfCancellationRequested();
            try { return WithFamilyDocument(document, family, (famDoc, editDiagnostics) => {
            var preview = famDoc.PreviewFamily(patch, executionOptions);
            var warnings = CaptureIssues(preview.Original, family, editDiagnostics);
            return new FamilyFoundryFamilyPlanData(family.Id.Value(), family.Name, preview.PlanHash,
                preview.Changes.Select(ToChange).ToList(), preview.RunEffects, preview.Diagnostics.Select(ToDiagnostic).ToList(), warnings);
            }); } catch (Exception exception) when (exception is Autodesk.Revit.Exceptions.InvalidOperationException or InvalidOperationException) {
                return new FamilyFoundryFamilyPlanData(family.Id.Value(), family.Name, string.Empty, [], [],
                    [new FamilyFoundryDiagnostic("FamilyEditRefused", "$.familyId", exception.Message)], []);
            }
        }).ToList(), []);
    }

    /// <summary>Run the spec against explicit families, writing engine artifacts under <paramref name="artifactDirectory" />.</summary>
    internal static FamilyFoundryApplyData ApplyFamilies(string specJson, IReadOnlyDictionary<long, string> expectedPlanHashes, Document document,
        ExecutionOptions? executionOptions, LoadAndSaveOptions? loadAndSave, string artifactDirectory, CancellationToken cancellationToken = default) {
        var (patch, diagnostics) = ParseSpec(specJson);
        if (patch is null) return new FamilyFoundryApplyData([], diagnostics);
        executionOptions ??= new ExecutionOptions();
        if (expectedPlanHashes is not { Count: > 0 })
            return new FamilyFoundryApplyData([], [new FamilyFoundryDiagnostic("ExpectedPlanHashesRequired", "$.expectedPlanHashes", "Plan first and pass each family's planHash.")]);

        var runOutput = OutputStorage.ExactDir(artifactDirectory);
        var receipts = new List<FamilyFoundryApplyReceipt>();
        var notStarted = new List<long>();
        foreach (var (familyId, expectedHash) in expectedPlanHashes) {
            // Cancel lands between families and never inside one family's edit: a half-edited
            // family is a worse outcome than a long one.
            if (cancellationToken.IsCancellationRequested) {
                notStarted.Add(familyId);
                continue;
            }

            var family = document.IsFamilyDocument
                ? document.OwnerFamily.Id.Value() == familyId ? document.OwnerFamily : null
                : document.GetElement(familyId.ToElementId()) as Family;
            if (family is null) {
                receipts.Add(Failed(familyId, null, $"Element id {familyId} is not a loaded family."));
                continue;
            }
            var familyName = family.Name;
            try {
                var op = new ReconcileFamily(patch, expectedPlanHash: expectedHash, executionOptions: executionOptions);
                var writer = new ProcessingResultBuilder(runOutput).WithProfile(patch, "inline-spec").WithReconcile(op);
                using var processor = new OperationProcessor(document, executionOptions);
                var (contexts, _) = processor.SelectFamilies(() => [family]).WithArtifactWriter(writer)
                    .ProcessQueue(new OperationQueue().Add(op), null, runOutput.DirectoryPath, loadAndSave ?? new LoadAndSaveOptions { OpenOutputFilesOnCommandFinish = false });
                var context = contexts.Single();
                var (logs, error) = context.OperationLogs;
                var receipt = op.LastReceipt;
                var errors = logs?.SelectMany(l => l.Entries).Where(e => e.Status == LogStatus.Error).Select(e => $"{e.Name}: {e.Message}").ToList() ?? [];
                receipts.Add(new FamilyFoundryApplyReceipt(familyId, familyName, error is null && errors.Count == 0 && receipt?.Converged == true, receipt?.Converged ?? false, error?.Message, receipt?.PlanHash,
                    receipt?.Residue.Select(ToChange).ToList() ?? [], errors, context.Artifacts is { } a ? Path.Combine(runOutput.DirectoryPath, a.FamilyDirectory) : null,
                    receipt?.ObservedParametersDigest, context.LoadedFamilyId));
            } catch (Exception exception) {
                receipts.Add(Failed(familyId, familyName, exception.Message));
            }
        }
        return new FamilyFoundryApplyData(receipts, notStarted.Count == 0 ? [] : [
            new FamilyFoundryDiagnostic(CancelledCode, "$.expectedPlanHashes",
                $"Cancelled after {receipts.Count} of {expectedPlanHashes.Count} families. Not started: {string.Join(", ", notStarted)}.")
        ]);
    }

    internal static FamiliesCaptureData CaptureFamilies(IReadOnlyList<long> familyIds, Document document) {
        if (familyIds is not { Count: > 0 })
            return new FamiliesCaptureData([], [new FamilyFoundryDiagnostic("FamilyIdsRequired", "$.familyIds", "At least one explicit family id is required.")]);
        return new FamiliesCaptureData(familyIds.Distinct().Select(familyId => {
            if (document.GetElement(familyId.ToElementId()) is not Family family)
                return new FamilyFoundryFamilyModelData(familyId, null, false, null, new Dictionary<string, string>(), 0, [], $"Element id {familyId} is not a loaded family.");
            try {
                return WithFamilyDocument(document, family, (famDoc, editDiagnostics) => {
                    var model = famDoc.CaptureFamilyModel();
                    var issues = CaptureIssues(model, family, editDiagnostics);
                    return new FamilyFoundryFamilyModelData(familyId, family.Name, true, FamilyModelJson.Serialize(model),
                        model.Coverage.ToDictionary(p => p.Key, p => p.Value.ToString()), model.Unmodeled.Count, issues, null);
                });
            } catch (Exception exception) {
                return new FamilyFoundryFamilyModelData(familyId, family.Name, false, null, new Dictionary<string, string>(), 0, [], exception.Message);
            }
        }).ToList(), []);
    }

    /// <summary>
    ///     Read the explicitly targeted family document, or an independent copy of the exact project-loaded
    ///     family. The engine edge owns the dialog lane here; `ReadFamilyCopy` owns the failures lane.
    /// </summary>
    private static T WithFamilyDocument<T>(Document project, Family family,
        Func<Document, IReadOnlyList<(bool IsError, string Message)>, T> read) {
        EngineEdge.RequireReachableCentral(project);
        var diagnostics = new List<(bool IsError, string Message)>();
        return EngineEdge.NoModal(diagnostics, () => project.ReadFamilyCopy(family, famDoc => read(famDoc.Document, diagnostics), diagnostics));
    }

    private static IReadOnlyList<RevitDataIssue> CaptureIssues(FamilyModel model, Family family,
        IEnumerable<(bool IsError, string Message)> diagnostics) =>
        diagnostics.Where(diagnostic => !diagnostic.IsError).Select(diagnostic =>
            new RevitDataIssue("FamilyEditWarning", RevitDataIssueSeverity.Warning,
                $"EditFamily for '{family.Name}': {diagnostic.Message}", FamilyName: family.Name))
            .Concat(model.CaptureIssues).ToList();

    /// <summary>
    ///     The spec as authored: a family patch, or a family model member (its `$schema` says which). A model
    ///     applies as a patch with no selector, so the one conversion happens here, never in the engine.
    /// </summary>
    private static (FamilyPatch? Patch, IReadOnlyList<FamilyFoundryDiagnostic> Diagnostics) ParseSpec(string? json) {
        if (string.IsNullOrWhiteSpace(json))
            return (null, [new FamilyFoundryDiagnostic("SpecJsonRequired", "$.specJson", "specJson is required: a family patch or family model member.")]);
        try {
            var spec = JObject.Parse(json!);
            if ((string?)spec["$schema"] is { } schema && schema.EndsWith(SettingsSchemaUrl.Path(FamilyModelSettingsRegistration.Root), StringComparison.OrdinalIgnoreCase)) {
                _ = spec.Remove("$schema");
                return (FamilyPatch.Parse(new JObject { ["patch"] = spec }.ToString()), []);
            }
            return (FamilyPatch.Parse(json!), []);
        }
        catch (JsonException exception) {
            return (null, [new FamilyFoundryDiagnostic("InvalidSpecJson", "$.specJson", exception.Message, "The spec follows the family.json schema; omission = unchanged, null = delete, {} = ensure.")]);
        }
    }

    private static FamilyFoundryChangeData ToChange(FamilyChange c) => new(c.Section, c.Key, c.Kind.ToString(), c.MappedFrom);
    private static FamilyFoundryDiagnostic ToDiagnostic(FamilyModelDiagnostic d) => new(d.Code, d.Path, d.Message);
    private static FamilyFoundryApplyReceipt Failed(long id, string? name, string error) => new(id, name, false, false, error, null, [], [error], null, null);
}
