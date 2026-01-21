using Pe.Extensions.FamDocument;
using Pe.FamilyFoundry.Aggregators.Snapshots;
using Pe.FamilyFoundry.Snapshots;
using System.ComponentModel;
using System.ComponentModel.DataAnnotations;
using System.Diagnostics;

namespace Pe.FamilyFoundry;

/// <summary>
///     Processor for executing operations on families.
///     Handles document and family selection, execution, and result aggregation.
/// </summary>
/// <param name="executionOptions">The execution options for the processor. If null, default options will be used.</param>
/// <param name="doc">The document to process.</param>
public class OperationProcessor(
    Document doc,
    ExecutionOptions? executionOptions = null
) : IDisposable {
    private readonly ExecutionOptions _exOpts = executionOptions ?? new ExecutionOptions();

    /// <summary>
    ///     A function to select families in the Document. If the document is a family document, this will not be called
    /// </summary>
    private Func<List<Family>?> _documentFamilySelector = () => null;

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
                    Debug.WriteLine($"Failed to invoke per-family callback for {context.FamilyName}");
                    Debug.WriteLine(ex.ToStringDemystified());
                }
            };
        return this;
    }

    /// <summary>
    ///     Execute a configured processor with full initialization and document handling.
    ///     Returns FamilyProcessingContext with pre- / post-snapshots when a collector is provided.
    /// </summary>
    public (List<FamilyProcessingContext> contexts, double totalMs) ProcessQueue(
        OperationQueue queue,
        CollectorQueue? collectorQueue = null,
        string? outputFolderPath = null,
        LoadAndSaveOptions? loadAndSaveOptions = null) {
        var totalSw = Stopwatch.StartNew();

        // Disable collectors if requested in execution options
        if (this._exOpts.DisableCollectors) collectorQueue = null;

        var contexts = this.OpenDoc.IsFamilyDocument
            ? this.ProcessFamilyDocument(queue, collectorQueue)
            : this.ProcessNormalDocument(queue, collectorQueue, loadAndSaveOptions, outputFolderPath);

        totalSw.Stop();
        return (contexts, totalSw.Elapsed.TotalMilliseconds);
    }

    public (List<FamilyProcessingContext> contexts, double totalMs) ProcessQueueDangerously(
        OperationQueue queue,
        CollectorQueue? collectorQueue,
        string? outputFolderPath = null,
        LoadAndSaveOptions? loadAndSaveOptions = null
    ) {
        var totalSw = Stopwatch.StartNew();

        // Disable collectors if requested in execution options
        if (this._exOpts.DisableCollectors) collectorQueue = null;

        var contexts = this.OpenDoc.IsFamilyDocument
            ? this.ProcessFamilyDocument(queue, collectorQueue)
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

    private List<FamilyProcessingContext> ProcessNormalDocument(
        OperationQueue queue,
        CollectorQueue? collectorQueue,
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

        foreach (var family in families) {
            // Reset GroupContexts for each family processing cycle
            queue.ResetAllGroupContexts();

            var familyFuncs = queue.ToFuncs(
                this._exOpts.OptimizeTypeOperations,
                this._exOpts.SingleTransaction);

            var famDoc = this.OpenDoc
                .GetFamilyDocument(family)
                .EnsureDefaultType()
                .StartPipeline(this.OpenDoc, family, pipeline =>
                        pipeline
                            .CollectPreSnapshot(collectorQueue)
                            .Process(familyFuncs)
                            .SaveToLocations(d => GetSaveLocations(d, saveOpts, outputFolderPath))
                            .Load()
                            .CollectPostSnapshot(collectorQueue),
                    out var context);

            if (!famDoc.Close(false))
                throw new InvalidOperationException($"Failed to close family document for {family.Name}");
            contexts.Add(context);
            this._perFamilyCallback?.Invoke(context);
        }

        return contexts;
    }

    private List<FamilyProcessingContext> ProcessFamilyDocument(OperationQueue queue, CollectorQueue? collectorQueue) {
        queue.ResetAllGroupContexts();
        var familyFuncs = queue.ToFuncs(
            this._exOpts.OptimizeTypeOperations,
            this._exOpts.SingleTransaction);

        _ = this.OpenDoc
            .GetFamilyDocument()
            .EnsureDefaultType()
            .StartPipeline(pipeline =>
                    pipeline
                        .CollectPreSnapshot(collectorQueue)
                        .Process(familyFuncs)
                        .CollectPostSnapshot(collectorQueue),
                out var context);
        // Note: No Close() call - we don't close the active family document
        this._perFamilyCallback?.Invoke(context);
        return [context];
    }


    public List<FamilyProcessingContext> ProcessFamilyDocumentIntoVariants(
        List<(string variant, OperationQueue queue)> variants,
        string outputDirectory
    ) => this.ProcessFamilyDocumentIntoVariants(variants, null, outputDirectory);

    public List<FamilyProcessingContext> ProcessFamilyDocumentIntoVariants(
        List<(string variant, OperationQueue queue)> variants,
        CollectorQueue? collectorQueue,
        string outputDirectory
    ) => this.ProcessFamilyDocumentIntoVariants(
        variants.Select(v => new VariantSpec(v.variant, v.queue)).ToList(),
        collectorQueue,
        outputDirectory
    );

    public List<FamilyProcessingContext> ProcessFamilyDocumentIntoVariants(
        List<VariantSpec> variants,
        CollectorQueue? collectorQueue,
        string outputDirectory
    ) {
        var contexts = new List<FamilyProcessingContext>();

        try {
            if (variants.Count == 0) return [];
            var directoryInfo = !Directory.Exists(outputDirectory)
                ? Directory.CreateDirectory(outputDirectory)
                : new DirectoryInfo(outputDirectory);

            var baseFamilyName = this.OpenDoc.Title;

            foreach (var variant in variants) {
                variant.Queue.ResetAllGroupContexts();
                var variantFuncs = variant.Queue.ToFuncs(false, false);
                var variantSw = Stopwatch.StartNew();

                var context = new FamilyProcessingContext {
                    FamilyName = $"{baseFamilyName} - {variant.Name.Trim()}",
                    Tag = variant // Store variant spec for later retrieval
                };

                _ = this.OpenDoc
                    .GetFamilyDocument()
                    .EnsureDefaultType()
                    .ProcessAndSaveVariant(directoryInfo.FullName, variant.Name,
                        famDoc => {
                            // Collect pre-snapshot if collector is provided
                            if (collectorQueue != null) {
                                var preSw = Stopwatch.StartNew();
                                var preSnapshot = new FamilySnapshot { FamilyName = context.FamilyName };
                                context.PreProcessSnapshot = preSnapshot;

                                var projectCollector = collectorQueue.ToProjectCollectorFunc();
                                var famDocCollector = collectorQueue.ToFamilyDocCollectorFunc();

                                // Collect from project document (if available via OwnerFamily)
                                if (famDoc.OwnerFamily?.Document != null)
                                    projectCollector(preSnapshot, famDoc.OwnerFamily.Document, famDoc.OwnerFamily);
                                famDocCollector(preSnapshot, famDoc);

                                preSw.Stop();
                                context.PreCollectionMs = preSw.Elapsed.TotalMilliseconds;
                            }

                            // Process operations
                            var opSw = Stopwatch.StartNew();
                            _ = famDoc.Process(context, variantFuncs, out var logs);
                            opSw.Stop();
                            context.OperationsMs = opSw.Elapsed.TotalMilliseconds;

                            // Collect post-snapshot if collector is provided
                            if (collectorQueue != null) {
                                var postSw = Stopwatch.StartNew();
                                var postSnapshot = new FamilySnapshot { FamilyName = context.FamilyName };
                                context.PostProcessSnapshot = postSnapshot;

                                var projectCollector = collectorQueue.ToProjectCollectorFunc();
                                var famDocCollector = collectorQueue.ToFamilyDocCollectorFunc();

                                // Collect from project document (if available via OwnerFamily)
                                if (famDoc.OwnerFamily?.Document != null)
                                    projectCollector(postSnapshot, famDoc.OwnerFamily.Document, famDoc.OwnerFamily);
                                famDocCollector(postSnapshot, famDoc);

                                postSw.Stop();
                                context.PostCollectionMs = postSw.Elapsed.TotalMilliseconds;
                            }

                            return logs;
                        },
                        out var variantLogs);

                variantSw.Stop();
                context.OperationLogs = variantLogs;
                context.TotalMs = variantSw.Elapsed.TotalMilliseconds;
                contexts.Add(context);
            }
        } catch (Exception ex) {
            contexts.Add(new FamilyProcessingContext {
                FamilyName = this.OpenDoc.Title,
                OperationLogs = new Exception($"Failed to process family {this.OpenDoc.Title}: {ex.Message}"),
                TotalMs = 0
            });
        }

        return contexts;
    }

    private static List<string> GetSaveLocations(FamilyDocument famDoc,
        LoadAndSaveOptions options,
        string? outputFolderPath) {
        var saveLocations = new List<string>();
        if ((options?.SaveFamilyToInternalPath ?? false)
            && !string.IsNullOrEmpty(outputFolderPath))
            saveLocations.Add(outputFolderPath);

        if (!(options?.SaveFamilyToOutputDir ?? false)) return saveLocations;
        var saveLocation = famDoc.PathName;
        saveLocations.Add(saveLocation);

        return saveLocations;
    }
}

public class ExecutionOptions {
    [Description("When enabled, the command will bundle the operations into a single transaction.")]
    public bool SingleTransaction { get; init; } = true;

    [Description("When enabled, consecutive type operations will be batched together for better performance.")]
    public bool OptimizeTypeOperations { get; init; } = true;

    [Description(
        "Disable collectors to speed up processing. Do not use outside of testing, it may effect what parameters are purged")]
    public bool DisableCollectors { get; init; } = false;
}

public class LoadAndSaveOptions {
    [Description("Automatically open output files (CSV, etc.) when commands complete successfully")]
    [Required]
    public bool OpenOutputFilesOnCommandFinish { get; set; } = true;

    [Description(
        "Load processed family(ies) into the main model document (if the command is run on a main model document)")]
    [Required]
    public bool LoadFamily { get; set; } = true;

    [Description("Save processed family(ies) to the internal path of the family document on your computer")]
    [Required]
    public bool SaveFamilyToInternalPath { get; set; } = false;

    [Description("Save processed family(ies) to the output directory of the command")]
    [Required]
    public bool SaveFamilyToOutputDir { get; set; } = false;
}

/// <summary>
///     Specification for a family variant including its queue and optional metadata.
/// </summary>
public class VariantSpec {
    public VariantSpec(string name, OperationQueue queue) {
        this.Name = name;
        this.Queue = queue;
    }

    public string Name { get; }
    public OperationQueue Queue { get; }

    /// <summary>
    ///     Optional metadata dictionary for storing variant-specific information
    ///     (e.g., synthetic settings, configuration data, etc.)
    /// </summary>
    public BaseProfileSettings Profile { get; set; }

    public VariantSpec WithProfile(BaseProfileSettings profile) {
        this.Profile = profile;
        return this;
    }
}