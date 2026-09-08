using Pe.Revit.Extensions.FamDocument;
using Pe.Revit.Extensions.ProjDocument;
using System.ComponentModel;
using System.ComponentModel.DataAnnotations;
using System.Diagnostics;

namespace Pe.Revit.FamilyFoundry;

/// <summary>
///     Processor for executing operations on families.
///     Handles document and family selection, execution, and result aggregation.
/// </summary>
/// <param name="executionOptions">The execution options for the processor. If null, default options will be used.</param>
/// <param name="visitOptions">Runtime transaction ownership and optional document parking for family visits.</param>
/// <param name="doc">The document to process.</param>
public class OperationProcessor(
    Document doc,
    ExecutionOptions? executionOptions = null,
    FamilyVisitOptions? visitOptions = null
) : IDisposable {
    private readonly ExecutionOptions _exOpts = executionOptions ?? new ExecutionOptions();
    private readonly FamilyVisitOptions _visitOpts = visitOptions ?? new FamilyVisitOptions();
    private ProcessingResultBuilder? _artifactWriter;

    /// <summary>
    ///     A function to select families in the Document. If the document is a family document, this will not be called
    /// </summary>
    private Func<List<Family>?> _documentFamilySelector = () => null;

    private bool _openArtifactsOnFinish;

    private Action<FamilyProcessingContext>? _perFamilyCallback;

    private Document OpenDoc { get; } = doc;

    public void Dispose() { }

    public OperationProcessor SelectFamilies(params Func<List<Family>?>[] familySelectors) {
        var selectorList = familySelectors.ToList();
        if (selectorList == null || selectorList.Count == 0)
            throw new ArgumentException(@"At least one family selector must be provided", nameof(familySelectors));
        this._documentFamilySelector = () => selectorList
            .SelectMany(selector => selector() ?? new List<Family>())
            .GroupBy(f => f.Id)
            .Select(g => g.First())
            .ToList();
        return this;
    }

    // TODO: make this also return an operationLog?
    public OperationProcessor WithPerFamilyCallback(Action<FamilyProcessingContext> callback) {
        this._perFamilyCallback =
            context => {
                try {
                    callback(context);
                } catch (Exception ex) {
                    Console.WriteLine($"Failed to invoke per-family callback for {context.FamilyName}");
                    Console.WriteLine(ex.ToStringDemystified());
                }
            };
        return this;
    }

    public OperationProcessor WithArtifactWriter(ProcessingResultBuilder artifactWriter, bool openOnFinish = false) {
        this._artifactWriter = artifactWriter ?? throw new ArgumentNullException(nameof(artifactWriter));
        this._openArtifactsOnFinish = openOnFinish;
        return this;
    }

    /// <summary>
    ///     Execute a configured processor with full initialization and document handling.
    ///     Returns FamilyProcessingContext with pre- / post-snapshots when a collector is provided.
    /// </summary>
    public (List<FamilyProcessingContext> contexts, double totalMs) ProcessQueue(
        OperationQueue queue,
        SnapshotCapturePipeline? collectorQueue = null,
        string? outputFolderPath = null,
        LoadAndSaveOptions? loadAndSaveOptions = null) {
        var totalSw = Stopwatch.StartNew();

        // Disable collectors if requested in execution options
        if (!this._exOpts.EnableCollectors) collectorQueue = null;

        var contexts = this.OpenDoc.IsFamilyDocument
            ? this.ProcessFamilyDocument(queue, collectorQueue, loadAndSaveOptions, outputFolderPath)
            : this.ProcessNormalDocument(queue, collectorQueue, loadAndSaveOptions, outputFolderPath);

        totalSw.Stop();
        return (contexts, totalSw.Elapsed.TotalMilliseconds);
    }

    public (List<FamilyProcessingContext> contexts, double totalMs) ProcessQueueDangerously(
        OperationQueue queue,
        SnapshotCapturePipeline? collectorQueue,
        string? outputFolderPath = null,
        LoadAndSaveOptions? loadAndSaveOptions = null
    ) {
        var totalSw = Stopwatch.StartNew();

        // Disable collectors if requested in execution options
        if (!this._exOpts.EnableCollectors) collectorQueue = null;

        var contexts = this.OpenDoc.IsFamilyDocument
            ? this.ProcessFamilyDocument(queue, collectorQueue, loadAndSaveOptions, outputFolderPath)
            : this.ProcessNormalDocument(queue, collectorQueue, loadAndSaveOptions, outputFolderPath);

        var errors = contexts
            .Where(ctx => {
                var (_, err) = ctx.OperationLogs;
                return err != null;
            }).Select(ctx => {
                var (_, err) = ctx.OperationLogs;
                return err;
            }).ToList();
        if (errors.First() != null) throw errors.First() ?? new Exception("Unknown error occured");

        totalSw.Stop();
        return (contexts, totalSw.Elapsed.TotalMilliseconds);
    }

    /// <summary>
    ///     Project path: one <see cref="FamilyVisit" /> per selected family. The visit owns EditFamily, the
    ///     transaction discipline, LoadFamily and the post-verify; the
    ///     processor contributes the snapshots, the operation funcs, and the save paths.
    /// </summary>
    private List<FamilyProcessingContext> ProcessNormalDocument(
        OperationQueue queue,
        SnapshotCapturePipeline? collectorQueue,
        LoadAndSaveOptions? loadAndSaveOptions,
        string? outputFolderPath
    ) {
        var contexts = new List<FamilyProcessingContext>();
        var families = this._documentFamilySelector();
        if (families == null || families.Count == 0) {
            var err = new ArgumentNullException(nameof(families),
                @"There must be families specified for processing if the open document is a normal model document");
            contexts.Add(new FamilyProcessingContext { FamilyName = "ERROR", OperationLogs = err, TotalMs = 0 });
            return contexts;
        }

        var saveOpts = loadAndSaveOptions ?? new LoadAndSaveOptions();
        var visitOptions = new FamilyVisitOptions {
            Transaction = this._visitOpts.Transaction,
            Park = this._visitOpts.Park,
            SuppressWarnings = this._exOpts.SuppressWarnings || this._visitOpts.SuppressWarnings,
            Load = saveOpts.LoadFamily
        };

        foreach (var family in families) {
            var familyName = family.Name;
            AppendProcessorTrace(outputFolderPath, familyName, "family-start");
            queue.ResetAllGroupContexts();
            var edits = queue.ToNamedFuncs(this._exOpts.OptimizeTypeOperations, this._exOpts.SingleTransaction);
            var context = new FamilyProcessingContext { FamilyName = familyName };
            var sw = Stopwatch.StartNew();
            var logs = new List<OperationLog>();
            try {
                var result = FamilyVisit.Run(this.OpenDoc, family, scope => {
                    var famDoc = scope.Document;
                    var projectCollector = collectorQueue?.ToProjectCollectorFunc();
                    var famDocCollector = collectorQueue?.ToFamilyDocCollectorFunc();
                    if (collectorQueue != null) {
                        var pre = new FamilySnapshot { FamilyName = familyName };
                        projectCollector!(pre, this.OpenDoc, family);
                        famDocCollector!(pre, famDoc);
                        context.PreProcessSnapshot = pre;
                    }
                    context.GraphSizes = ParameterDependencyGraph.Capture(famDoc).Sizes;
                    AppendProcessorTrace(outputFolderPath, familyName, "operations-start");
                    var opSw = Stopwatch.StartNew();
                    foreach (var (name, callback) in edits)
                        scope.Edit(name, d => { logs.AddRange(callback(d, context)); ThrowOnErrors(logs); });
                    context.OperationsMs = opSw.Elapsed.TotalMilliseconds;
                    AppendProcessorTrace(outputFolderPath, familyName, "operations-complete");
                    if (collectorQueue != null) {
                        var post = new FamilySnapshot { FamilyName = familyName };
                        projectCollector!(post, this.OpenDoc, family);
                        famDocCollector!(post, famDoc);
                        context.PostProcessSnapshot = post;
                    }
                }, visitOptions, famDoc => famDoc.SaveToPaths(d => GetSavePaths(d, saveOpts, outputFolderPath)));

                if (!result.Ran)
                    throw new InvalidOperationException($"{result.Refusal}: {result.Message}");
                if (result.Diagnostics.Count > 0)
                    logs.Add(new OperationLog("Commit", result.Diagnostics
                        .Select((d, i) => d.IsError ? new LogEntry($"{d.Edit} {i + 1}").Error(d.Message) : new LogEntry($"{d.Edit} {i + 1}").Skip(d.Message)).ToList()));
                if (saveOpts.LoadFamily && !result.Verified)
                    logs.Add(new OperationLog("LoadFamily", [new LogEntry("post-verify").Error(result.Message ?? "unverified")]));
                if (result.Verified) context.LoadedFamilyId = result.Loaded?.Id.Value();
                context.OperationLogs = logs;
                CompleteReconciliation(queue, !logs.Any(l => l.ErrorCount > 0));
            } catch (Exception ex) {
                CompleteReconciliation(queue, false);
                context.OperationLogs = new Exception($"Failed to process family {familyName}: {ex.ToStringDemystified()}");
            } finally {
                context.TotalMs = sw.Elapsed.TotalMilliseconds;
            }

            contexts.Add(context);
            this.WriteArtifacts(context);
            this._perFamilyCallback?.Invoke(context);
            AppendProcessorTrace(outputFolderPath, familyName, "family-complete");
        }

        return contexts;
    }

    private List<FamilyProcessingContext> ProcessFamilyDocument(OperationQueue queue,
        SnapshotCapturePipeline? collectorQueue) => this.ProcessFamilyDocument(queue, collectorQueue, null, null);

    private List<FamilyProcessingContext> ProcessFamilyDocument(
        OperationQueue queue,
        SnapshotCapturePipeline? collectorQueue,
        LoadAndSaveOptions? loadAndSaveOptions,
        string? outputFolderPath
    ) {
        queue.ResetAllGroupContexts();
        var namedFamilyFuncs = queue.ToNamedFuncs(
            this._exOpts.OptimizeTypeOperations,
            this._exOpts.SingleTransaction);
        var saveOpts = loadAndSaveOptions ?? new LoadAndSaveOptions();

        FamilyVisitResult? visitResult = null;
        _ = this.OpenDoc
            .GetFamilyDocument()
            .StartPipeline(pipeline =>
                {
                    pipeline.CollectPreSnapshot(collectorQueue);
                    var logs = new List<OperationLog>();
                    visitResult = FamilyVisit.InPlace(pipeline.FamDoc, scope => {
                        foreach (var (name, callback) in namedFamilyFuncs)
                            scope.Edit(name, d => { logs.AddRange(callback(d, pipeline.Context)); ThrowOnErrors(logs); });
                        pipeline.CollectPostSnapshot(collectorQueue);
                    }, new FamilyVisitOptions { Transaction = this._visitOpts.Transaction, SuppressWarnings = this._exOpts.SuppressWarnings || this._visitOpts.SuppressWarnings });
                    if (!visitResult.Ran)
                        throw new InvalidOperationException($"{visitResult.Refusal}: {visitResult.Message}");
                    if (visitResult.Diagnostics.Count > 0)
                        logs.Add(new OperationLog("Commit", visitResult.Diagnostics
                            .Select((d, i) => d.IsError ? new LogEntry($"{d.Edit} {i + 1}").Error(d.Message) : new LogEntry($"{d.Edit} {i + 1}").Skip(d.Message)).ToList()));
                    if (!visitResult.Verified)
                        logs.Add(new OperationLog("Commit", [new LogEntry("verification").Skip(visitResult.Message ?? "Commit is unverified.")]));
                    pipeline.Context.OperationLogs = logs;
                    pipeline.SaveToPaths(d => GetSavePaths(d, saveOpts, outputFolderPath));
                },
                out var context);
        var (_, error) = context.OperationLogs;
        CompleteReconciliation(queue, error is null && visitResult?.Verified == true && !visitResult.Diagnostics.Any(d => d.IsError));
        // Note: No Close() call - we don't close the active family document
        this.WriteArtifacts(context);
        this._perFamilyCallback?.Invoke(context);
        return [context];
    }

    internal static void ThrowOnErrors(IEnumerable<OperationLog> logs) {
        var errors = logs.SelectMany(l => l.Entries).Where(e => e.Status == LogStatus.Error).ToList();
        if (errors.Count > 0) throw new InvalidOperationException(string.Join(Environment.NewLine, errors.Select(e => $"{e.Name}: {e.Message}")));
    }

    private static void CompleteReconciliation(OperationQueue queue, bool committed) {
        foreach (var operation in queue.Operations.OfType<Reconcile.ReconcileFamily>()) operation.Complete(committed);
    }


    private static List<string> GetSavePaths(
        FamilyDocument famDoc,
        LoadAndSaveOptions options,
        string? outputFolderPath
    ) {
        var savePaths = new List<string>();
        var familyFileStem = famDoc.Document.GetFamilyFileStem();
        var familyFileName = $"{familyFileStem}.rfa";

        if ((options?.SaveFamilyToInternalPath ?? false) && !string.IsNullOrWhiteSpace(famDoc.PathName))
            savePaths.Add(famDoc.PathName);

        if ((options?.SaveFamilyToOutputDir ?? false) && !string.IsNullOrWhiteSpace(outputFolderPath)) {
            var familyOutputDirectory = Path.Combine(outputFolderPath, familyFileStem);
            savePaths.Add(Path.Combine(familyOutputDirectory, familyFileName));
        }

        return savePaths;
    }

    private static void AppendProcessorTrace(string? outputFolderPath, string familyName, string stage) {
        if (string.IsNullOrWhiteSpace(outputFolderPath))
            return;

        try {
            Directory.CreateDirectory(outputFolderPath);
            File.AppendAllText(
                Path.Combine(outputFolderPath, "processor-trace.log"),
                $"{DateTime.UtcNow:O} family={familyName} stage={stage}{Environment.NewLine}");
        } catch {
            // Do not let diagnostic breadcrumbs change processor behavior.
        }
    }

    private void WriteArtifacts(FamilyProcessingContext context) {
        if (this._artifactWriter == null)
            return;

        try {
            _ = this._artifactWriter.WriteSingleFamilyOutput(context, this._openArtifactsOnFinish);
        } catch (Exception ex) {
            var (logs, error) = context.OperationLogs;
            if (logs != null) {
                logs.Add(new OperationLog("Processing artifacts", [
                    new LogEntry("Processing artifacts").Error(ex.Message)
                ]));
                context.OperationLogs = logs;
                return;
            }

            context.OperationLogs = error == null
                ? new Exception($"Processing artifact generation failed: {ex.Message}")
                : new Exception(
                    $"{error.Message}{Environment.NewLine}Processing artifact generation failed: {ex.Message}");
        }
    }
}

public class LoadAndSaveOptions {
    [Description("Automatically open output files (CSV, etc.) when commands complete successfully")]
    [Required]
    public bool OpenOutputFilesOnCommandFinish { get; set; } = true;

    [Description(
        "Load processed family(ies) into the main model document (if the command is run on a main model document)")]
    [Required]
    public bool LoadFamily { get; set; } = true;

    [Description("Save processed family(ies) back to the family document's real file path when one exists")]
    [Required]
    public bool SaveFamilyToInternalPath { get; set; } = false;

    [Description("Save processed family(ies) as copies inside the command output directory")]
    [Required]
    public bool SaveFamilyToOutputDir { get; set; } = false;
}
