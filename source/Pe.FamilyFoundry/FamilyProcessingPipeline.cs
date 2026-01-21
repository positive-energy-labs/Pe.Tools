using Pe.Extensions.FamDocument;
using Pe.FamilyFoundry;
using Pe.FamilyFoundry.Aggregators.Snapshots;
using Pe.FamilyFoundry.Snapshots;
using System.Diagnostics;

/// <summary>
///     Fluent pipeline for family processing. Owns context lifecycle and returns populated results via out parameter.
///     Supports project mode (with Load) and family-doc mode (in-place processing).
/// </summary>
public readonly struct FamilyProcessingPipeline {
    internal FamilyProcessingPipeline(
        FamilyDocument famDoc,
        Document? projectDoc,
        Family? sourceFamily,
        Family? loadedFamily,
        FamilyProcessingContext context) {
        this.FamDoc = famDoc;
        this.ProjectDoc = projectDoc;
        this.SourceFamily = sourceFamily;
        this.LoadedFamily = loadedFamily;
        this.Context = context;
    }

    /// <summary>The open family document</summary>
    public FamilyDocument FamDoc { get; }

    /// <summary>The project document (null in family-doc-only mode)</summary>
    public Document? ProjectDoc { get; }

    /// <summary>Original family before processing (null in family-doc mode)</summary>
    public Family? SourceFamily { get; }

    /// <summary>Family after Load() call (null before Load() or in family-doc mode)</summary>
    public Family? LoadedFamily { get; }

    /// <summary>Processing context for this pipeline (created by StartPipeline)</summary>
    public FamilyProcessingContext Context { get; }

    // /// <summary>Whether this pipeline is in family-doc-only mode (no project context)</summary>
    // public bool IsFamilyDocMode => this.ProjectDoc == null;

    /// <summary>Whether Load() has been called</summary>
    public bool IsLoaded => this.LoadedFamily != null;
}

public static class FamilyProcessingPipelineExtensions {
    /// <summary>
    ///     Starts pipeline in project mode. Creates context, executes configure lambda, captures timing/exceptions.
    ///     Call famDoc.Close() after pipeline completes.
    /// </summary>
    public static FamilyDocument StartPipeline(
        this FamilyDocument famDoc,
        Document projectDoc,
        Family sourceFamily,
        Action<FamilyProcessingPipeline> configure,
        out FamilyProcessingContext context
    ) {
        if (projectDoc == null) throw new ArgumentNullException(nameof(projectDoc));
        if (configure == null) throw new ArgumentNullException(nameof(configure));

        context = new FamilyProcessingContext { FamilyName = famDoc.Document.Title };

        var sw = Stopwatch.StartNew();

        try {
            var pipeline = new FamilyProcessingPipeline(
                famDoc,
                projectDoc,
                sourceFamily,
                null,
                context);

            configure(pipeline);
        } catch (Exception ex) {
            context.OperationLogs = new Exception(
                $"Failed to process family {context.FamilyName}: {ex.ToStringDemystified()}");
        } finally {
            sw.Stop();
            context.TotalMs = sw.Elapsed.TotalMilliseconds;
        }

        return famDoc;
    }

    /// <summary>
    ///     Starts pipeline in family-doc mode for in-place processing. Creates context, executes configure lambda, captures
    ///     timing/exceptions.
    ///     Load() and Close() not available in this mode.
    /// </summary>
    public static FamilyDocument StartPipeline(
        this FamilyDocument famDoc,
        Action<FamilyProcessingPipeline> configure,
        out FamilyProcessingContext context
    ) {
        if (configure == null) throw new ArgumentNullException(nameof(configure));

        context = new FamilyProcessingContext { FamilyName = famDoc.Document.Title };

        var sw = Stopwatch.StartNew();

        try {
            var pipeline = new FamilyProcessingPipeline(
                famDoc,
                null,
                null,
                null,
                context);

            configure(pipeline);
        } catch (Exception ex) {
            context.OperationLogs = new Exception(
                $"Failed to process family {context.FamilyName}: {ex.ToStringDemystified()}");
        } finally {
            sw.Stop();
            context.TotalMs = sw.Elapsed.TotalMilliseconds;
        }

        return famDoc;
    }

    /// <summary>
    ///     Execute action with project document and family. Uses SourceFamily before Load(), LoadedFamily after.
    ///     No-op in family-doc mode.
    /// </summary>
    public static FamilyProcessingPipeline TapProject(
        this FamilyProcessingPipeline pipeline,
        Action<Document, Family> action
    ) {
        if (pipeline.ProjectDoc == null) return pipeline;

        var family = pipeline.IsLoaded ? pipeline.LoadedFamily : pipeline.SourceFamily;
        if (family != null)
            action(pipeline.ProjectDoc, family);

        return pipeline;
    }

    /// <summary>Execute action with the family document. Works in both project and family-doc modes.</summary>
    public static FamilyProcessingPipeline TapFamilyDoc(
        this FamilyProcessingPipeline pipeline,
        Action<FamilyDocument> action
    ) {
        action(pipeline.FamDoc);
        return pipeline;
    }

    /// <summary>
    ///     Execute operations with automatic transaction management. Each callback runs in its own transaction.
    ///     Logs stored in Context.OperationLogs.
    /// </summary>
    public static FamilyProcessingPipeline Process<TContext>(
        this FamilyProcessingPipeline pipeline,
        Func<FamilyDocument, TContext, List<OperationLog>>[] callbacks
    ) {
        if (pipeline.Context == null)
            throw new InvalidOperationException("Context must be set before calling Process()");

        var sw = Stopwatch.StartNew();
        _ = pipeline.FamDoc.Process((TContext)(object)pipeline.Context, callbacks,
            out var results);
        sw.Stop();

        pipeline.Context.OperationLogs = results;
        pipeline.Context.OperationsMs = sw.Elapsed.TotalMilliseconds;

        return pipeline;
    }

    /// <summary>Save family to directories returned by getSaveLocations. Empty list = no-op.</summary>
    public static FamilyProcessingPipeline SaveToLocations(
        this FamilyProcessingPipeline pipeline,
        Func<FamilyDocument, List<string>> getSaveLocations
    ) {
        _ = pipeline.FamDoc.SaveToLocations(getSaveLocations);
        return pipeline;
    }

    /// <summary>
    ///     Load family into project document. Only valid in project mode. Can only be called once.
    ///     Null options uses DefaultFamilyLoadOptions.
    /// </summary>
    public static FamilyProcessingPipeline Load(
        this FamilyProcessingPipeline pipeline,
        IFamilyLoadOptions? options = null
    ) {
        if (pipeline.ProjectDoc == null)
            throw new InvalidOperationException("Cannot call Load() in family-doc-only mode.");

        if (pipeline.IsLoaded)
            throw new InvalidOperationException("Load() has already been called on this pipeline.");

        var loadedFamily = pipeline.FamDoc.LoadFamily(pipeline.ProjectDoc, options ?? new DefaultFamilyLoadOptions());

        return new FamilyProcessingPipeline(
            pipeline.FamDoc,
            pipeline.ProjectDoc,
            pipeline.SourceFamily,
            loadedFamily,
            pipeline.Context);
    }

    /// <summary>
    ///     Collect pre-processing snapshot. Runs project collectors (if available) then family doc collectors.
    ///     First collector wins per section. Call before Process(). Null queue = no-op.
    /// </summary>
    public static FamilyProcessingPipeline CollectPreSnapshot(
        this FamilyProcessingPipeline pipeline,
        CollectorQueue? collectorQueue
    ) {
        if (pipeline.Context == null)
            throw new InvalidOperationException("Context must be set before calling CollectPreSnapshot()");

        if (collectorQueue == null)
            return pipeline;

        if (pipeline.Context.PreProcessSnapshot != null)
            throw new InvalidOperationException("Pre-snapshot has already been collected for this context");

        var sw = Stopwatch.StartNew();
        var result = pipeline.CollectSnapshot(collectorQueue, (ctx, s) => ctx.PreProcessSnapshot = s);
        sw.Stop();
        pipeline.Context.PreCollectionMs = sw.Elapsed.TotalMilliseconds;

        return result;
    }

    /// <summary>
    ///     Collect post-processing snapshot. Runs project collectors (if available) then family doc collectors.
    ///     First collector wins per section. Call after Process(). Null queue = no-op.
    /// </summary>
    public static FamilyProcessingPipeline CollectPostSnapshot(
        this FamilyProcessingPipeline pipeline,
        CollectorQueue? collectorQueue
    ) {
        if (pipeline.Context == null)
            throw new InvalidOperationException("Context must be set before calling CollectPostSnapshot()");

        if (collectorQueue == null)
            return pipeline;

        if (pipeline.Context.PostProcessSnapshot != null)
            throw new InvalidOperationException("Post-snapshot has already been collected for this context");

        var sw = Stopwatch.StartNew();
        var result = pipeline.CollectSnapshot(collectorQueue, (ctx, s) => ctx.PostProcessSnapshot = s);
        sw.Stop();
        pipeline.Context.PostCollectionMs = sw.Elapsed.TotalMilliseconds;

        return result;
    }

    /// <summary>
    ///     Low-level snapshot collection with custom storage via setSnapshot action.
    ///     Prefer CollectPreSnapshot() or CollectPostSnapshot() for typical use.
    /// </summary>
    private static FamilyProcessingPipeline CollectSnapshot(
        this FamilyProcessingPipeline pipeline,
        CollectorQueue collectorQueue,
        Action<FamilyProcessingContext, FamilySnapshot> setSnapshot
    ) {
        var snapshot = new FamilySnapshot { FamilyName = pipeline.Context.FamilyName };
        setSnapshot(pipeline.Context, snapshot);

        var projectCollector = collectorQueue.ToProjectCollectorFunc();
        var famDocCollector = collectorQueue.ToFamilyDocCollectorFunc();

        return pipeline
            .TapProject((doc, fam) => projectCollector(snapshot, doc, fam))
            .TapFamilyDoc(famDoc => famDocCollector(snapshot, famDoc));
    }
}