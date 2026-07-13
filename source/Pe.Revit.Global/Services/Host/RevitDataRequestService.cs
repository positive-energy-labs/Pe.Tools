using Autodesk.Revit.DB.Electrical;
using Autodesk.Revit.UI.Events;
using Pe.Revit.DocumentData.AgentContext;
using Pe.Revit.DocumentData.Electrical;
using Pe.Revit.DocumentData.Families.Loaded.Collectors;
using Pe.Revit.DocumentData.Parameters;
using Pe.Revit.Extensions.FamManager;
using Pe.Revit.Utils;
using Pe.Revit.DocumentData.ProjectBrowser;
using Pe.Revit.DocumentData.ProjectIndex;
using Pe.Revit.DocumentData.Schedules.Collect;
using Pe.Revit.DocumentData.Selection;
using Pe.Revit.DocumentData.Sheets;
using Pe.Revit.Extensions.FamDocument;
using Pe.Revit.Extensions.FamParameter;
using Pe.Revit.Extensions.FamParameter.Formula;
using Pe.Revit.Global.Services.Aps;
using Pe.Revit.Global.Services.ParameterLinks;
using Pe.Revit.Parameters;
using Pe.Shared.HostContracts.Operations;
using Pe.Shared.HostContracts.SettingsStorage;
using Pe.Shared.RevitData;
using Pe.Shared.RevitData.Families;
using Pe.Shared.RevitData.Schedules;
using ricaun.Revit.UI.Tasks;
using System.Globalization;
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

    public Task<FamilyEditorSnapshotData> GetFamilyEditorSnapshotAsync(
        FamilyEditorSnapshotRequest request
    ) => this.EnqueueAsync(this.GetFamilyEditorSnapshotCore);

    public Task<FamilyEditorOpenData> OpenFamilyEditorAsync(
        FamilyEditorOpenRequest request
    ) => this.EnqueueAsync(() => this.OpenFamilyEditorCore(request));

    public Task<FamilyEditorApplyData> ApplyFamilyEditorEditsAsync(
        FamilyEditorApplyRequest request
    ) => this.EnqueueAsync(() => this.ApplyFamilyEditorEditsCore(request));

    public Task<ParameterValueApplyData> ApplyParameterValuesAsync(
        ParameterValueApplyRequest request
    ) => this.EnqueueAsync(() => this.ApplyParameterValuesCore(request));

    public Task<ParameterLinksData> GetParameterLinksAsync(
        ParameterLinksDetailRequest request
    ) => this.EnqueueAsync(() => this.GetParameterLinksCore(request));

    public Task<ParameterLinksData> ApplyParameterLinksAsync(
        ParameterLinksApplyRequest request
    ) => this.EnqueueAsync(() => this.ApplyParameterLinksCore(request));

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

    public Task<RevitViewImageData> GetRevitViewImageAsync(
        RevitViewImageRequest request
    ) => this.EnqueueAsync(() => this.GetRevitViewImageCore(request));

    public Task<ParametersServiceCacheData> RefreshParametersServiceCacheAsync() =>
        ParametersServiceCache.RefreshAsync();

    public Task<RibbonCommandExecuteData> ExecuteRibbonCommandAsync(RibbonCommandExecuteRequest request) =>
        this.EnqueueAsync(() => ExecuteRibbonCommandCore(request));

    private static RibbonCommandExecuteData ExecuteRibbonCommandCore(RibbonCommandExecuteRequest request) {
        var uiApp = RevitUiSession.CurrentUIApplication;

        if (!string.IsNullOrWhiteSpace(request.CommandId)) {
            var (posted, error) = Lib.Commands.Execute(uiApp, request.CommandId!);
            return new RibbonCommandExecuteData(
                Posted: posted,
                Executed: new RibbonCommandInfo(request.CommandId!, request.CommandId!, null, null, posted),
                Matches: [],
                Message: error?.Message
            );
        }

        // Discovery: same ribbon walk + shortcuts-XML naming as the command palette.
        var shortcuts = Ui.ShortcutsService.Instance;
        var search = request.SearchText ?? string.Empty;
        var maxMatches = Math.Max(1, request.MaxMatches);
        var matches = new List<RibbonCommandInfo>();

        foreach (var command in Ui.Ribbon.GetAllCommands()) {
            var (info, _) = shortcuts.GetShortcutInfo(command.Id);
            string name;
            string? paths;
            if (info is not null) {
                name = info.CommandName;
                paths = string.Join("; ", info.Paths);
            } else if (command.ItemType == "RibbonButton" && !command.Panel.Contains("_shr_")) {
                name = command.Text;
                paths = $"{command.Tab} > {command.Panel.Split('_').Last()}";
            } else
                continue;

            if (string.IsNullOrWhiteSpace(name)) continue;
            if (search.Length > 0 &&
                name.IndexOf(search, StringComparison.OrdinalIgnoreCase) < 0 &&
                command.Id.IndexOf(search, StringComparison.OrdinalIgnoreCase) < 0)
                continue;

            var liveShortcuts = shortcuts.GetLiveShortcuts(command.Id);
            matches.Add(new RibbonCommandInfo(
                command.Id,
                name,
                paths,
                liveShortcuts.Count > 0 ? liveShortcuts[0] : null,
                Lib.Commands.IsAvailable(uiApp, command.Id)
            ));
            if (matches.Count >= maxMatches) break;
        }

        return new RibbonCommandExecuteData(
            Posted: false,
            Executed: null,
            Matches: matches,
            Message: matches.Count == 0
                ? "No matching commands. Broaden searchText or omit it to list the first page."
                : null
        );
    }

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

    private FamilyEditorSnapshotData GetFamilyEditorSnapshotCore() {
        var document = GetActiveFamilyDocument();

        try {
            var fm = document.FamilyManager;
            var familyDocument = new FamilyDocument(document);
            var parameterSet = fm.Parameters;
            var familyTypes = fm.Types.Cast<FamilyType>().ToList();
            var typeNames = familyTypes.Select(type => type.Name).ToList();
            var parameters = fm.Parameters.Cast<FamilyParameter>()
                .Select(parameter => CreateFamilyEditorParameterSnapshot(familyDocument, parameter, familyTypes, parameterSet))
                .OrderBy(parameter => parameter.Name, StringComparer.OrdinalIgnoreCase)
                .ThenByDescending(parameter => parameter.IsInstance)
                .ToList();

            return new FamilyEditorSnapshotData(
                document.Title,
                fm.CurrentType?.Name ?? string.Empty,
                typeNames,
                parameters
            );
        } catch (BridgeOperationException) {
            throw;
        } catch (Exception ex) {
            throw BridgeOperationExceptions.Unexpected(
                "FamilyEditorSnapshotException",
                ex,
                "Verify the active document is a family document and retry."
            );
        }
    }

    private FamilyEditorApplyData ApplyFamilyEditorEditsCore(FamilyEditorApplyRequest request) {
        var document = GetActiveFamilyDocument();
        if (!request.DryRun && document.IsReadOnly) {
            throw BridgeOperationExceptions.Conflict(
                "Active family document is read-only.",
                [
                    BridgeOperationExceptions.Issue(
                        "$",
                        "FamilyEditorDocumentReadOnly",
                        "Active family document is read-only.",
                        "Open a writable family document and retry, or use dryRun=true to preview."
                    )
                ]
            );
        }

        var edits = request.Edits ?? [];
        if (edits.Count == 0)
            return new FamilyEditorApplyData(0, []);

        var familyDocument = new FamilyDocument(document);

        using var sandbox = DocumentSandbox.BeginCommit(document, "Pe Family Editor Apply");
        var commitFailures = new List<(bool IsError, string Message)>();
        var failureOptions = sandbox.Transaction.GetFailureHandlingOptions();
        _ = failureOptions.SetFailuresPreprocessor(new DialogSuppressingFailuresPreprocessor(commitFailures));
        _ = failureOptions.SetForcedModalHandling(false);
        sandbox.Transaction.SetFailureHandlingOptions(failureOptions);

        var applied = 0;
        var results = new List<FamilyEditorApplyEditResult>();
        for (var i = 0; i < edits.Count; i++) {
            try {
                ApplyFamilyEditorEdit(familyDocument, edits[i]);
                applied++;
                results.Add(new FamilyEditorApplyEditResult(i, true, null));
            } catch (Exception ex) {
                results.Add(new FamilyEditorApplyEditResult(i, false, ex.Message));
            }
        }

        // DryRun validates the full edit sequence inside the transaction, then rolls back on dispose
        // (Complete is skipped) so nothing persists. Applied still reflects the would-apply count.
        if (!request.DryRun && applied > 0)
            sandbox.Complete();

        foreach (var (_, message) in commitFailures)
            results.Add(new FamilyEditorApplyEditResult(edits.Count + results.Count, false, message));

        return new FamilyEditorApplyData(applied, results);
    }

    private ParameterValueApplyData ApplyParameterValuesCore(ParameterValueApplyRequest request) {
        var document = GetSupportedActiveDocument(RevitBridgeOps.ApplyParameterValues.Definition);
        if (!request.DryRun && document.IsReadOnly) {
            throw BridgeOperationExceptions.Conflict(
                "Active document is read-only.",
                [
                    BridgeOperationExceptions.Issue(
                        "$",
                        "ParameterValueApplyDocumentReadOnly",
                        "Active document is read-only.",
                        "Open a writable document and retry, or use dryRun=true to preview."
                    )
                ]
            );
        }

        try {
            return ParameterValueApplier.Apply(document, request);
        } catch (BridgeOperationException) {
            throw;
        } catch (Exception ex) {
            throw BridgeOperationExceptions.Unexpected(
                "ParameterValueApplyException",
                ex,
                "Verify the active document is writable and the edits reference valid binding handles, then retry."
            );
        }
    }

    private ParameterLinksData GetParameterLinksCore(ParameterLinksDetailRequest request) {
        var document = GetParameterLinksDocument(RevitBridgeOps.ParameterLinksDetail.Definition);
        return ParameterLinksService.Instance.Detail(document, request.IncludeEvaluation);
    }

    private ParameterLinksData ApplyParameterLinksCore(ParameterLinksApplyRequest request) {
        var document = GetParameterLinksDocument(RevitBridgeOps.ParameterLinksApply.Definition);
        if (!request.PreviewOnly && document.IsReadOnly) {
            throw BridgeOperationExceptions.Conflict(
                "Active document is read-only.",
                [BridgeOperationExceptions.Issue(
                    "$",
                    "ParameterLinksDocumentReadOnly",
                    "Active document is read-only.",
                    "Open a writable project document and retry, or use previewOnly=true.")]);
        }

        try {
            return ParameterLinksService.Instance.Apply(document, request);
        } catch (BridgeOperationException) {
            throw;
        } catch (Exception ex) {
            throw BridgeOperationExceptions.Unexpected(
                "ParameterLinksApplyException",
                ex,
                "Inspect revit.detail.parameter-links issues, verify the active project is writable, and retry.");
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
        var uiApp = RevitUiSession.CurrentUIApplication;

        // Cloud target wins when present; a cloud model has no local file, so the old File.Exists
        // gate only applies to the local-path branch.
        if (request.HasCloudTarget()) {
            // Detach-on-open for cloud models is a separate, spike-gated capability; v1 is local only.
            if (request.RequestsDetach())
                throw BridgeOperationExceptions.BadRequest(
                    "Detach-on-open is supported for local workshared files only.",
                    [
                        BridgeOperationExceptions.Issue(
                            "$.detach",
                            "CloudDetachUnsupported",
                            "Detach was requested together with a cloud project/model target.",
                            "Open the cloud model without detach, or pass a local workshared file path with detach."
                        )
                    ]
                );
            return OpenCloudRevitDocument(uiApp, request);
        }

        if (request.HasLocalPath())
            return OpenLocalRevitDocument(uiApp, request.Path!.Trim(), request.Detach);

        throw BridgeOperationExceptions.BadRequest(
            "A local path or a cloud project + model GUID is required.",
            [
                BridgeOperationExceptions.Issue(
                    "$.path",
                    "MissingDocumentTarget",
                    "Neither a local path nor cloud project/model GUIDs were provided.",
                    "Pass an absolute local Revit model path, or cloudProjectGuid + cloudModelGuid (+ optional cloudRegion)."
                )
            ]
        );
    }

    private FamilyEditorOpenData OpenFamilyEditorCore(FamilyEditorOpenRequest request) {
        var uiApp = RevitUiSession.CurrentUIApplication;
        var document = GetActiveDocument();
        if (document.IsFamilyDocument) {
            throw BridgeOperationExceptions.Conflict(
                "Active document is already a family document.",
                [
                    BridgeOperationExceptions.Issue(
                        "$",
                        "ActiveProjectDocumentRequired",
                        "Active document is already a family document.",
                        "Activate the project document that loads the family, then retry."
                    )
                ]
            );
        }

        var family = request.FamilyId is { } familyId
            ? document.GetElement(familyId.ToElementId()) as Family
            : null;
        if (family == null && !string.IsNullOrWhiteSpace(request.FamilyName)) {
            family = new FilteredElementCollector(document)
                .OfClass(typeof(Family))
                .Cast<Family>()
                .FirstOrDefault(f => string.Equals(f.Name, request.FamilyName!.Trim(),
                    StringComparison.OrdinalIgnoreCase));
        }

        if (family == null) {
            throw BridgeOperationExceptions.BadRequest(
                "Family not found in the active project.",
                [
                    BridgeOperationExceptions.Issue(
                        "$.familyId",
                        "FamilyNotFound",
                        "No loaded family matched the given familyId/familyName.",
                        "Pass a familyId or familyName from revit.catalog.loaded-families."
                    )
                ]
            );
        }

        // EditFamily documents have no PathName and cannot be activated (gotcha: reopening by
        // OpenAndActivateDocument often throws). Save to a scratch .rfa and reopen by path.
        var scratchDir = Path.Combine(Path.GetTempPath(), "pe-family-editor");
        _ = Directory.CreateDirectory(scratchDir);
        var scratchPath = Path.Combine(scratchDir, family.Name + ".rfa");

        if (uiApp.FindOpenDocumentByPath(scratchPath) == null) {
            var familyDocument = document.EditFamily(family);
            try {
                if (File.Exists(scratchPath))
                    File.Delete(scratchPath);
                familyDocument.SaveAs(scratchPath);
            } finally {
                _ = familyDocument.Close(false);
            }
        }

        var opened = this.OpenLocalRevitDocument(uiApp, scratchPath);
        return new FamilyEditorOpenData(family.Name, opened.Document.Title, scratchPath);
    }

    private OpenRevitDocumentData OpenLocalRevitDocument(
        UIApplication uiApp,
        string path,
        WorksharingDetachOption detach = WorksharingDetachOption.DoNotDetach
    ) {
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

        // A detached open produces a NEW independent document; never satisfy a detach
        // request with an attached already-open copy of the same file.
        var alreadyOpen = detach == WorksharingDetachOption.DoNotDetach
            ? uiApp.FindOpenDocumentByPath(path)
            : null;
        if (alreadyOpen != null)
            return new OpenRevitDocumentData(
                CreateDocumentSummary(alreadyOpen, uiApp.GetActiveDocument()),
                CreateDocumentSessionContext(),
                alreadyOpen.IsDetached
            );

        try {
            var modelPath = ModelPathUtils.ConvertUserVisiblePathToModelPath(path);
            var uiDocument = OpenAndActivateSuppressingLinkDialog(uiApp, modelPath, CreateOpenOptions(detach));
            var document = uiDocument.Document;
            // Verified from the opened Document, never echoed from the request: Revit silently
            // ignores detach options for non-workshared files, so an unhonored detach fails loudly.
            var isDetached = document.IsDetached;
            if (detach != WorksharingDetachOption.DoNotDetach && !isDetached)
                throw BridgeOperationExceptions.Conflict(
                    $"Revit opened the document, but it is not detached: {path}",
                    [
                        BridgeOperationExceptions.Issue(
                            "$.detach",
                            "OpenRevitDocumentNotDetached",
                            "The opened document reports IsDetached=false despite the detach request.",
                            "Detach-on-open requires a local workshared file; verify the file is workshared."
                        )
                    ]
                );
            return new OpenRevitDocumentData(
                CreateDocumentSummary(document, document),
                CreateDocumentSessionContext(),
                isDetached
            );
        } catch (BridgeOperationException) {
            throw;
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

    private OpenRevitDocumentData OpenCloudRevitDocument(UIApplication uiApp, OpenRevitDocumentRequest request) {
        if (!Guid.TryParse(request.CloudProjectGuid, out var projectGuid))
            throw BridgeOperationExceptions.BadRequest(
                $"Invalid cloud project GUID: {request.CloudProjectGuid}",
                [
                    BridgeOperationExceptions.Issue(
                        "$.cloudProjectGuid",
                        "InvalidCloudProjectGuid",
                        $"Invalid cloud project GUID: {request.CloudProjectGuid}",
                        "Pass the project GUID as reported by revit.context / cloud browse."
                    )
                ]
            );
        if (!Guid.TryParse(request.CloudModelGuid, out var modelGuid))
            throw BridgeOperationExceptions.BadRequest(
                $"Invalid cloud model GUID: {request.CloudModelGuid}",
                [
                    BridgeOperationExceptions.Issue(
                        "$.cloudModelGuid",
                        "InvalidCloudModelGuid",
                        $"Invalid cloud model GUID: {request.CloudModelGuid}",
                        "Pass the model GUID as reported by revit.context / cloud browse."
                    )
                ]
            );

        // Region defaults to US; ModelPathUtils.CloudRegionEMEA is the other common value.
        var region = string.IsNullOrWhiteSpace(request.CloudRegion)
            ? ModelPathUtils.CloudRegionUS
            : request.CloudRegion.Trim();

        var projectKey = projectGuid.ToString("D");
        var modelKey = modelGuid.ToString("D");
        var alreadyOpen = uiApp.GetOpenDocuments().FirstOrDefault(doc =>
            string.Equals(doc.GetCloudProjectGuid(), projectKey, StringComparison.OrdinalIgnoreCase)
            && string.Equals(doc.GetCloudModelGuid(), modelKey, StringComparison.OrdinalIgnoreCase));
        if (alreadyOpen != null)
            return new OpenRevitDocumentData(
                CreateDocumentSummary(alreadyOpen, uiApp.GetActiveDocument()),
                CreateDocumentSessionContext(),
                alreadyOpen.IsDetached
            );

        try {
            var modelPath = ModelPathUtils.ConvertCloudGUIDsToCloudPath(region, projectGuid, modelGuid);
            // ponytail: no network timeout; a dead-network cloud open blocks the Revit task queue.
            // Wrap with UiApplication.TryOpenCloudDocumentWithTimeout-style handling if that bites.
            var uiDocument = OpenAndActivateSuppressingLinkDialog(uiApp, modelPath);
            var document = uiDocument.Document;
            return new OpenRevitDocumentData(
                CreateDocumentSummary(document, document),
                CreateDocumentSessionContext(),
                document.IsDetached
            );
        } catch (Exception ex) when (ex is InvalidOperationException or OperationCanceledException) {
            throw BridgeOperationExceptions.Conflict(
                $"Revit could not open cloud model {projectKey}/{modelKey} ({region}).",
                [
                    BridgeOperationExceptions.Issue(
                        "$.cloudModelGuid",
                        "OpenCloudRevitDocumentFailed",
                        ex.Message,
                        "Verify the GUIDs and region are correct, you are signed in to Autodesk with access, and Revit is idle."
                    )
                ]
            );
        } catch (Exception ex) {
            throw BridgeOperationExceptions.Unexpected(
                "OpenCloudRevitDocumentException",
                ex,
                "Verify Autodesk sign-in, cloud access, region, and that the model GUIDs are current."
            );
        }
    }

    /// <summary>
    ///     Opens a document with the "Manage Links" unresolved-references TaskDialog auto-dismissed
    ///     ("Ignore and continue opening the project"), so bridge opens of linked cloud models don't
    ///     block on a modal dialog. Handler is scoped to this call only — manual opens still see it.
    /// </summary>
    private static UIDocument OpenAndActivateSuppressingLinkDialog(
        UIApplication uiApp,
        ModelPath modelPath,
        OpenOptions? openOptions = null
    ) {
        void OnDialogShowing(object? sender, DialogBoxShowingEventArgs args) {
            if (args is not TaskDialogShowingEventArgs td) return;
            if (td.DialogId == "TaskDialog_Unresolved_References")
                td.OverrideResult(1002); // CommandLink2 = "Ignore and continue opening the project"
            else if (td.DialogId == "TaskDialog_Unsubmitted_Changes")
                td.OverrideResult(1001); // CommandLink1 = "Keep my changes and open the model"
            else
                Console.WriteLine($"[OpenRevitDocument] Unhandled dialog during open: {td.DialogId}");
        }

        uiApp.DialogBoxShowing += OnDialogShowing;
        try {
            return uiApp.OpenAndActivateDocument(modelPath, openOptions ?? new OpenOptions(), false);
        } finally {
            uiApp.DialogBoxShowing -= OnDialogShowing;
        }
    }

    private static OpenOptions CreateOpenOptions(WorksharingDetachOption detach) =>
        new() {
            DetachFromCentralOption = detach switch {
                WorksharingDetachOption.DetachAndPreserveWorksets =>
                    DetachFromCentralOption.DetachAndPreserveWorksets,
                WorksharingDetachOption.DetachAndDiscardWorksets =>
                    DetachFromCentralOption.DetachAndDiscardWorksets,
                _ => DetachFromCentralOption.DoNotDetach
            }
        };

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

    private RevitViewImageData GetRevitViewImageCore(RevitViewImageRequest request) {
        var document = GetSupportedActiveDocument(RevitBridgeOps.ViewImage.Definition);
        // Wire deserialization does not honor record ctor defaults (0 arrives when omitted).
        var pixelSize = request.PixelSize > 0 ? request.PixelSize : 1500;
        var marginPercent = request.MarginPercent > 0 ? request.MarginPercent : 8;
        var resolved = ResolveCaptureTarget(document, request.Target);

        // Schedules only capture as placed on a sheet — never rendered on a contrived view.
        if (resolved is ViewSchedule schedule) {
            var (sheet, instance) = ResolveScheduleplacement(document, schedule, request.Target?.OnSheet);
            try {
                return RevitViewImageExporter.ExportSheetedSchedule(
                    document, sheet, instance, marginPercent, pixelSize);
            } catch (Exception ex) {
                throw BridgeOperationExceptions.Unexpected("ViewImageExportException", ex,
                    "Schedule capture exports its sheet and crops to the placement; verify the sheet exports normally.");
            }
        }

        if (resolved is not View { IsTemplate: false } view) throw CaptureTargetError();

        var focusBox = ResolveFocusBox(document, view, request.Focus);
        try {
            return focusBox is null
                ? RevitViewImageExporter.Export(document, view, pixelSize)
                : RevitViewImageExporter.ExportFocused(
                    document, view, focusBox, marginPercent, pixelSize);
        } catch (Exception ex) {
            throw BridgeOperationExceptions.Unexpected(
                "ViewImageExportException",
                ex,
                "Verify the view is a graphical view or sheet that Revit can export as an image, then retry."
            );
        }
    }

    private static BridgeOperationException CaptureTargetError() => BridgeOperationExceptions.Conflict(
        "No exportable view.",
        [
            BridgeOperationExceptions.Issue(
                "$.target",
                "ViewNotExportable",
                "The requested reference is not a graphical view, sheet, viewport, or sheeted schedule (or is a view template).",
                "Pass a view/sheet id or name from the project browser, or activate a graphical view and retry."
            )
        ]
    );

    /// <summary>Resolve target to a View: active view when omitted; viewports deref to their view.</summary>
    private static Element? ResolveCaptureTarget(RevitDocument document, RevitViewImageTarget? target) {
        Element? element;
        if (target is null || target.Id is null && string.IsNullOrWhiteSpace(target.UniqueId) && string.IsNullOrWhiteSpace(target.Name)) {
            element = RevitUiSession.CurrentUIApplication.GetActiveView();
        } else if (target.Id is { } id) {
            element = document.GetElement(id.ToElementId());
        } else if (!string.IsNullOrWhiteSpace(target.UniqueId)) {
            element = document.GetElement(target.UniqueId);
        } else {
            element = FindViewByName(document, target.Name!, target.OnSheet);
        }

        return element switch {
            Viewport viewport => document.GetElement(viewport.ViewId),
            ScheduleSheetInstance instance => document.GetElement(instance.ScheduleId),
            _ => element
        };
    }

    private static View? FindViewByName(RevitDocument document, string name, string? onSheet) {
        var views = new FilteredElementCollector(document).OfClass(typeof(View)).Cast<View>()
            .Where(v => !v.IsTemplate).ToList();

        // Sheet number is the strongest key ("A101"), then exact names, then unique substring.
        var match = views.OfType<ViewSheet>().FirstOrDefault(s =>
                string.Equals(s.SheetNumber, name, StringComparison.OrdinalIgnoreCase))
            ?? views.FirstOrDefault(v => string.Equals(v.Name, name, StringComparison.OrdinalIgnoreCase));
        if (match is null) {
            var partial = views
                .Where(v => v.Name.IndexOf(name, StringComparison.OrdinalIgnoreCase) >= 0
                            || v is ViewSheet ps && ps.SheetNumber.IndexOf(name, StringComparison.OrdinalIgnoreCase) >= 0)
                .ToList();
            if (partial.Count > 1 && !string.IsNullOrWhiteSpace(onSheet)) {
                var sheet = FindSheet(document, onSheet!);
                var placed = sheet?.GetAllPlacedViews();
                if (placed is not null) partial = partial.Where(v => placed.Contains(v.Id)).ToList();
            }

            if (partial.Count > 1) {
                throw BridgeOperationExceptions.Conflict(
                    $"View name '{name}' is ambiguous.",
                    [
                        BridgeOperationExceptions.Issue(
                            "$.target.name",
                            "AmbiguousViewName",
                            $"Matches: {string.Join(", ", partial.Take(8).Select(v => $"'{v.Name}' ({v.Id.Value()})"))}{(partial.Count > 8 ? ", …" : "")}",
                            "Use a more specific name, the element id, or target.onSheet to disambiguate."
                        )
                    ]
                );
            }

            match = partial.FirstOrDefault();
        }

        return match;
    }

    private static ViewSheet? FindSheet(RevitDocument document, string sheetKey) =>
        new FilteredElementCollector(document).OfClass(typeof(ViewSheet)).Cast<ViewSheet>()
            .FirstOrDefault(s => string.Equals(s.SheetNumber, sheetKey, StringComparison.OrdinalIgnoreCase)
                                 || string.Equals(s.Name, sheetKey, StringComparison.OrdinalIgnoreCase));

    private static (ViewSheet Sheet, ScheduleSheetInstance Instance) ResolveScheduleplacement(
        RevitDocument document,
        ViewSchedule schedule,
        string? onSheet
    ) {
        var instances = new FilteredElementCollector(document).OfClass(typeof(ScheduleSheetInstance))
            .Cast<ScheduleSheetInstance>()
            .Where(i => i.ScheduleId == schedule.Id && document.GetElement(i.OwnerViewId) is ViewSheet)
            .ToList();
        if (!string.IsNullOrWhiteSpace(onSheet)) {
            var sheet = FindSheet(document, onSheet!);
            instances = instances.Where(i => i.OwnerViewId == sheet?.Id).ToList();
        }

        var instance = instances.FirstOrDefault() ?? throw BridgeOperationExceptions.Conflict(
            $"Schedule '{schedule.Name}' is not placed on a sheet{(onSheet is null ? "" : $" matching '{onSheet}'")}.",
            [
                BridgeOperationExceptions.Issue(
                    "$.target",
                    "ScheduleNotSheeted",
                    "Schedules can only be captured as placed on a sheet (what the user actually sees).",
                    "Read the schedule contents with revit.query.schedule instead, or place it on a sheet first."
                )
            ]
        );
        return ((ViewSheet)document.GetElement(instance.OwnerViewId), instance);
    }

    /// <summary>Union bbox for the requested focus, in model coords; null when no focus given.</summary>
    private static BoundingBoxXYZ? ResolveFocusBox(RevitDocument document, View view, RevitViewImageFocus? focus) {
        if (focus is null) return null;
        if (view is ViewSheet) {
            throw BridgeOperationExceptions.Conflict(
                "Focus is not supported on sheets.",
                [
                    BridgeOperationExceptions.Issue("$.focus", "FocusOnSheet",
                        "Sheets have no model crop box.", "Capture the placed view instead, with the same focus.")
                ]
            );
        }

        List<ElementId> ids;
        if (focus.ElementIds is { Count: > 0 } explicitIds) {
            ids = explicitIds.Select(id => id.ToElementId()).ToList();
        } else if (focus.Selection) {
            ids = RevitUiSession.CurrentUIApplication.GetActiveUIDocument()?.Selection.GetElementIds().ToList() ?? [];
            if (ids.Count == 0) throw FocusError("EmptySelection", "Nothing is selected in Revit.");
        } else if (!string.IsNullOrWhiteSpace(focus.ScopeBox)) {
            var scopeBox = new FilteredElementCollector(document)
                .OfCategory(BuiltInCategory.OST_VolumeOfInterest)
                .FirstOrDefault(e => string.Equals(e.Name, focus.ScopeBox, StringComparison.OrdinalIgnoreCase)
                                     || e.Id.Value().ToString(CultureInfo.InvariantCulture) == focus.ScopeBox)
                ?? throw FocusError("ScopeBoxNotFound", $"No scope box named '{focus.ScopeBox}'.");
            return scopeBox.get_BoundingBox(null);
        } else {
            throw FocusError("EmptyFocus", "Set exactly one of focus.elementIds, focus.selection, or focus.scopeBox.");
        }

        BoundingBoxXYZ? union = null;
        foreach (var id in ids) {
            // View-specific bbox first (respects visibility); model bbox as fallback.
            var box = document.GetElement(id)?.get_BoundingBox(view) ?? document.GetElement(id)?.get_BoundingBox(null);
            if (box is null) continue;
            if (union is null) {
                union = new BoundingBoxXYZ { Min = box.Transform.OfPoint(box.Min), Max = box.Transform.OfPoint(box.Max) };
            } else {
                var min = box.Transform.OfPoint(box.Min);
                var max = box.Transform.OfPoint(box.Max);
                union.Min = new XYZ(Math.Min(union.Min.X, min.X), Math.Min(union.Min.Y, min.Y), Math.Min(union.Min.Z, min.Z));
                union.Max = new XYZ(Math.Max(union.Max.X, max.X), Math.Max(union.Max.Y, max.Y), Math.Max(union.Max.Z, max.Z));
            }
        }

        return union ?? throw FocusError("NoFocusGeometry", "None of the focus elements have a bounding box in this view.");
    }

    private static BridgeOperationException FocusError(string code, string detail) =>
        BridgeOperationExceptions.Conflict(
            "Cannot resolve focus.",
            [BridgeOperationExceptions.Issue("$.focus", code, detail, "Adjust the focus and retry, or omit focus for the whole view.")]
        );

    private static FamilyEditorParameterSnapshot CreateFamilyEditorParameterSnapshot(
        FamilyDocument familyDocument,
        FamilyParameter parameter,
        IReadOnlyList<FamilyType> familyTypes,
        FamilyParameterSet parameterSet
    ) {
        var definition = parameter.Definition;
        var formula = string.IsNullOrWhiteSpace(parameter.Formula) ? null : parameter.Formula;
        var valuesPerType = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (var familyType in familyTypes)
            valuesPerType[familyType.Name] = GetFamilyEditorValue(familyType, parameter);

        return new FamilyEditorParameterSnapshot(
            definition?.Name ?? string.Empty,
            parameter.IsInstance,
            parameter.IsReadOnly,
            formula != null,
            parameter.IsShared,
            GetSharedParameterGuid(parameter),
            parameter.StorageType.ToString(),
            NormalizeForgeTypeId(definition?.GetDataType()),
            GetParameterGroupLabel(definition),
            formula,
            valuesPerType,
            BuildParameterIdentity(parameter),
            BuildFormulaDependsOn(parameter, parameterSet),
            BuildFormulaDependents(parameter, parameterSet),
            BuildParameterAssociations(parameter, familyDocument)
        );
    }

    private static ParameterIdentity? BuildParameterIdentity(FamilyParameter parameter) {
        try {
            return RevitParameterDefinition.ObservedFamilyParameter(parameter).Identity;
        } catch {
            return null;
        }
    }

    // Formula graph is name-based and computed per parameter (O(n) per param over the parameter set —
    // the extensions expose no batch API; n is family-parameter-count, in the low hundreds, so fine).
    private static IReadOnlyList<string>? BuildFormulaDependsOn(
        FamilyParameter parameter,
        FamilyParameterSet parameterSet
    ) {
        try {
            var names = parameter.GetDependencies(parameterSet)
                .Select(dependency => dependency.Name())
                .Where(name => !string.IsNullOrEmpty(name))
                .Distinct(StringComparer.Ordinal)
                .ToList();
            return names.Count == 0 ? null : names;
        } catch {
            return null;
        }
    }

    private static IReadOnlyList<string>? BuildFormulaDependents(
        FamilyParameter parameter,
        FamilyParameterSet parameterSet
    ) {
        try {
            var names = parameter.GetDependents(parameterSet)
                .Select(dependent => dependent.Name())
                .Where(name => !string.IsNullOrEmpty(name))
                .Distinct(StringComparer.Ordinal)
                .ToList();
            return names.Count == 0 ? null : names;
        } catch {
            return null;
        }
    }

    private static FamilyParameterAssociationInfo? BuildParameterAssociations(
        FamilyParameter parameter,
        FamilyDocument familyDocument
    ) {
        var dimensions = CollectAssociationLabels(() => parameter
            .AssociatedDimensions(familyDocument)
            .Where(dimension => dimension.Id.Value() >= 0)
            .Select(FormatElementLabel));
        var arrays = CollectAssociationLabels(() => parameter
            .AssociatedArrays(familyDocument)
            .Where(array => array.Id.Value() >= 0)
            .Select(FormatElementLabel));
        var nested = BuildNestedAssociations(parameter);

        if (dimensions.Count == 0 && arrays.Count == 0 && nested.Count == 0)
            return null;

        return new FamilyParameterAssociationInfo(dimensions, arrays, nested);
    }

    private static IReadOnlyList<string> CollectAssociationLabels(Func<IEnumerable<string>> selector) {
        try {
            return selector().ToList();
        } catch {
            return [];
        }
    }

    private static IReadOnlyList<FamilyNestedAssociation> BuildNestedAssociations(FamilyParameter parameter) {
        try {
            var nested = new List<FamilyNestedAssociation>();
            foreach (Parameter associated in parameter.AssociatedParameters) {
                // Gotcha #13: skip phantom parameters (negative ids) and dangling owners.
                if (associated.Id.Value() < 0)
                    continue;

                Element? owner;
                try {
                    owner = associated.Element;
                } catch {
                    continue;
                }

                if (owner == null || owner.Id.Value() < 0)
                    continue;

                nested.Add(new FamilyNestedAssociation(
                    owner.Name ?? string.Empty,
                    owner.Id.Value().ToString(CultureInfo.InvariantCulture),
                    associated.Definition?.Name ?? string.Empty
                ));
            }

            return nested;
        } catch {
            return [];
        }
    }

    private static string FormatElementLabel(Element element) =>
        $"{element.Name} [ID:{element.Id.Value()}]";

    private static string GetFamilyEditorValue(FamilyType familyType, FamilyParameter parameter) {
        try {
            var value = familyType.AsValueString(parameter);
            if (!string.IsNullOrEmpty(value))
                return value;
        } catch {
        }

        try {
            var value = familyType.AsString(parameter);
            if (!string.IsNullOrEmpty(value))
                return value;
        } catch {
        }

        try {
            return parameter.StorageType switch {
                StorageType.Integer => familyType.AsInteger(parameter)?.ToString(CultureInfo.InvariantCulture) ?? string.Empty,
                StorageType.Double => familyType.AsDouble(parameter)?.ToString(CultureInfo.InvariantCulture) ?? string.Empty,
                StorageType.ElementId => familyType.AsElementId(parameter)?.ToString() ?? string.Empty,
                _ => string.Empty
            };
        } catch {
            return string.Empty;
        }
    }

    private static void ApplyFamilyEditorEdit(FamilyDocument familyDocument, FamilyEditorApplyEdit edit) {
        var familyManager = familyDocument.FamilyManager;
        var parameter = familyManager.FindParameter(edit.ParamName)
            ?? throw new InvalidOperationException($"Parameter not found: {edit.ParamName}");

        if (edit.Formula != null) {
            // Route through the validating helper (friendly error strings, single SetFormula).
            // An empty/whitespace formula clears the formula — preserved behavior.
            if (!familyDocument.TrySetFormula(parameter, edit.Formula, out var formulaError))
                throw new InvalidOperationException(
                    formulaError ?? $"Failed to set formula on parameter '{edit.ParamName}'.");
            return;
        }

        if (string.IsNullOrWhiteSpace(edit.TypeName))
            throw new InvalidOperationException("Value edits require typeName.");

        var value = edit.Value ?? string.Empty;
        // Gotcha #18: a per-type value that references parameter names is really a formula.
        if (!string.IsNullOrEmpty(value) && familyManager.Parameters.GetReferencedIn(value).Any())
            throw new InvalidOperationException("value references parameters — send it as a formula instead");

        var familyType = familyManager.Types.Cast<FamilyType>()
            .FirstOrDefault(type => string.Equals(type.Name, edit.TypeName, StringComparison.Ordinal))
            ?? throw new InvalidOperationException($"Type not found: {edit.TypeName}");
        familyManager.CurrentType = familyType;

        try {
            familyManager.SetValueString(parameter, value);
            return;
        } catch {
        }

        switch (parameter.StorageType) {
            case StorageType.String:
                familyManager.Set(parameter, value);
                break;
            case StorageType.Integer:
                familyManager.Set(parameter, int.Parse(value, CultureInfo.InvariantCulture));
                break;
            case StorageType.Double:
                familyManager.Set(parameter, double.Parse(value, CultureInfo.InvariantCulture));
                break;
            default:
                throw new InvalidOperationException($"Unsupported storage type {parameter.StorageType}.");
        }
    }

    private static string? GetSharedParameterGuid(FamilyParameter parameter) {
        if (!parameter.IsShared)
            return null;

        try {
            var guid = parameter.GUID;
            return guid == Guid.Empty ? null : guid.ToString("D");
        } catch {
            return null;
        }
    }

    private static string? GetParameterGroupLabel(Definition? definition) {
        var groupTypeId = definition?.GetGroupTypeId();
        if (groupTypeId == null || string.IsNullOrWhiteSpace(groupTypeId.TypeId))
            return null;

        try {
            return RevitLabelCatalog.GetLabelForPropertyGroup(groupTypeId);
        } catch {
            return groupTypeId.TypeId;
        }
    }

    private static string? NormalizeForgeTypeId(ForgeTypeId? forgeTypeId) {
        if (forgeTypeId == null || string.IsNullOrWhiteSpace(forgeTypeId.TypeId))
            return null;

        return forgeTypeId.TypeId;
    }

    private static RevitDocument GetActiveFamilyDocument() {
        var document = GetActiveDocument();
        if (document.IsFamilyDocument)
            return document;

        throw BridgeOperationExceptions.Conflict(
            "Active document is not a family document.",
            [
                BridgeOperationExceptions.Issue(
                    "$",
                    "ActiveFamilyDocumentRequired",
                    "Active document is not a family document.",
                    "Open a family in the Revit family editor and retry."
                )
            ]
        );
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
        // ponytail: still enumerates on the API thread inside the request queue. The tracker's
        // Open/metadata snapshots (DocumentTrackerAccessor.Current) make session context
        // answerable off-thread; move this off the queue when the hop starts to hurt.
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

    private static RevitDocument GetParameterLinksDocument(HostOperationDefinition operation) {
        var document = GetSupportedActiveDocument(operation);
        if (!document.IsFamilyDocument)
            return document;

        throw BridgeOperationExceptions.Conflict(
            "Parameter Links requires an active project document.",
            [BridgeOperationExceptions.Issue(
                "$",
                "ParameterLinksProjectDocumentRequired",
                "The active document is a family document.",
                "Activate a project document and retry.")]);
    }

    private static RevitDocument GetSupportedActiveDocument(HostOperationDefinition _) => GetActiveDocument();
}
