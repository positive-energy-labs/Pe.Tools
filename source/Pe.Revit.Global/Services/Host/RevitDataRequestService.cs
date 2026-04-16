using Newtonsoft.Json;
using Autodesk.Revit.DB;
using Pe.Shared.HostContracts.RevitData;
using Pe.Shared.HostContracts.Protocol;
using Pe.Revit.Global.Revit.Lib.Electrical;
using Pe.Revit.Global.Revit.Lib.Selection;
using Pe.Shared.HostContracts.SettingsStorage;
using Pe.Revit.Global.Revit.Lib.Families.LoadedFamilies.Collectors;
using Pe.Revit.Global.Revit.Lib.Schedules;
using Pe.Revit.Global.Services.Document;
using ricaun.Revit.UI.Tasks;
using RevitDocument = Autodesk.Revit.DB.Document;

namespace Pe.Revit.Global.Services.Host;

/// <summary>
///     Bridge-backed read-only Revit data requests for browser routes.
/// </summary>
internal sealed class RevitDataRequestService {
    private static readonly TimeSpan CatalogCacheWindow = TimeSpan.FromSeconds(10);
    private static readonly TimeSpan BindingsCacheWindow = TimeSpan.FromSeconds(10);

    private readonly RevitDataCache _cache;
    private readonly Action<string>? _notificationSink;
    private readonly RevitTaskService _revitTaskService;

    public RevitDataRequestService(
        RevitTaskService revitTaskService,
        RevitDataCache cache,
        Action<string>? notificationSink = null
    ) {
        this._revitTaskService = revitTaskService;
        this._cache = cache;
        this._notificationSink = notificationSink;
    }

    public Task<LoadedFamiliesCatalogEnvelopeResponse> GetLoadedFamiliesCatalogEnvelopeAsync(
        LoadedFamiliesCatalogRequest request
    ) => this._cache.GetOrCreateAsync(
        HostInvalidationDomain.LoadedFamiliesCatalog,
        BuildRequestKey("loaded-families-catalog", request),
        CatalogCacheWindow,
        () => this.EnqueueAsync(() => this.GetLoadedFamiliesCatalogCore(request))
    );

    public Task<ScheduleCatalogEnvelopeResponse> GetScheduleCatalogEnvelopeAsync(
        ScheduleCatalogRequest request
    ) => this._cache.GetOrCreateAsync(
        HostInvalidationDomain.ScheduleCatalog,
        BuildRequestKey("schedule-catalog", request),
        CatalogCacheWindow,
        () => this.EnqueueAsync(() => this.GetScheduleCatalogCore(request))
    );

    public Task<ScheduleSpecsQueryEnvelopeResponse> GetScheduleSpecsQueryEnvelopeAsync(
        ScheduleSpecsQueryRequest request
    ) => this._cache.GetOrCreateAsync(
        HostInvalidationDomain.ScheduleSpecsQuery,
        BuildRequestKey("schedule-specs-query", request),
        CatalogCacheWindow,
        () => this.EnqueueAsync(() => this.GetScheduleSpecsQueryCore(request))
    );

    public Task<ScheduleQueryEnvelopeResponse> GetScheduleQueryEnvelopeAsync(
        ScheduleQueryRequest request
    ) => this._cache.GetOrCreateAsync(
        HostInvalidationDomain.ScheduleQuery,
        BuildRequestKey("schedule-query", request),
        CatalogCacheWindow,
        () => this.EnqueueAsync(() => this.GetScheduleQueryCore(request))
    );

    public Task<LoadedFamiliesMatrixEnvelopeResponse> GetLoadedFamiliesMatrixEnvelopeAsync(
        LoadedFamiliesMatrixRequest request
    ) => this._cache.CoalesceAsync(
        HostInvalidationDomain.LoadedFamiliesMatrix,
        BuildRequestKey("loaded-families-matrix", request),
        () => this.EnqueueAsync(() => this.GetLoadedFamiliesMatrixCore(request))
    );

    public Task<ProjectParameterBindingsEnvelopeResponse> GetProjectParameterBindingsEnvelopeAsync(
        ProjectParameterBindingsRequest request
    ) => this._cache.GetOrCreateAsync(
        HostInvalidationDomain.ProjectParameterBindings,
        BuildRequestKey("project-parameter-bindings", request),
        BindingsCacheWindow,
        () => this.EnqueueAsync(() => this.GetProjectParameterBindingsCore(request))
    );

    public Task<ElementContextQueryEnvelopeResponse> GetElementContextQueryEnvelopeAsync(
        ElementContextQueryRequest request
    ) => this.EnqueueAsync(() => this.GetElementContextQueryCore(request));

    public Task<ElectricalPanelsCatalogEnvelopeResponse> GetElectricalPanelsCatalogEnvelopeAsync(
        ElectricalPanelsCatalogRequest request
    ) => this._cache.GetOrCreateAsync(
        HostInvalidationDomain.ElectricalPanelsCatalog,
        BuildRequestKey("electrical-panels-catalog", request),
        CatalogCacheWindow,
        () => this.EnqueueAsync(() => this.GetElectricalPanelsCatalogCore(request))
    );

    public Task<ElectricalCircuitsCatalogEnvelopeResponse> GetElectricalCircuitsCatalogEnvelopeAsync(
        ElectricalCircuitsCatalogRequest request
    ) => this._cache.GetOrCreateAsync(
        HostInvalidationDomain.ElectricalCircuitsCatalog,
        BuildRequestKey("electrical-circuits-catalog", request),
        CatalogCacheWindow,
        () => this.EnqueueAsync(() => this.GetElectricalCircuitsCatalogCore(request))
    );

    public Task<ElectricalPanelSchedulesQueryEnvelopeResponse> GetElectricalPanelSchedulesQueryEnvelopeAsync(
        ElectricalPanelSchedulesQueryRequest request
    ) => this._cache.GetOrCreateAsync(
        HostInvalidationDomain.ElectricalPanelSchedulesQuery,
        BuildRequestKey("electrical-panel-schedules-query", request),
        CatalogCacheWindow,
        () => this.EnqueueAsync(() => this.GetElectricalPanelSchedulesQueryCore(request))
    );

    public Task<ElectricalLoadClassificationsCatalogEnvelopeResponse> GetElectricalLoadClassificationsCatalogEnvelopeAsync(
        ElectricalLoadClassificationsCatalogRequest request
    ) => this._cache.GetOrCreateAsync(
        HostInvalidationDomain.ElectricalLoadClassificationsCatalog,
        BuildRequestKey("electrical-load-classifications-catalog", request),
        CatalogCacheWindow,
        () => this.EnqueueAsync(() => this.GetElectricalLoadClassificationsCatalogCore(request))
    );

    public void Invalidate(params HostInvalidationDomain[] domains) =>
        this._cache.Invalidate(domains);

    private LoadedFamiliesCatalogEnvelopeResponse GetLoadedFamiliesCatalogCore(LoadedFamiliesCatalogRequest request) {
        var documentResult = GetActiveProjectDocument();
        if (!documentResult.Ok)
            return documentResult.ToCatalogFailureEnvelope();

        try {
            var data = LoadedFamiliesCatalogCollector.Collect(documentResult.Data!, request.Filter);
            return HostEnvelopeResults.Success(
                data,
                EnvelopeCode.Ok,
                $"Collected {data.Families.Count} loaded families."
            ).ToLoadedFamiliesCatalogEnvelope();
        } catch (Exception ex) {
            return HostEnvelopeResults.Failure<LoadedFamiliesCatalogData>(
                EnvelopeCode.Failed,
                ex.Message,
                [
                    HostEnvelopeResults.ExceptionIssue(
                        "LoadedFamiliesCatalogException",
                        ex,
                        "Verify the active document is a project document and retry."
                    )
                ]
            ).ToLoadedFamiliesCatalogEnvelope();
        }
    }

    private ScheduleCatalogEnvelopeResponse GetScheduleCatalogCore(ScheduleCatalogRequest request) {
        var documentResult = GetActiveProjectDocument();
        if (!documentResult.Ok)
            return documentResult.ToScheduleCatalogFailureEnvelope();

        try {
            var data = ScheduleCatalogCollector.Collect(documentResult.Data!, request);
            return HostEnvelopeResults.Success(
                data,
                EnvelopeCode.Ok,
                $"Collected {data.Entries.Count} schedules."
            ).ToScheduleCatalogEnvelope();
        } catch (Exception ex) {
            return HostEnvelopeResults.Failure<ScheduleCatalogData>(
                EnvelopeCode.Failed,
                ex.Message,
                [
                    HostEnvelopeResults.ExceptionIssue(
                        "ScheduleCatalogException",
                        ex,
                        "Verify the active document is a project document and retry."
                    )
                ]
            ).ToScheduleCatalogEnvelope();
        }
    }

    private ScheduleSpecsQueryEnvelopeResponse GetScheduleSpecsQueryCore(ScheduleSpecsQueryRequest request) {
        var documentResult = GetActiveProjectDocument();
        if (!documentResult.Ok)
            return documentResult.ToScheduleSpecsQueryFailureEnvelope();

        if (request.Query?.Kind == ScheduleSpecsQueryKind.CurrentActiveView &&
            DocumentManager.uiapp.ActiveUIDocument?.ActiveView is not ViewSchedule) {
            return HostEnvelopeResults.Failure<ScheduleSpecsQueryData>(
                EnvelopeCode.Failed,
                "Active view is not a schedule view.",
                [
                    new ValidationIssue(
                        "$.query.kind",
                        null,
                        "ScheduleActiveViewRequired",
                        "error",
                        "Active view is not a schedule view.",
                        "Open a schedule view and retry."
                    )
                ]
            ).ToScheduleSpecsQueryEnvelope();
        }

        try {
            var data = ScheduleSpecQueryCollector.Collect(documentResult.Data!, request.Query);
            return HostEnvelopeResults.Success(
                data,
                EnvelopeCode.Ok,
                $"Collected {data.Entries.Count} schedule specs."
            ).ToScheduleSpecsQueryEnvelope();
        } catch (Exception ex) {
            return HostEnvelopeResults.Failure<ScheduleSpecsQueryData>(
                EnvelopeCode.Failed,
                ex.Message,
                [
                    HostEnvelopeResults.ExceptionIssue(
                        "ScheduleSpecsQueryException",
                        ex,
                        "Verify the active document is a project document and retry."
                    )
                ]
            ).ToScheduleSpecsQueryEnvelope();
        }
    }

    private ScheduleQueryEnvelopeResponse GetScheduleQueryCore(ScheduleQueryRequest request) {
        var documentResult = GetActiveProjectDocument();
        if (!documentResult.Ok)
            return documentResult.ToScheduleQueryFailureEnvelope();

        var activeScheduleView = DocumentManager.uiapp.ActiveUIDocument?.ActiveView as ViewSchedule;
        if (request.Query?.Kind == ScheduleQueryKind.CurrentActiveView &&
            activeScheduleView == null) {
            return HostEnvelopeResults.Failure<ScheduleQueryData>(
                EnvelopeCode.Failed,
                "Active view is not a schedule view.",
                [
                    new ValidationIssue(
                        "$.query.kind",
                        null,
                        "ScheduleActiveViewRequired",
                        "error",
                        "Active view is not a schedule view.",
                        "Open a non-template schedule view and retry."
                    )
                ]
            ).ToScheduleQueryEnvelope();
        }

        if (request.Query?.Kind == ScheduleQueryKind.CurrentActiveView &&
            (activeScheduleView.IsTemplate ||
             activeScheduleView.Name.Contains("<Revision Schedule>", StringComparison.OrdinalIgnoreCase))) {
            return HostEnvelopeResults.Failure<ScheduleQueryData>(
                EnvelopeCode.Failed,
                "Active view is not a supported non-template schedule view.",
                [
                    new ValidationIssue(
                        "$.query.kind",
                        null,
                        "ScheduleProjectionActiveViewRequired",
                        "error",
                        "Active view is not a supported non-template schedule view.",
                        "Open a non-template schedule view and retry."
                    )
                ]
            ).ToScheduleQueryEnvelope();
        }

        try {
            var data = ScheduleQueryCollector.Collect(documentResult.Data!, request.Query);
            return HostEnvelopeResults.Success(
                data,
                EnvelopeCode.Ok,
                $"Collected {data.Entries.Count} schedule projections."
            ).ToScheduleQueryEnvelope();
        } catch (Exception ex) {
            return HostEnvelopeResults.Failure<ScheduleQueryData>(
                EnvelopeCode.Failed,
                ex.Message,
                [
                    HostEnvelopeResults.ExceptionIssue(
                        "ScheduleQueryException",
                        ex,
                        "Verify the active document is a project document and retry."
                    )
                ]
            ).ToScheduleQueryEnvelope();
        }
    }

    private LoadedFamiliesMatrixEnvelopeResponse GetLoadedFamiliesMatrixCore(LoadedFamiliesMatrixRequest request) {
        var filterValidation = ValidateMatrixFilter(request);
        if (!filterValidation.Ok) {
            return HostEnvelopeResults.Failure<LoadedFamiliesMatrixData>(
                filterValidation.Code,
                filterValidation.Message,
                filterValidation.Issues
            ).ToLoadedFamiliesMatrixEnvelope();
        }

        var documentResult = GetActiveProjectDocument();
        if (!documentResult.Ok)
            return documentResult.ToMatrixFailureEnvelope();

        try {
            var data = LoadedFamiliesMatrixCollector.Collect(
                documentResult.Data!,
                filterValidation.Data,
                this.PublishLoadedFamilyMatrixProgress
            );
            return HostEnvelopeResults.Success(
                data,
                EnvelopeCode.Ok,
                $"Collected {data.Families.Count} loaded family matrix rows."
            ).ToLoadedFamiliesMatrixEnvelope();
        } catch (Exception ex) {
            return HostEnvelopeResults.Failure<LoadedFamiliesMatrixData>(
                EnvelopeCode.Failed,
                ex.Message,
                [
                    HostEnvelopeResults.ExceptionIssue(
                        "LoadedFamiliesMatrixException",
                        ex,
                        "Verify the active document is a project document and retry."
                    )
                ]
            ).ToLoadedFamiliesMatrixEnvelope();
        }
    }

    private ProjectParameterBindingsEnvelopeResponse GetProjectParameterBindingsCore(
        ProjectParameterBindingsRequest request
    ) {
        var documentResult = GetActiveProjectDocument();
        if (!documentResult.Ok)
            return documentResult.ToProjectBindingsFailureEnvelope();

        try {
            var data = ProjectParameterBindingsCollector.Collect(documentResult.Data!, request.Filter);
            return HostEnvelopeResults.Success(
                data,
                EnvelopeCode.Ok,
                $"Collected {data.Entries.Count} project parameter bindings."
            ).ToProjectParameterBindingsEnvelope();
        } catch (Exception ex) {
            return HostEnvelopeResults.Failure<ProjectParameterBindingsData>(
                EnvelopeCode.Failed,
                ex.Message,
                [
                    HostEnvelopeResults.ExceptionIssue(
                        "ProjectParameterBindingsException",
                        ex,
                        "Verify the active document is a project document and retry."
                    )
                ]
            ).ToProjectParameterBindingsEnvelope();
        }
    }

    private ElementContextQueryEnvelopeResponse GetElementContextQueryCore(
        ElementContextQueryRequest request
    ) {
        var documentResult = GetActiveDocument();
        if (!documentResult.Ok)
            return documentResult.ToElementContextQueryFailureEnvelope();

        try {
            var data = ElementContextCollector.Collect(documentResult.Data!, request.Query);
            return HostEnvelopeResults.Success(
                data,
                EnvelopeCode.Ok,
                $"Collected {data.Entries.Count} element contexts."
            ).ToElementContextQueryEnvelope();
        } catch (Exception ex) {
            return HostEnvelopeResults.Failure<ElementContextQueryData>(
                EnvelopeCode.Failed,
                ex.Message,
                [
                    HostEnvelopeResults.ExceptionIssue(
                        "ElementContextQueryException",
                        ex,
                        "Verify a Revit document is active and retry."
                    )
                ]
            ).ToElementContextQueryEnvelope();
        }
    }

    private ElectricalPanelsCatalogEnvelopeResponse GetElectricalPanelsCatalogCore(
        ElectricalPanelsCatalogRequest request
    ) {
        var documentResult = GetActiveProjectDocument();
        if (!documentResult.Ok)
            return documentResult.ToElectricalPanelsFailureEnvelope();

        try {
            var data = ElectricalPanelsCatalogCollector.Collect(documentResult.Data!, request);
            return HostEnvelopeResults.Success(
                data,
                EnvelopeCode.Ok,
                $"Collected {data.Entries.Count} electrical panels."
            ).ToElectricalPanelsCatalogEnvelope();
        } catch (Exception ex) {
            return HostEnvelopeResults.Failure<ElectricalPanelsCatalogData>(
                EnvelopeCode.Failed,
                ex.Message,
                [
                    HostEnvelopeResults.ExceptionIssue(
                        "ElectricalPanelsCatalogException",
                        ex,
                        "Verify the active document is a project document and retry."
                    )
                ]
            ).ToElectricalPanelsCatalogEnvelope();
        }
    }

    private ElectricalCircuitsCatalogEnvelopeResponse GetElectricalCircuitsCatalogCore(
        ElectricalCircuitsCatalogRequest request
    ) {
        var documentResult = GetActiveProjectDocument();
        if (!documentResult.Ok)
            return documentResult.ToElectricalCircuitsFailureEnvelope();

        try {
            var data = ElectricalCircuitsCatalogCollector.Collect(documentResult.Data!, request);
            return HostEnvelopeResults.Success(
                data,
                EnvelopeCode.Ok,
                $"Collected {data.Entries.Count} electrical circuits."
            ).ToElectricalCircuitsCatalogEnvelope();
        } catch (Exception ex) {
            return HostEnvelopeResults.Failure<ElectricalCircuitsCatalogData>(
                EnvelopeCode.Failed,
                ex.Message,
                [
                    HostEnvelopeResults.ExceptionIssue(
                        "ElectricalCircuitsCatalogException",
                        ex,
                        "Verify the active document is a project document and retry."
                    )
                ]
            ).ToElectricalCircuitsCatalogEnvelope();
        }
    }

    private ElectricalPanelSchedulesQueryEnvelopeResponse GetElectricalPanelSchedulesQueryCore(
        ElectricalPanelSchedulesQueryRequest request
    ) {
        var documentResult = GetActiveProjectDocument();
        if (!documentResult.Ok)
            return documentResult.ToElectricalPanelSchedulesQueryFailureEnvelope();

        if (request.Query?.Kind == ElectricalPanelSchedulesQueryKind.CurrentActiveView &&
            DocumentManager.uiapp.ActiveUIDocument?.ActiveView is not Autodesk.Revit.DB.Electrical.PanelScheduleView) {
            return HostEnvelopeResults.Failure<ElectricalPanelSchedulesQueryData>(
                EnvelopeCode.Failed,
                "Active view is not a panel schedule view.",
                [
                    new ValidationIssue(
                        "$.query.kind",
                        null,
                        "PanelScheduleActiveViewRequired",
                        "error",
                        "Active view is not a panel schedule view.",
                        "Open a panel schedule view and retry."
                    )
                ]
            ).ToElectricalPanelSchedulesQueryEnvelope();
        }

        try {
            var data = ElectricalPanelScheduleQueryCollector.Collect(documentResult.Data!, request.Query);
            return HostEnvelopeResults.Success(
                data,
                EnvelopeCode.Ok,
                $"Collected {data.Entries.Count} electrical panel schedules."
            ).ToElectricalPanelSchedulesQueryEnvelope();
        } catch (Exception ex) {
            return HostEnvelopeResults.Failure<ElectricalPanelSchedulesQueryData>(
                EnvelopeCode.Failed,
                ex.Message,
                [
                    HostEnvelopeResults.ExceptionIssue(
                        "ElectricalPanelSchedulesQueryException",
                        ex,
                        "Verify the active document is a project document and retry."
                    )
                ]
            ).ToElectricalPanelSchedulesQueryEnvelope();
        }
    }

    private ElectricalLoadClassificationsCatalogEnvelopeResponse GetElectricalLoadClassificationsCatalogCore(
        ElectricalLoadClassificationsCatalogRequest request
    ) {
        var documentResult = GetActiveProjectDocument();
        if (!documentResult.Ok)
            return documentResult.ToElectricalLoadClassificationsFailureEnvelope();

        try {
            var data = ElectricalLoadClassificationsCatalogCollector.Collect(documentResult.Data!, request);
            return HostEnvelopeResults.Success(
                data,
                EnvelopeCode.Ok,
                $"Collected {data.Entries.Count} electrical load classifications."
            ).ToElectricalLoadClassificationsCatalogEnvelope();
        } catch (Exception ex) {
            return HostEnvelopeResults.Failure<ElectricalLoadClassificationsCatalogData>(
                EnvelopeCode.Failed,
                ex.Message,
                [
                    HostEnvelopeResults.ExceptionIssue(
                        "ElectricalLoadClassificationsCatalogException",
                        ex,
                        "Verify the active document is a project document and retry."
                    )
                ]
            ).ToElectricalLoadClassificationsCatalogEnvelope();
        }
    }

    private static HostEnvelopeResult<LoadedFamiliesFilter> ValidateMatrixFilter(LoadedFamiliesMatrixRequest request) {
        var categoryNames = request.Filter?.CategoryNames
            .Where(name => !string.IsNullOrWhiteSpace(name))
            .Select(name => name.Trim())
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList() ?? [];
        if (categoryNames.Count == 0) {
            return HostEnvelopeResults.Failure<LoadedFamiliesFilter>(
                EnvelopeCode.Failed,
                "Loaded families matrix requires at least one category filter.",
                [
                    new ValidationIssue(
                        "$.filter.categoryNames",
                        null,
                        "CategoryFilterRequired",
                        "error",
                        "Loaded families matrix requires at least one category filter.",
                        "Provide one or more category names and retry."
                    )
                ]
            );
        }

        var filter = (request.Filter ?? new LoadedFamiliesFilter()) with { CategoryNames = categoryNames };
        return HostEnvelopeResults.Success(
            filter,
            EnvelopeCode.Ok,
            $"Loaded families matrix will collect {categoryNames.Count} categor{(categoryNames.Count == 1 ? "y" : "ies")}."
        );
    }

    private async Task<T> EnqueueAsync<T>(Func<T> action) {
        T? result = default;
        _ = await this._revitTaskService.Run(async () => {
            result = action();
            await Task.CompletedTask;
        });
        return result!;
    }

    private void PublishLoadedFamilyMatrixProgress(string message) =>
        this._notificationSink?.Invoke(message);

    private static HostEnvelopeResult<RevitDocument> GetActiveDocument() {
        var document = DocumentManager.uiapp.ActiveUIDocument?.Document;
        if (document == null) {
            return HostEnvelopeResults.Failure<RevitDocument>(
                EnvelopeCode.NoDocument,
                "No active document.",
                [
                    new ValidationIssue(
                        "$",
                        null,
                        "NoActiveDocument",
                        "error",
                        "No active document.",
                        "Open a Revit document and retry."
                    )
                ]
            );
        }

        return HostEnvelopeResults.Success(document, EnvelopeCode.Ok, "Document is available.");
    }

    private static HostEnvelopeResult<RevitDocument> GetActiveProjectDocument() {
        var documentResult = GetActiveDocument();
        if (!documentResult.Ok)
            return documentResult;

        var document = documentResult.Data!;

        if (document.IsFamilyDocument) {
            return HostEnvelopeResults.Failure<RevitDocument>(
                EnvelopeCode.Failed,
                "These Revit data routes support project documents only.",
                [
                    new ValidationIssue(
                        "$",
                        null,
                        "UnsupportedDocumentType",
                        "error",
                        "These Revit data routes support project documents only.",
                        "Activate a project document and retry."
                    )
                ]
            );
        }

        return HostEnvelopeResults.Success(document, EnvelopeCode.Ok, "Project document is available.");
    }

    private static string BuildRequestKey(string prefix, object request) =>
        $"{prefix}:{JsonConvert.SerializeObject(request)}";
}

internal static class RevitDataRequestResultExtensions {
    public static ElementContextQueryEnvelopeResponse ToElementContextQueryFailureEnvelope(
        this HostEnvelopeResult<RevitDocument> result
    ) => new(result.Ok, result.Code, result.Message, result.Issues, null);

    public static ElementContextQueryEnvelopeResponse ToElementContextQueryEnvelope(
        this HostEnvelopeResult<ElementContextQueryData> result
    ) => new(result.Ok, result.Code, result.Message, result.Issues, result.Data);

    public static ScheduleCatalogEnvelopeResponse ToScheduleCatalogFailureEnvelope(
        this HostEnvelopeResult<RevitDocument> result) =>
        new(result.Ok, result.Code, result.Message, result.Issues, null);

    public static ScheduleSpecsQueryEnvelopeResponse ToScheduleSpecsQueryFailureEnvelope(
        this HostEnvelopeResult<RevitDocument> result
    ) => new(result.Ok, result.Code, result.Message, result.Issues, null);

    public static ScheduleQueryEnvelopeResponse ToScheduleQueryFailureEnvelope(
        this HostEnvelopeResult<RevitDocument> result
    ) => new(result.Ok, result.Code, result.Message, result.Issues, null);

    public static LoadedFamiliesCatalogEnvelopeResponse ToCatalogFailureEnvelope(
        this HostEnvelopeResult<RevitDocument> result) =>
        new(result.Ok, result.Code, result.Message, result.Issues, null);

    public static LoadedFamiliesMatrixEnvelopeResponse ToMatrixFailureEnvelope(
        this HostEnvelopeResult<RevitDocument> result) =>
        new(result.Ok, result.Code, result.Message, result.Issues, null);

    public static ProjectParameterBindingsEnvelopeResponse ToProjectBindingsFailureEnvelope(
        this HostEnvelopeResult<RevitDocument> result) =>
        new(result.Ok, result.Code, result.Message, result.Issues, null);

    public static ElectricalPanelsCatalogEnvelopeResponse ToElectricalPanelsFailureEnvelope(
        this HostEnvelopeResult<RevitDocument> result
    ) => new(result.Ok, result.Code, result.Message, result.Issues, null);

    public static ElectricalCircuitsCatalogEnvelopeResponse ToElectricalCircuitsFailureEnvelope(
        this HostEnvelopeResult<RevitDocument> result
    ) => new(result.Ok, result.Code, result.Message, result.Issues, null);

    public static ElectricalPanelSchedulesQueryEnvelopeResponse ToElectricalPanelSchedulesQueryFailureEnvelope(
        this HostEnvelopeResult<RevitDocument> result
    ) => new(result.Ok, result.Code, result.Message, result.Issues, null);

    public static ElectricalLoadClassificationsCatalogEnvelopeResponse ToElectricalLoadClassificationsFailureEnvelope(
        this HostEnvelopeResult<RevitDocument> result
    ) => new(result.Ok, result.Code, result.Message, result.Issues, null);
}
