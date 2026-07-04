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
using Pe.Revit.Global.Services.Aps;
using Pe.Shared.HostContracts.Operations;
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
internal sealed class RevitDataRequestService(RevitTaskService revitTaskService) : IRevitDataService {
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

    public Task<ConceptEvidenceData> GetConceptEvidenceAsync(
        ConceptEvidenceRequest request
    ) => this.EnqueueAsync(() => this.GetConceptEvidenceCore(request));

    public Task<ParameterEvidenceData> GetParameterEvidenceAsync(
        ParameterEvidenceRequest request
    ) => this.EnqueueAsync(() => this.GetParameterEvidenceCore(request));

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

    public Task<OpenRevitDocumentData> OpenRevitDocumentAsync(OpenRevitDocumentRequest request) =>
        this.EnqueueAsync(() => this.OpenRevitDocumentCore(request));

    public Task<RevitAgentContextSummaryData> GetRevitAgentContextSummaryAsync() =>
        this.EnqueueAsync(this.GetRevitAgentContextSummaryCore);

    public Task<RevitAgentContextResolveData> ResolveRevitAgentContextAsync(
        RevitAgentContextResolveRequest request
    ) => this.EnqueueAsync(() => this.ResolveRevitAgentContextCore(request));

    public Task<RevitAgentVisibleContextData> GetRevitAgentVisibleContextAsync(
        RevitAgentVisibleContextRequest request
    ) => this.EnqueueAsync(() => this.GetRevitAgentVisibleContextCore(request));

    public Task<RevitAgentViewRenderingStateData> GetRevitAgentViewRenderingStateAsync(
        RevitAgentViewRenderingStateRequest request
    ) => this.EnqueueAsync(() => this.GetRevitAgentViewRenderingStateCore(request));

    public Task<ParametersServiceCacheData> RefreshParametersServiceCacheAsync() =>
        ParametersServiceCache.RefreshAsync();

    private LoadedFamiliesCatalogData GetLoadedFamiliesCatalogCore(LoadedFamiliesCatalogRequest request) {
        var document = GetSupportedActiveDocument(RevitBridgeOps.LoadedFamiliesCatalog.Definition);

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
        var document = GetSupportedActiveDocument(RevitBridgeOps.ScheduleCatalog.Definition);

        try {
            return ScheduleCatalogCollector.Collect(document, request, DocShadow.For(document));
        } catch (Exception ex) {
            throw BridgeOperationExceptions.Unexpected(
                "ScheduleCatalogException",
                ex,
                "Verify the active document is a project document and retry."
            );
        }
    }

    private ProjectBrowserData GetProjectBrowserCore(ProjectBrowserRequest request) {
        var document = GetSupportedActiveDocument(RevitBridgeOps.ProjectBrowser.Definition);

        try {
            return ProjectBrowserCollector.Collect(document, request, DocShadow.For(document));
        } catch (Exception ex) {
            throw BridgeOperationExceptions.Unexpected(
                "ProjectBrowserException",
                ex,
                "Verify the active document is a project document and retry."
            );
        }
    }

    private ProjectIndexData GetProjectIndexCore(ProjectIndexRequest request) {
        var document = GetSupportedActiveDocument(RevitBridgeOps.ProjectIndex.Definition);

        try {
            return ProjectIndexCollector.Collect(document, request, DocShadow.For(document));
        } catch (Exception ex) {
            throw BridgeOperationExceptions.Unexpected(
                "ProjectIndexException",
                ex,
                "Verify the active document is a project document and retry."
            );
        }
    }

    private SheetDetailData GetSheetDetailsCore(SheetDetailRequest request) {
        var document = GetSupportedActiveDocument(RevitBridgeOps.SheetDetails.Definition);

        try {
            return SheetDetailCollector.Collect(document, RevitUiSession.CurrentUIApplication.GetActiveView(), request, DocShadow.For(document));
        } catch (Exception ex) {
            throw BridgeOperationExceptions.Unexpected(
                "SheetDetailsException",
                ex,
                "Verify the active document is a project document and retry."
            );
        }
    }

    private ScheduleProfilesQueryData GetScheduleProfilesQueryCore(ScheduleProfilesQueryRequest request) {
        var document = GetSupportedActiveDocument(RevitBridgeOps.ScheduleProfilesQuery.Definition);
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
        var document = GetSupportedActiveDocument(RevitBridgeOps.ScheduleQuery.Definition);
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
        var document = GetSupportedActiveDocument(RevitBridgeOps.LoadedFamiliesMatrix.Definition);

        try {
            return LoadedFamiliesMatrixCollector.Collect(
                document,
                filter,
                budget: request.Budget,
                includeTempPlacement: request.IncludeTempPlacement,
                snapshotCache: DocShadow.For(document));
        } catch (Exception ex) {
            throw BridgeOperationExceptions.Unexpected(
                "LoadedFamiliesMatrixException",
                ex,
                "Verify the active document is a project document and retry."
            );
        }
    }

    private ScheduleCoverageData GetScheduleCoverageCore(ScheduleCoverageRequest request) {
        var document = GetSupportedActiveDocument(RevitBridgeOps.ScheduleCoverage.Definition);

        try {
            return ScheduleCoverageCollector.Collect(
                document,
                request,
                RevitUiSession.CurrentUIApplication.GetActiveView(),
                DocShadow.For(document)
            );
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

        var document = GetSupportedActiveDocument(RevitBridgeOps.ParameterCoverage.Definition);

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

    private ConceptEvidenceData GetConceptEvidenceCore(ConceptEvidenceRequest request) {
        var document = GetSupportedActiveDocument(RevitBridgeOps.ConceptEvidence.Definition);
        try {
            var primitives = DocShadow.For(document).GetParameterEvidencePrimitives(document, useCache: true);
            return ConceptEvidenceCollector.Collect(request, primitives);
        } catch (Exception ex) {
            throw BridgeOperationExceptions.Unexpected(
                "ConceptEvidenceException",
                ex,
                "Verify the active document is a project document and retry."
            );
        }
    }

    private ParameterEvidenceData GetParameterEvidenceCore(ParameterEvidenceRequest request) {
        var validationIssues = ValidateParameterEvidenceRequest(request);
        if (validationIssues.Count != 0) {
            throw BridgeOperationExceptions.BadRequest(
                "Parameter evidence request is invalid.",
                validationIssues
            );
        }

        var document = GetSupportedActiveDocument(RevitBridgeOps.ParameterEvidence.Definition);
        try {
            var primitives = DocShadow.For(document).GetParameterEvidencePrimitives(document, request.UseCache);
            return ParameterEvidenceCollector.Collect(
                document,
                request,
                primitives,
                RevitUiSession.CurrentUIApplication.GetActiveUIDocument()?.Selection.GetElementIds().ToList()
            );
        } catch (Exception ex) {
            throw BridgeOperationExceptions.Unexpected(
                "ParameterEvidenceException",
                ex,
                "Verify the active document is a project document and retry."
            );
        }
    }

    private static List<ValidationIssue> ValidateParameterEvidenceRequest(ParameterEvidenceRequest request) {
        var issues = new List<ValidationIssue>();
        if (request.Scope == RevitElementScope.ExplicitHandles &&
            request.ElementIds.Count == 0 &&
            request.ElementUniqueIds.Count == 0) {
            issues.Add(BridgeOperationExceptions.Issue(
                "$.elementIds",
                "ParameterEvidenceExplicitHandlesMissing",
                "ExplicitHandles scope requires at least one element id or unique id.",
                "Set elementIds or elementUniqueIds, or choose ActiveViewVisible, CurrentSelection, or All."
            ));
        }

        ValidateParameterReferences(request.CandidateParameters, "$.candidateParameters", "ParameterEvidence", issues);

        return issues;
    }

    private static List<ValidationIssue> ValidateParameterCoverageRequest(ParameterCoverageRequest request) {
        var issues = new List<ValidationIssue>();
        var parameters = request.Parameters ?? [];
        var elementIds = request.ElementIds ?? [];
        var elementUniqueIds = request.ElementUniqueIds ?? [];

        if (parameters.Count == 0) {
            issues.Add(BridgeOperationExceptions.Issue(
                "$.parameters",
                "ParameterCoverageNoParametersRequested",
                "Request at least one parameter reference.",
                "Set parameters, for example [{\"name\":\"Mark\"}] or [{\"identity\":{...}}] from an observed ParameterIdentity. Allowed scope values: All, ActiveViewVisible, CurrentSelection, ExplicitHandles. Allowed lookupPreference values: InstanceThenType, InstanceOnly, TypeOnly."
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

        ValidateParameterReferences(parameters, "$.parameters", "ParameterCoverage", issues);

        return issues;
    }

    private static void ValidateParameterReferences(
        IReadOnlyList<ParameterReference> parameters,
        string path,
        string issuePrefix,
        List<ValidationIssue> issues
    ) {
        for (var i = 0; i < parameters.Count; i++) {
            var parameter = parameters[i];
            if (!string.IsNullOrWhiteSpace(parameter.SharedGuid) && !Guid.TryParse(parameter.SharedGuid, out _)) {
                issues.Add(BridgeOperationExceptions.Issue(
                    $"{path}[{i}].sharedGuid",
                    $"{issuePrefix}InvalidSharedGuid",
                    $"'{parameter.SharedGuid}' is not a valid GUID.",
                    "Use canonical shared parameter GUID strings from ParameterIdentity.SharedGuid such as 00000000-0000-0000-0000-000000000000."
                ));
            }

            if (parameter.Identity?.Kind == ParameterIdentityKind.SharedGuid &&
                !Guid.TryParse(parameter.Identity.SharedGuid, out _)) {
                issues.Add(BridgeOperationExceptions.Issue(
                    $"{path}[{i}].identity.sharedGuid",
                    $"{issuePrefix}InvalidIdentitySharedGuid",
                    "SharedGuid parameter identities must include a valid identity.sharedGuid value.",
                    "Pass the observed ParameterIdentity unchanged, or use the top-level sharedGuid shortcut with a canonical GUID string."
                ));
            }
        }
    }

    private static List<ValidationIssue> ValidateProjectParameterBindingsRequest(ProjectParameterBindingsRequest request) {
        var issues = new List<ValidationIssue>();
        ValidateParameterReferences(
            request.BindingFilter?.Parameters ?? [],
            "$.bindingFilter.parameters",
            "ProjectParameterBindings",
            issues);

        return issues;
    }

    private ProjectParameterBindingsData GetProjectParameterBindingsCore(
        ProjectParameterBindingsRequest request
    ) {
        var validationIssues = ValidateProjectParameterBindingsRequest(request);
        if (validationIssues.Count != 0) {
            throw BridgeOperationExceptions.BadRequest(
                "Project parameter bindings request is invalid.",
                validationIssues
            );
        }

        var document = GetSupportedActiveDocument(RevitBridgeOps.ProjectParameterBindings.Definition);

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
        var document = GetSupportedActiveDocument(RevitBridgeOps.ElementContextQuery.Definition);

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
        var document = GetSupportedActiveDocument(RevitBridgeOps.ElectricalPanelsCatalog.Definition);

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
        var document = GetSupportedActiveDocument(RevitBridgeOps.ElectricalCircuitsCatalog.Definition);

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
        var document = GetSupportedActiveDocument(RevitBridgeOps.ElectricalPanelSchedulesQuery.Definition);
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
        var document = GetSupportedActiveDocument(RevitBridgeOps.ElectricalLoadClassificationsCatalog.Definition);

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

    private OpenRevitDocumentData OpenRevitDocumentCore(OpenRevitDocumentRequest request) {
        if (string.IsNullOrWhiteSpace(request.Path)) {
            throw BridgeOperationExceptions.BadRequest(
                "Document path is required.",
                [
                    BridgeOperationExceptions.Issue(
                        "$.path",
                        "MissingDocumentPath",
                        "Document path is required.",
                        "Pass an absolute local Revit model path."
                    )
                ]
            );
        }

        var path = request.Path.Trim();
        if (!File.Exists(path)) {
            throw BridgeOperationExceptions.BadRequest(
                $"Document path does not exist: {path}",
                [
                    BridgeOperationExceptions.Issue(
                        "$.path",
                        "DocumentPathNotFound",
                        $"Document path does not exist: {path}",
                        "Pass an existing local .rvt, .rfa, or .rte path."
                    )
                ]
            );
        }

        var uiApp = RevitUiSession.CurrentUIApplication;
        var alreadyOpen = uiApp.FindOpenDocumentByPath(path);
        if (alreadyOpen != null)
            return new OpenRevitDocumentData(
                CreateDocumentSummary(alreadyOpen, uiApp.GetActiveDocument()),
                CreateDocumentSessionContext()
            );

        try {
            var modelPath = ModelPathUtils.ConvertUserVisiblePathToModelPath(path);
            var uiDocument = uiApp.OpenAndActivateDocument(modelPath, new OpenOptions(), false);
            var document = uiDocument.Document;
            return new OpenRevitDocumentData(
                CreateDocumentSummary(document, document),
                CreateDocumentSessionContext()
            );
        } catch (Exception ex) when (ex is InvalidOperationException or OperationCanceledException) {
            throw BridgeOperationExceptions.Conflict(
                $"Revit could not open document: {path}",
                [
                    BridgeOperationExceptions.Issue(
                        "$.path",
                        "OpenRevitDocumentFailed",
                        ex.Message,
                        "Verify Revit is idle, no modal dialog or transaction is active, and the model can be opened manually."
                    )
                ]
            );
        } catch (Exception ex) {
            throw BridgeOperationExceptions.Unexpected(
                "OpenRevitDocumentException",
                ex,
                "Verify the path points to a supported local Revit document and retry."
            );
        }
    }

    private RevitAgentContextSummaryData GetRevitAgentContextSummaryCore() {
        var document = GetSupportedActiveDocument(RevitBridgeOps.RevitAgentContextSummary.Definition);
        try {
            var uiApp = RevitUiSession.CurrentUIApplication;
            return RevitAgentContextCollector.CollectSummary(
                document,
                CreateDocumentSessionContext(),
                uiApp.GetActiveView(),
                uiApp.GetActiveUIDocument()?.Selection.GetElementIds().ToList()
            );
        } catch (BridgeOperationException) {
            throw;
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
        var document = GetSupportedActiveDocument(RevitBridgeOps.RevitAgentContextResolve.Definition);
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
        var document = GetSupportedActiveDocument(RevitBridgeOps.RevitAgentVisibleContext.Definition);
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

    private RevitAgentViewRenderingStateData GetRevitAgentViewRenderingStateCore(
        RevitAgentViewRenderingStateRequest request
    ) {
        var document = GetSupportedActiveDocument(RevitBridgeOps.RevitAgentViewRenderingState.Definition);
        try {
            return RevitAgentContextCollector.CollectViewRenderingState(
                document,
                RevitUiSession.CurrentUIApplication.GetActiveView(),
                request
            );
        } catch (Exception ex) {
            throw BridgeOperationExceptions.Unexpected(
                "RevitAgentViewRenderingStateException",
                ex,
                "Verify a project document and inspectable view are available, then retry."
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

    private static RevitDocument GetSupportedActiveDocument(HostOperationDefinition _) => GetActiveDocument();
}
