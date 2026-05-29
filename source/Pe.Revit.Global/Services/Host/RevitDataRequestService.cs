using Autodesk.Revit.DB.Electrical;
using Pe.Revit.DocumentData.AgentContext;
using Pe.Revit.DocumentData.Electrical;
using Pe.Revit.DocumentData.Families.Loaded.Collectors;
using Pe.Revit.DocumentData.Parameters;
using Pe.Revit.DocumentData.ProjectBrowser;
using Pe.Revit.DocumentData.ProjectIndex;
using Pe.Revit.DocumentData.Schedules.Collect;
using Pe.Revit.DocumentData.Selection;
using Pe.Revit.DocumentData.Sheets;
using Pe.Shared.HostContracts.SettingsStorage;
using Pe.Shared.RevitData;
using Pe.Shared.RevitData.Schedules;
using ricaun.Revit.UI.Tasks;
using System.Runtime.ExceptionServices;
using RevitDocument = Autodesk.Revit.DB.Document;

namespace Pe.Revit.Global.Services.Host;

/// <summary>
///     Bridge-backed read-only Revit data requests for browser routes.
/// </summary>
internal sealed class RevitDataRequestService(RevitTaskService revitTaskService) {
    private readonly RevitTaskService _revitTaskService = revitTaskService;

    public Task<LoadedFamiliesCatalogData> GetLoadedFamiliesCatalogAsync(
        LoadedFamiliesCatalogRequest request
    ) => this.EnqueueAsync(() => this.GetLoadedFamiliesCatalogCore(request));

    public Task<ScheduleCatalogData> GetScheduleCatalogAsync(
        ScheduleCatalogRequest request
    ) => this.EnqueueAsync(() => this.GetScheduleCatalogCore(request));

    public Task<ScheduleProfilesQueryData> GetScheduleProfilesQueryAsync(
        ScheduleProfilesQueryRequest request
    ) => this.EnqueueAsync(() => this.GetScheduleProfilesQueryCore(request));

    public Task<ProjectBrowserData> GetProjectBrowserAsync(
        ProjectBrowserRequest request
    ) => this.EnqueueAsync(() => this.GetProjectBrowserCore(request));

    public Task<ProjectIndexData> GetProjectIndexAsync(
        ProjectIndexRequest request
    ) => this.EnqueueAsync(() => this.GetProjectIndexCore(request));

    public Task<SheetDetailData> GetSheetDetailsAsync(
        SheetDetailRequest request
    ) => this.EnqueueAsync(() => this.GetSheetDetailsCore(request));

    public Task<ScheduleQueryData> GetScheduleQueryAsync(
        ScheduleQueryRequest request
    ) => this.EnqueueAsync(() => this.GetScheduleQueryCore(request));

    public Task<LoadedFamiliesMatrixData> GetLoadedFamiliesMatrixAsync(
        LoadedFamiliesMatrixRequest request
    ) => this.EnqueueAsync(() => this.GetLoadedFamiliesMatrixCore(request));

    public Task<ScheduleCoverageData> GetScheduleCoverageAsync(
        ScheduleCoverageRequest request
    ) => this.EnqueueAsync(() => this.GetScheduleCoverageCore(request));

    public Task<ParameterCoverageData> GetParameterCoverageAsync(
        ParameterCoverageRequest request
    ) => this.EnqueueAsync(() => this.GetParameterCoverageCore(request));

    public Task<ProjectParameterBindingsData> GetProjectParameterBindingsAsync(
        ProjectParameterBindingsRequest request
    ) => this.EnqueueAsync(() => this.GetProjectParameterBindingsCore(request));

    public Task<ElementContextQueryData> GetElementContextQueryAsync(
        ElementContextQueryRequest request
    ) => this.EnqueueAsync(() => this.GetElementContextQueryCore(request));

    public Task<ElectricalPanelsCatalogData> GetElectricalPanelsCatalogAsync(
        ElectricalPanelsCatalogRequest request
    ) => this.EnqueueAsync(() => this.GetElectricalPanelsCatalogCore(request));

    public Task<ElectricalCircuitsCatalogData> GetElectricalCircuitsCatalogAsync(
        ElectricalCircuitsCatalogRequest request
    ) => this.EnqueueAsync(() => this.GetElectricalCircuitsCatalogCore(request));

    public Task<ElectricalPanelSchedulesQueryData> GetElectricalPanelSchedulesQueryAsync(
        ElectricalPanelSchedulesQueryRequest request
    ) => this.EnqueueAsync(() => this.GetElectricalPanelSchedulesQueryCore(request));

    public Task<ElectricalLoadClassificationsCatalogData> GetElectricalLoadClassificationsCatalogAsync(
        ElectricalLoadClassificationsCatalogRequest request
    ) => this.EnqueueAsync(() => this.GetElectricalLoadClassificationsCatalogCore(request));

    public Task<RevitDocumentSessionContextData> GetRevitDocumentSessionContextAsync() =>
        this.EnqueueAsync(this.GetRevitDocumentSessionContextCore);

    public Task<RevitAgentContextSummaryData> GetRevitAgentContextSummaryAsync() =>
        this.EnqueueAsync(this.GetRevitAgentContextSummaryCore);

    public Task<RevitAgentContextResolveData> ResolveRevitAgentContextAsync(
        RevitAgentContextResolveRequest request
    ) => this.EnqueueAsync(() => this.ResolveRevitAgentContextCore(request));

    public Task<RevitAgentVisibleContextData> GetRevitAgentVisibleContextAsync(
        RevitAgentVisibleContextRequest request
    ) => this.EnqueueAsync(() => this.GetRevitAgentVisibleContextCore(request));

    private LoadedFamiliesCatalogData GetLoadedFamiliesCatalogCore(LoadedFamiliesCatalogRequest request) {
        var document = GetActiveProjectDocument();

        try {
            return LoadedFamiliesCatalogCollector.Collect(document, request.Filter, request.Projection, request.Budget);
        } catch (Exception ex) {
            throw BridgeOperationExceptions.Unexpected(
                "LoadedFamiliesCatalogException",
                ex,
                "Verify the active document is a project document and retry."
            );
        }
    }

    private ScheduleCatalogData GetScheduleCatalogCore(ScheduleCatalogRequest request) {
        var document = GetActiveProjectDocument();

        try {
            return ScheduleCatalogCollector.Collect(document, request);
        } catch (Exception ex) {
            throw BridgeOperationExceptions.Unexpected(
                "ScheduleCatalogException",
                ex,
                "Verify the active document is a project document and retry."
            );
        }
    }

    private ProjectBrowserData GetProjectBrowserCore(ProjectBrowserRequest request) {
        var document = GetActiveProjectDocument();

        try {
            return ProjectBrowserCollector.Collect(document, request);
        } catch (Exception ex) {
            throw BridgeOperationExceptions.Unexpected(
                "ProjectBrowserException",
                ex,
                "Verify the active document is a project document and retry."
            );
        }
    }

    private ProjectIndexData GetProjectIndexCore(ProjectIndexRequest request) {
        var document = GetActiveProjectDocument();

        try {
            return ProjectIndexCollector.Collect(document, request);
        } catch (Exception ex) {
            throw BridgeOperationExceptions.Unexpected(
                "ProjectIndexException",
                ex,
                "Verify the active document is a project document and retry."
            );
        }
    }

    private SheetDetailData GetSheetDetailsCore(SheetDetailRequest request) {
        var document = GetActiveProjectDocument();

        try {
            return SheetDetailCollector.Collect(document, RevitUiSession.CurrentUIApplication.GetActiveView(), request);
        } catch (Exception ex) {
            throw BridgeOperationExceptions.Unexpected(
                "SheetDetailsException",
                ex,
                "Verify the active document is a project document and retry."
            );
        }
    }

    private ScheduleProfilesQueryData GetScheduleProfilesQueryCore(ScheduleProfilesQueryRequest request) {
        var document = GetActiveProjectDocument();
        var uiApp = RevitUiSession.CurrentUIApplication;
        if (request.Query?.Kind == ScheduleProfilesQueryKind.CurrentActiveView &&
            uiApp.GetActiveView() is not ViewSchedule) {
            throw BridgeOperationExceptions.Conflict(
                "Active view is not a schedule view.",
                [
                    BridgeOperationExceptions.Issue(
                        "$.query.kind",
                        "ScheduleActiveViewRequired",
                        "Active view is not a schedule view.",
                        "Open a schedule view and retry."
                    )
                ]
            );
        }

        try {
            return ScheduleProfileQueryCollector.Collect(
                document,
                request.Query,
                uiApp.GetActiveView()
            );
        } catch (Exception ex) {
            throw BridgeOperationExceptions.Unexpected(
                "ScheduleProfilesQueryException",
                ex,
                "Verify the active document is a project document and retry."
            );
        }
    }

    private ScheduleQueryData GetScheduleQueryCore(ScheduleQueryRequest request) {
        var document = GetActiveProjectDocument();
        var activeScheduleView = RevitUiSession.CurrentUIApplication.GetActiveView() as ViewSchedule;
        if (request.Query?.Kind == ScheduleQueryKind.CurrentActiveView &&
            activeScheduleView == null) {
            throw BridgeOperationExceptions.Conflict(
                "Active view is not a schedule view.",
                [
                    BridgeOperationExceptions.Issue(
                        "$.query.kind",
                        "ScheduleActiveViewRequired",
                        "Active view is not a schedule view.",
                        "Open a non-template schedule view and retry."
                    )
                ]
            );
        }

        if (request.Query?.Kind == ScheduleQueryKind.CurrentActiveView &&
            activeScheduleView is not null &&
            (activeScheduleView.IsTemplate ||
             activeScheduleView.Name.Contains("<Revision Schedule>", StringComparison.OrdinalIgnoreCase))) {
            throw BridgeOperationExceptions.Conflict(
                "Active view is not a supported non-template schedule view.",
                [
                    BridgeOperationExceptions.Issue(
                        "$.query.kind",
                        "ScheduleProjectionActiveViewRequired",
                        "Active view is not a supported non-template schedule view.",
                        "Open a non-template schedule view and retry."
                    )
                ]
            );
        }

        try {
            return ScheduleQueryCollector.Collect(document, request.Query, activeScheduleView);
        } catch (Exception ex) {
            throw BridgeOperationExceptions.Unexpected(
                "ScheduleQueryException",
                ex,
                "Verify the active document is a project document and retry."
            );
        }
    }

    private LoadedFamiliesMatrixData GetLoadedFamiliesMatrixCore(LoadedFamiliesMatrixRequest request) {
        var filter = ValidateMatrixFilter(request);
        var document = GetActiveProjectDocument();

        try {
            return LoadedFamiliesMatrixCollector.Collect(document, filter, budget: request.Budget);
        } catch (Exception ex) {
            throw BridgeOperationExceptions.Unexpected(
                "LoadedFamiliesMatrixException",
                ex,
                "Verify the active document is a project document and retry."
            );
        }
    }

    private ScheduleCoverageData GetScheduleCoverageCore(ScheduleCoverageRequest request) {
        var document = GetActiveProjectDocument();

        try {
            return ScheduleCoverageCollector.Collect(document, request);
        } catch (Exception ex) {
            throw BridgeOperationExceptions.Unexpected(
                "ScheduleCoverageException",
                ex,
                "Verify the active document is a project document and retry."
            );
        }
    }

    private ParameterCoverageData GetParameterCoverageCore(ParameterCoverageRequest request) {
        var validationIssues = ValidateParameterCoverageRequest(request);
        if (validationIssues.Count != 0) {
            throw BridgeOperationExceptions.BadRequest(
                "Parameter coverage request is invalid.",
                validationIssues
            );
        }

        var document = GetActiveProjectDocument();

        try {
            return ParameterCoverageCollector.Collect(
                document,
                request,
                RevitUiSession.CurrentUIApplication.GetActiveUIDocument()?.Selection.GetElementIds().ToList()
            );
        } catch (Exception ex) {
            throw BridgeOperationExceptions.Unexpected(
                "ParameterCoverageException",
                ex,
                "Verify the active document is a project document and retry."
            );
        }
    }

    private static List<ValidationIssue> ValidateParameterCoverageRequest(ParameterCoverageRequest request) {
        var issues = new List<ValidationIssue>();
        var parameterNames = request.ParameterNames ?? [];
        var sharedGuids = request.SharedGuids ?? [];
        var elementIds = request.ElementIds ?? [];
        var elementUniqueIds = request.ElementUniqueIds ?? [];

        if (parameterNames.Count == 0 && sharedGuids.Count == 0) {
            issues.Add(BridgeOperationExceptions.Issue(
                "$.parameterNames",
                "ParameterCoverageNoParametersRequested",
                "Request at least one parameter name or shared GUID.",
                "Set parameterNames, for example [\"Mark\"], or sharedGuids with valid GUID strings. Optional arrays may be omitted. Allowed scope values: All, ActiveViewVisible, CurrentSelection, ExplicitHandles. Allowed lookupPreference values: InstanceThenType, InstanceOnly, TypeOnly."
            ));
        }

        if (request.Scope == RevitElementScope.ExplicitHandles &&
            elementIds.Count == 0 &&
            elementUniqueIds.Count == 0) {
            issues.Add(BridgeOperationExceptions.Issue(
                "$.scope",
                "ParameterCoverageExplicitHandlesRequired",
                "ExplicitHandles scope requires elementIds or elementUniqueIds.",
                "Use CurrentSelection/ActiveViewVisible, or provide elementIds/elementUniqueIds from a prior handle result. Allowed scope values: All, ActiveViewVisible, CurrentSelection, ExplicitHandles."
            ));
        }

        for (var i = 0; i < sharedGuids.Count; i++) {
            if (!Guid.TryParse(sharedGuids[i], out _)) {
                issues.Add(BridgeOperationExceptions.Issue(
                    $"$.sharedGuids[{i}]",
                    "ParameterCoverageInvalidSharedGuid",
                    $"'{sharedGuids[i]}' is not a valid GUID.",
                    "Use canonical shared parameter GUID strings such as 00000000-0000-0000-0000-000000000000."
                ));
            }
        }

        return issues;
    }

    private ProjectParameterBindingsData GetProjectParameterBindingsCore(
        ProjectParameterBindingsRequest request
    ) {
        var document = GetActiveProjectDocument();

        try {
            return ProjectParameterBindingsCollector.Collect(document, request.Filter, request.BindingFilter, request.Projection, request.Budget);
        } catch (Exception ex) {
            throw BridgeOperationExceptions.Unexpected(
                "ProjectParameterBindingsException",
                ex,
                "Verify the active document is a project document and retry."
            );
        }
    }

    private ElementContextQueryData GetElementContextQueryCore(
        ElementContextQueryRequest request
    ) {
        var document = GetActiveDocument();

        try {
            return ElementContextCollector.Collect(
                document,
                request.Query,
                RevitUiSession.CurrentUIApplication.GetActiveUIDocument()?.Selection.GetElementIds().ToList()
            );
        } catch (Exception ex) {
            throw BridgeOperationExceptions.Unexpected(
                "ElementContextQueryException",
                ex,
                "Verify a Revit document is active and retry."
            );
        }
    }

    private ElectricalPanelsCatalogData GetElectricalPanelsCatalogCore(
        ElectricalPanelsCatalogRequest request
    ) {
        var document = GetActiveProjectDocument();

        try {
            return ElectricalPanelsCatalogCollector.Collect(document, request.Filter);
        } catch (Exception ex) {
            throw BridgeOperationExceptions.Unexpected(
                "ElectricalPanelsCatalogException",
                ex,
                "Verify the active document is a project document and retry."
            );
        }
    }

    private ElectricalCircuitsCatalogData GetElectricalCircuitsCatalogCore(
        ElectricalCircuitsCatalogRequest request
    ) {
        var document = GetActiveProjectDocument();

        try {
            return ElectricalCircuitsCatalogCollector.Collect(document, request.Filter, request.Options);
        } catch (Exception ex) {
            throw BridgeOperationExceptions.Unexpected(
                "ElectricalCircuitsCatalogException",
                ex,
                "Verify the active document is a project document and retry."
            );
        }
    }

    private ElectricalPanelSchedulesQueryData GetElectricalPanelSchedulesQueryCore(
        ElectricalPanelSchedulesQueryRequest request
    ) {
        var document = GetActiveProjectDocument();
        var activeView = RevitUiSession.CurrentUIApplication.GetActiveView();
        if (request.Query?.Kind == ElectricalPanelSchedulesQueryKind.CurrentActiveView &&
            activeView is not PanelScheduleView) {
            throw BridgeOperationExceptions.Conflict(
                "Active view is not a panel schedule view.",
                [
                    BridgeOperationExceptions.Issue(
                        "$.query.kind",
                        "PanelScheduleActiveViewRequired",
                        "Active view is not a panel schedule view.",
                        "Open a panel schedule view and retry."
                    )
                ]
            );
        }

        try {
            return ElectricalPanelScheduleQueryCollector.Collect(
                document,
                request.Query,
                activeView
            );
        } catch (Exception ex) {
            throw BridgeOperationExceptions.Unexpected(
                "ElectricalPanelSchedulesQueryException",
                ex,
                "Verify the active document is a project document and retry."
            );
        }
    }

    private ElectricalLoadClassificationsCatalogData GetElectricalLoadClassificationsCatalogCore(
        ElectricalLoadClassificationsCatalogRequest request
    ) {
        var document = GetActiveProjectDocument();

        try {
            return ElectricalLoadClassificationsCatalogCollector.Collect(document, request.Filter);
        } catch (Exception ex) {
            throw BridgeOperationExceptions.Unexpected(
                "ElectricalLoadClassificationsCatalogException",
                ex,
                "Verify the active document is a project document and retry."
            );
        }
    }

    private RevitDocumentSessionContextData GetRevitDocumentSessionContextCore() {
        try {
            return CreateDocumentSessionContext();
        } catch (Exception ex) {
            throw BridgeOperationExceptions.Unexpected(
                "RevitDocumentSessionContextException",
                ex,
                "Verify the Revit session is open and retry."
            );
        }
    }

    private RevitAgentContextSummaryData GetRevitAgentContextSummaryCore() {
        try {
            var document = GetActiveDocument();
            var uiApp = RevitUiSession.CurrentUIApplication;
            return RevitAgentContextCollector.CollectSummary(
                document,
                CreateDocumentSessionContext(),
                uiApp.GetActiveView(),
                uiApp.GetActiveUIDocument()?.Selection.GetElementIds().ToList()
            );
        } catch (Exception ex) {
            throw BridgeOperationExceptions.Unexpected(
                "RevitAgentContextSummaryException",
                ex,
                "Verify a Revit document is active and retry."
            );
        }
    }

    private RevitAgentContextResolveData ResolveRevitAgentContextCore(
        RevitAgentContextResolveRequest request
    ) {
        var document = GetActiveDocument();
        try {
            var uiApp = RevitUiSession.CurrentUIApplication;
            return RevitAgentContextCollector.Resolve(
                document,
                uiApp.GetActiveView(),
                uiApp.GetActiveUIDocument()?.Selection.GetElementIds().ToList(),
                request
            );
        } catch (Exception ex) {
            throw BridgeOperationExceptions.Unexpected(
                "RevitAgentContextResolveException",
                ex,
                "Verify a Revit document is active and retry."
            );
        }
    }

    private RevitAgentVisibleContextData GetRevitAgentVisibleContextCore(
        RevitAgentVisibleContextRequest request
    ) {
        var document = GetActiveDocument();
        try {
            return RevitAgentContextCollector.CollectVisibleContext(
                document,
                RevitUiSession.CurrentUIApplication.GetActiveView(),
                request
            );
        } catch (Exception ex) {
            throw BridgeOperationExceptions.Unexpected(
                "RevitAgentVisibleContextException",
                ex,
                "Verify a Revit document and active view are available, then retry."
            );
        }
    }

    private static LoadedFamiliesFilter ValidateMatrixFilter(LoadedFamiliesMatrixRequest request) {
        var categoryNames = request.Filter?.CategoryNames
            .Where(name => !string.IsNullOrWhiteSpace(name))
            .Select(name => name.Trim())
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList() ?? [];
        if (categoryNames.Count == 0) {
            throw BridgeOperationExceptions.Conflict(
                "Loaded families matrix requires at least one category filter.",
                [
                    BridgeOperationExceptions.Issue(
                        "$.filter.categoryNames",
                        "CategoryFilterRequired",
                        "Loaded families matrix requires at least one category filter.",
                        "Provide one or more category names and retry."
                    )
                ]
            );
        }

        return (request.Filter ?? new LoadedFamiliesFilter()) with { CategoryNames = categoryNames };
    }

    private async Task<T> EnqueueAsync<T>(Func<T> action) {
        T? result = default;
        Exception? failure = null;
        var completed = false;
        _ = await this._revitTaskService.Run(async () => {
            try {
                result = action();
                completed = true;
            } catch (Exception ex) {
                failure = ex;
            }

            await Task.CompletedTask;
        });

        if (failure != null)
            ExceptionDispatchInfo.Capture(failure).Throw();

        if (!completed) {
            throw BridgeOperationExceptions.Unexpected(
                "RequestQueueNoResult",
                new InvalidOperationException($"Revit request queue produced no result for '{typeof(T).Name}'."),
                "Check the Revit task queue execution path for swallowed exceptions."
            );
        }

        return result!;
    }

    private static RevitDocumentSessionContextData CreateDocumentSessionContext() {
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

        return new RevitDocumentSessionContextData(
            activeDocumentSummary != null,
            activeDocumentSummary,
            openDocumentSummaries.Count,
            openDocumentSummaries
        );
    }

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

    private static RevitDocument GetActiveDocument() {
        var document = RevitUiSession.CurrentUIApplication.GetActiveDocument();
        if (document == null) {
            throw BridgeOperationExceptions.Conflict(
                "No active document.",
                [
                    BridgeOperationExceptions.Issue(
                        "$",
                        "NoActiveDocument",
                        "No active document.",
                        "Open a Revit document and retry."
                    )
                ]
            );
        }

        return document;
    }

    private static RevitDocument GetActiveProjectDocument() {
        var document = GetActiveDocument();

        if (document.IsFamilyDocument) {
            throw BridgeOperationExceptions.Conflict(
                "These Revit data routes support project documents only.",
                [
                    BridgeOperationExceptions.Issue(
                        "$",
                        "UnsupportedDocumentType",
                        "These Revit data routes support project documents only.",
                        "Activate a project document and retry."
                    )
                ]
            );
        }

        return document;
    }
}
