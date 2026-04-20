using Autodesk.Revit.DB.Electrical;
using Newtonsoft.Json;
using Pe.Revit.Global.Revit.Lib.Electrical;
using Pe.Revit.Global.Revit.Lib.Families.LoadedFamilies.Collectors;
using Pe.Revit.Global.Revit.Lib.Schedules;
using Pe.Revit.Global.Revit.Lib.Selection;
using Pe.Shared.HostContracts.Protocol;
using Pe.Shared.HostContracts.RevitData;
using Pe.Shared.HostContracts.SettingsStorage;
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

    public Task<ScheduleProfilesQueryEnvelopeResponse> GetScheduleProfilesQueryEnvelopeAsync(
        ScheduleProfilesQueryRequest request
    ) => this._cache.GetOrCreateAsync(
        HostInvalidationDomain.ScheduleProfilesQuery,
        BuildRequestKey("schedule-profiles-query", request),
        CatalogCacheWindow,
        () => this.EnqueueAsync(() => this.GetScheduleProfilesQueryCore(request))
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

    public Task<ElectricalLoadClassificationsCatalogEnvelopeResponse>
        GetElectricalLoadClassificationsCatalogEnvelopeAsync(
            ElectricalLoadClassificationsCatalogRequest request
        ) => this._cache.GetOrCreateAsync(
        HostInvalidationDomain.ElectricalLoadClassificationsCatalog,
        BuildRequestKey("electrical-load-classifications-catalog", request),
        CatalogCacheWindow,
        () => this.EnqueueAsync(() => this.GetElectricalLoadClassificationsCatalogCore(request))
    );

    public Task<RevitDocumentSessionContextEnvelopeResponse> GetRevitDocumentSessionContextEnvelopeAsync(
        RevitDocumentSessionContextRequest request
    ) => this.EnqueueAsync(() => this.GetRevitDocumentSessionContextCore(request));

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

    private ScheduleProfilesQueryEnvelopeResponse GetScheduleProfilesQueryCore(ScheduleProfilesQueryRequest request) {
        var documentResult = GetActiveProjectDocument();
        if (!documentResult.Ok)
            return documentResult.ToScheduleProfilesQueryFailureEnvelope();

        var uiApp = RevitUiSession.CurrentUIApplication;
        if (request.Query?.Kind == ScheduleProfilesQueryKind.CurrentActiveView &&
            uiApp.GetActiveView() is not ViewSchedule) {
            return HostEnvelopeResults.Failure<ScheduleProfilesQueryData>(
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
            ).ToScheduleProfilesQueryEnvelope();
        }

        try {
            var data = ScheduleProfileQueryCollector.Collect(documentResult.Data!, request.Query);
            return HostEnvelopeResults.Success(
                data,
                EnvelopeCode.Ok,
                $"Collected {data.Entries.Count} schedule profiles."
            ).ToScheduleProfilesQueryEnvelope();
        } catch (Exception ex) {
            return HostEnvelopeResults.Failure<ScheduleProfilesQueryData>(
                EnvelopeCode.Failed,
                ex.Message,
                [
                    HostEnvelopeResults.ExceptionIssue(
                        "ScheduleProfilesQueryException",
                        ex,
                        "Verify the active document is a project document and retry."
                    )
                ]
            ).ToScheduleProfilesQueryEnvelope();
        }
    }

    private ScheduleQueryEnvelopeResponse GetScheduleQueryCore(ScheduleQueryRequest request) {
        var documentResult = GetActiveProjectDocument();
        if (!documentResult.Ok)
            return documentResult.ToScheduleQueryFailureEnvelope();

        var activeScheduleView = RevitUiSession.CurrentUIApplication.GetActiveView() as ViewSchedule;
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
            activeScheduleView is not null &&
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

        var uiApp = RevitUiSession.CurrentUIApplication;
        if (request.Query?.Kind == ElectricalPanelSchedulesQueryKind.CurrentActiveView &&
            uiApp.GetActiveView() is not PanelScheduleView) {
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

    private RevitDocumentSessionContextEnvelopeResponse GetRevitDocumentSessionContextCore(
        RevitDocumentSessionContextRequest request
    ) {
        try {
            var uiApp = RevitUiSession.CurrentUIApplication;
            var activeDocument = uiApp.GetActiveDocument();
            var openDocuments = uiApp.GetOpenDocuments()
                .ToList();
            var openDocumentSummaries = openDocuments
                .Select(doc => CreateDocumentSummary(doc, activeDocument))
                .OrderByDescending(doc => doc.IsActive)
                .ThenBy(doc => doc.Title, StringComparer.OrdinalIgnoreCase)
                .ToList();
            var activeDocumentSummary = openDocumentSummaries.FirstOrDefault(doc => doc.IsActive);

            var baseData = new RevitDocumentSessionContextData(
                activeDocumentSummary != null,
                activeDocumentSummary,
                null,
                openDocumentSummaries.Count,
                openDocumentSummaries,
                []
            );

            if (!HasTargetDocumentCriteria(request.TargetDocument)) {
                var resolvedData = baseData with { ResolvedDocument = activeDocumentSummary };
                var message = activeDocumentSummary == null
                    ? "Collected Revit document session context. No active document is currently available."
                    : $"Collected Revit document session context. Active document '{activeDocumentSummary.Title}' is the default target.";
                return HostEnvelopeResults.Success(
                    resolvedData,
                    EnvelopeCode.Ok,
                    message
                ).ToRevitDocumentSessionContextEnvelope();
            }

            var resolution = ResolveTargetDocument(openDocumentSummaries, request.TargetDocument!);
            if (!resolution.Ok) {
                return new RevitDocumentSessionContextEnvelopeResponse(
                    false,
                    resolution.Code,
                    resolution.Message,
                    resolution.Issues,
                    baseData
                );
            }

            var data = baseData with { ResolvedDocument = resolution.Data };
            return HostEnvelopeResults.Success(
                data,
                EnvelopeCode.Ok,
                $"Collected Revit document session context. Resolved target document '{resolution.Data!.Title}'."
            ).ToRevitDocumentSessionContextEnvelope();
        } catch (Exception ex) {
            return HostEnvelopeResults.Failure<RevitDocumentSessionContextData>(
                EnvelopeCode.Failed,
                ex.Message,
                [
                    HostEnvelopeResults.ExceptionIssue(
                        "RevitDocumentSessionContextException",
                        ex,
                        "Verify the Revit session is open and retry."
                    )
                ]
            ).ToRevitDocumentSessionContextEnvelope();
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

    private static RevitDocumentSummary CreateDocumentSummary(
        RevitDocument document,
        RevitDocument? activeDocument
    ) {
        var documentKey = document.GetDocumentKey();
        var activeDocumentKey = activeDocument == null ? null : activeDocument.GetDocumentKey();
        return new RevitDocumentSummary(
            documentKey,
            document.Title,
            document.GetDocumentPath(),
            document.IsFamilyDocument,
            document.IsWorkshared,
            string.Equals(documentKey, activeDocumentKey, StringComparison.OrdinalIgnoreCase),
            document.IsModifiable,
            document.IsReadOnly,
            document.IsModelInCloud,
            document.GetCloudProjectGuid(),
            document.GetCloudModelGuid(),
            document.GetCloudModelUrn()
        );
    }

    private static bool HasTargetDocumentCriteria(RevitDocumentSelector? target) =>
        target != null && (
            !string.IsNullOrWhiteSpace(target.DocumentKey) ||
            !string.IsNullOrWhiteSpace(target.Path) ||
            !string.IsNullOrWhiteSpace(target.Title) ||
            target.IsFamilyDocument.HasValue
        );

    private static HostEnvelopeResult<RevitDocumentSummary> ResolveTargetDocument(
        IReadOnlyList<RevitDocumentSummary> openDocuments,
        RevitDocumentSelector target
    ) {
        var candidates = openDocuments
            .Where(doc =>
                MatchesFilter(doc.DocumentKey, target.DocumentKey) &&
                MatchesFilter(doc.Path, target.Path) &&
                MatchesFilter(doc.Title, target.Title) &&
                (!target.IsFamilyDocument.HasValue || doc.IsFamilyDocument == target.IsFamilyDocument.Value))
            .ToList();

        if (candidates.Count == 1) {
            return HostEnvelopeResults.Success(
                candidates[0],
                EnvelopeCode.Ok,
                $"Resolved target document '{candidates[0].Title}'."
            );
        }

        if (candidates.Count == 0) {
            return HostEnvelopeResults.Failure<RevitDocumentSummary>(
                EnvelopeCode.Failed,
                "Target document did not match any open Revit document.",
                [
                    new ValidationIssue(
                        "$.targetDocument",
                        null,
                        "TargetDocumentNotFound",
                        "error",
                        "Target document did not match any open Revit document.",
                        "Inspect openDocuments from this response or refresh host-status and retry with a current document key."
                    )
                ]
            );
        }

        return HostEnvelopeResults.Failure<RevitDocumentSummary>(
            EnvelopeCode.Failed,
            "Target document matched multiple open Revit documents.",
            [
                new ValidationIssue(
                    "$.targetDocument",
                    null,
                    "TargetDocumentAmbiguous",
                    "error",
                    "Target document matched multiple open Revit documents.",
                    "Provide documentKey or path to disambiguate the target document."
                )
            ]
        );
    }

    private static bool MatchesFilter(string? actual, string? expected) =>
        string.IsNullOrWhiteSpace(expected) ||
        string.Equals(actual, expected, StringComparison.OrdinalIgnoreCase);

    private static HostEnvelopeResult<RevitDocument> GetActiveDocument() {
        var document = RevitUiSession.CurrentUIApplication.GetActiveDocument();
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

    public static ScheduleProfilesQueryEnvelopeResponse ToScheduleProfilesQueryFailureEnvelope(
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