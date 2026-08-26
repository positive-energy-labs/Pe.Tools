using Autodesk.Revit.DB.Electrical;
using Pe.Revit.DocumentData.AgentContext;
using Pe.Revit.DocumentData.Electrical;
using Pe.Revit.DocumentData.Families.Loaded.Collectors;
using Pe.Revit.DocumentData.Glance;
using Pe.Revit.DocumentData.Parameters;
using Pe.Revit.Extensions.FamManager;
using Pe.Revit.DocumentData.ProjectBrowser;
using Pe.Revit.DocumentData.ProjectIndex;
using Pe.Revit.DocumentData.Schedules.Apply;
using Pe.Revit.DocumentData.Schedules.Collect;
using Pe.Revit.DocumentData.Schedules.DataTables;
using Pe.Revit.DocumentData.Selection;
using Pe.Revit.DocumentData.Sheets;
using Pe.Revit.Extensions.FamDocument;
using Pe.Revit.Extensions.FamParameter;
using Pe.Revit.Extensions.FamParameter.Formula;
using Pe.Revit.Failures;
using Pe.Revit.Global.Services.Aps;
using Pe.Revit.Global.Services.ParameterLinks;
using Pe.Revit.Parameters;
using Pe.Revit.Takeoff;
using Pe.Revit.Tasks;
using Pe.Shared.HostContracts.Operations;
using Pe.Shared.HostContracts.SettingsStorage;
using Pe.Shared.RevitData;
using Pe.Shared.RevitData.Families;
using Pe.Shared.RevitData.Schedules;
using Pe.Shared.RevitData.Takeoffs;
using System.Globalization;
using DbDocument = Autodesk.Revit.DB.Document;
using OpFamilyDocument = Pe.Revit.Operations.FamilyDocument;
using ProjectDocument = Pe.Revit.Operations.ProjectDocument;
using RevitDocument = Pe.Revit.Operations.RevitDocument;

namespace Pe.Revit.Global.Services.Host;

/// <summary>
///     Bridge-backed Revit data requests for browser routes.
/// </summary>
internal sealed class RevitDataRequestService {
    [Op("takeoffs.snapshot", Does = "Read Takeoff model status, plan views, zoning regions, materialized rooms, and source identity from the active project.", Title = "Get Takeoff Snapshot", Finds = ["takeoffs", "snapshot", "zones", "rooms", "filled-regions"], Cost = OpCost.Bounded)]
    private TakeoffSnapshotResponse GetTakeoffSnapshotCore(NoRequest _, ProjectDocument activeDocument) =>
        RunTakeoff(activeDocument.Value, document =>
            new TakeoffSnapshotResponse(this.CreateTakeoffReadingFrom(document), TakeoffAtlas.Snapshot(document)));

    [Op("takeoffs.views", Does = "Read non-template plan views with the Filled Region count for each view.", Title = "Get Takeoff Views", Finds = ["takeoffs", "views", "plans", "filled-regions"])]
    private static TakeoffViewsData GetTakeoffViewsCore(NoRequest _, ProjectDocument activeDocument) =>
        RunTakeoff(activeDocument.Value, document => new TakeoffViewsData(TakeoffAtlas.Views(document)));

    [Op("takeoffs.candidates", Does = "Read Filled Regions and their boundary loops from one named plan view.", Title = "Get Takeoff Candidate Regions", Finds = ["takeoffs", "candidates", "filled-regions", "boundaries", "view"], Cost = OpCost.Bounded)]
    private static TakeoffCandidatesData GetTakeoffCandidatesCore(TakeoffCandidatesRequest request, ProjectDocument activeDocument) =>
        RunTakeoff(activeDocument.Value, document => new TakeoffCandidatesData(TakeoffAtlas.CandidateRegions(document, request)));

    [Op("takeoffs.adopt", Does = "Adopt Filled Regions as Zoning Regions and register their System tags in one transaction.", Title = "Adopt Takeoff Regions", Finds = ["takeoffs", "adopt", "zones", "filled-regions", "register"], Intent = OpIntent.Mutate, Cost = OpCost.Mutation)]
    private static TakeoffAdoptResult AdoptTakeoffRegionsCore(TakeoffAdoptRequest request, ProjectDocument activeDocument) =>
        RunTakeoff(activeDocument.Value, document => TakeoffAtlas.AdoptZones(document, request), "Pe Adopt Takeoff Regions");

    [Op("takeoffs.prepare-capture", Does = "Prepare the capture views for one Takeoff plan view in one transaction.", Title = "Prepare Takeoff Capture", Finds = ["takeoffs", "capture", "prepare", "views"], Intent = OpIntent.Mutate, Cost = OpCost.Mutation)]
    private static TakeoffCapturePrepared PrepareTakeoffCaptureCore(TakeoffPrepareCaptureRequest request, ProjectDocument activeDocument) =>
        RunTakeoff(activeDocument.Value, document => TakeoffAtlas.PrepareCapture(document, request), "Pe Prepare Takeoff Capture");

    [Op("takeoffs.detect-capture", Does = "Capture one level, detect room geometry, and write replay evidence without committing Revit changes.", Title = "Detect Takeoff Capture", Finds = ["takeoffs", "capture", "detect", "replay", "rooms"], Cost = OpCost.Expensive)]
    private static TakeoffCaptureResult DetectTakeoffCaptureCore(TakeoffDetectCaptureRequest request, ProjectDocument activeDocument) =>
        RunTakeoff(activeDocument.Value, document => TakeoffAtlas.DetectCapture(document, request));

    [Op("takeoffs.partition", Does = "Partition one Zoning Region from replay evidence and materialize Room Regions in one transaction.", Title = "Partition Takeoff Zone", Finds = ["takeoffs", "partition", "zones", "rooms", "materialize"], Intent = OpIntent.Mutate, Cost = OpCost.Mutation)]
    private static TakeoffPartitionResult PartitionTakeoffCore(TakeoffPartitionRequest request, ProjectDocument activeDocument) =>
        RunTakeoff(activeDocument.Value, document => TakeoffAtlas.Partition(document, request), "Pe Partition Takeoff Zone");

    [Op("takeoffs.decisions", Does = "Write review decisions to one Room Region provenance blob in one transaction.", Title = "Write Takeoff Decisions", Finds = ["takeoffs", "decisions", "review", "provenance"], Intent = OpIntent.Mutate, Cost = OpCost.Mutation)]
    private static TakeoffWriteResult WriteTakeoffDecisionsCore(TakeoffDecisionsRequest request, ProjectDocument activeDocument) =>
        RunTakeoff(activeDocument.Value, document => TakeoffAtlas.WriteDecisions(document, request), "Pe Write Takeoff Decisions");

    [Op("takeoffs.rhvac-links", Does = "Write RHVAC file and room links to Room Region provenance in one transaction.", Title = "Link Takeoff Rooms to RHVAC", Finds = ["takeoffs", "rhvac", "links", "rooms", "provenance"], Intent = OpIntent.Mutate, Cost = OpCost.Mutation)]
    private static TakeoffRhvacLinksData LinkTakeoffRhvacCore(TakeoffRhvacLinksRequest request, ProjectDocument activeDocument) =>
        RunTakeoff(
            activeDocument.Value,
            document => new TakeoffRhvacLinksData(TakeoffAtlas.LinkRhvacBatch(document, request)),
            "Pe Link Takeoff Rooms to RHVAC");

    [Op("takeoffs.room-type", Does = "Write and read back one Room Region room type in one transaction.", Title = "Write Takeoff Room Type", Finds = ["takeoffs", "room-type", "rooms", "parameter"], Intent = OpIntent.Mutate, Cost = OpCost.Mutation)]
    private static TakeoffRoomTypeData WriteTakeoffRoomTypeCore(TakeoffRoomTypeRequest request, ProjectDocument activeDocument) =>
        RunTakeoff(
            activeDocument.Value,
            document => new TakeoffRoomTypeData(TakeoffAtlas.WriteRoomType(document, request)),
            "Pe Write Takeoff Room Type");

    [Op("revit.apply.parameters-service-cache.refresh", Does = "Refresh the global APS Parameters Service cache through the connected Revit runtime.", Title = "Refresh Parameters Service Cache", Finds = ["aps", "parameters", "cache", "refresh", "parameter-service"], Intent = OpIntent.Mutate, Cost = OpCost.Mutation, Tier = OpTier.Expert)]
    private static Task<ParametersServiceCacheData> RefreshParametersServiceCacheCore(
        NoRequest _,
        CancellationToken cancellationToken
    ) => cancellationToken.IsCancellationRequested
        ? Task.FromCanceled<ParametersServiceCacheData>(cancellationToken)
        : ParametersServiceCache.RefreshAsync();

    [Op("revit.apply.command.execute", Does = "Search Revit ribbon/postable commands by name and execute one by command id — the same discovery and PostCommand machinery as the command palette. Call with searchText to list candidates without executing, then commandId to post.", Title = "Execute Ribbon Command", Finds = ["command", "execute", "postable", "ribbon", "palette", "post", "trigger"], Intent = OpIntent.Mutate, Cost = OpCost.Mutation, Example = "{ \"searchText\": \"sheet\" }", Thread = OpThread.Revit)]
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

    private TakeoffReadingFrom CreateTakeoffReadingFrom(DbDocument document) {
        var target = BridgeSessionIdentity.Resolve().SdkSessionId;
        if (string.IsNullOrWhiteSpace(target))
            throw BridgeOperationExceptions.Conflict(
                "The Revit session has no SDK session ID.",
                [BridgeOperationExceptions.Issue(
                    "$",
                    "TakeoffTargetRequired",
                    "The Revit session has no SDK session ID.",
                    "Start Revit through pe-revit session and retry.")]);

        var documentId = document.GetCloudModelGuid();
        if (string.IsNullOrWhiteSpace(documentId)) {
            var path = document.GetDocumentPath();
            if (string.IsNullOrWhiteSpace(path))
                throw BridgeOperationExceptions.Conflict(
                    "The active document has no cloud model GUID or absolute path.",
                    [BridgeOperationExceptions.Issue(
                        "$",
                        "TakeoffDocumentIdentityRequired",
                        "The active document has no cloud model GUID or absolute path.",
                        "Save the document or open a cloud model and retry.")]);
            documentId = Path.GetFullPath(path);
        }

        return new TakeoffReadingFrom(
            target,
            documentId,
            GetDocumentVersionToken(document),
            DateTimeOffset.UtcNow.UtcDateTime.ToString("O", CultureInfo.InvariantCulture));
    }

    private static string GetDocumentVersionToken(DbDocument document) =>
        DbDocument.GetDocumentVersion(document).VersionGUID.ToString("D");

    private static T RunTakeoff<T>(DbDocument document, Func<DbDocument, T> run, string? transactionName = null) {
        if (transactionName != null && document.IsReadOnly)
            throw BridgeOperationExceptions.Conflict(
                "The active project document is read-only.",
                [BridgeOperationExceptions.Issue(
                    "$",
                    "TakeoffDocumentReadOnly",
                    "The active project document is read-only.",
                    "Open a writable project document and retry.")]);

        try {
            if (transactionName == null)
                return run(document);

            using var sandbox = DocumentSandbox.BeginCommit(document, transactionName);
            var result = run(document);
            sandbox.Complete();
            return result;
        } catch (BridgeOperationException) {
            throw;
        } catch (Exception ex) {
            throw BridgeOperationExceptions.Unexpected(
                "TakeoffOperationException",
                ex,
                "Verify the active project and request, then retry.");
        }
    }

    [Op("revit.catalog.loaded-families", Does = "Read loaded family and type facts from the active document.", Title = "Get Loaded Families Catalog", Finds = ["loaded-families", "families", "types", "catalog"], Example = "{ \"filter\": { \"placementScope\": \"PlacedOnly\" }, \"projection\": { \"view\": \"Summary\" }, \"budget\": { \"maxEntries\": 25 } }")]
    private LoadedFamiliesCatalogData GetLoadedFamiliesCatalogCore(LoadedFamiliesCatalogRequest request, RevitDocument activeDocument) {
        var document = activeDocument.Value;

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

    [Op("revit.catalog.schedules", Does = "Read compact schedule handles, names, sheet placement, optional field metadata, and factual schedule evidence summaries from the active document. Revit-generated duplicate suffixes like '(2)' and 'Copy 1' are normalized out of name summary weighting. Do not use broad schedule catalog discovery for visible equipment coverage when revit.matrix.schedule-coverage can answer from view or element handles.", Title = "Get Schedule Catalog", Finds = ["schedules", "catalog", "fields", "columns", "parameters", "document", "sheet-placement", "printed-context"], Example = "{ \"projection\": { \"view\": \"Summary\" }, \"budget\": { \"maxEntries\": 25 } }")]
    private ScheduleCatalogData GetScheduleCatalogCore(ScheduleCatalogRequest request, RevitDocument activeDocument) {
        var document = activeDocument.Value;

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

    [Op("revit.catalog.project-browser", Does = "Read bounded Project Browser organization for views, sheets, and schedules as navigation/provenance metadata.", Title = "Get Project Browser", Finds = ["project-browser", "browser", "views", "sheets", "schedules", "folders", "navigation", "provenance"], Example = "{ \"sections\": [\"Views\", \"Sheets\", \"Schedules\"], \"view\": \"Folders\", \"budget\": { \"maxSamplesPerEntry\": 5 } }")]
    private ProjectBrowserData GetProjectBrowserCore(ProjectBrowserRequest request, RevitDocument activeDocument) {
        var document = activeDocument.Value;

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

    [Op("revit.catalog.project-index", Does = "Read a compact semantic project index with bounded Project Browser provenance for levels, sheets, views, schedules, categories, and families. Use after revit.context.summary when you need actual names and handles across the project, not just counts.", Title = "Get Project Index", Finds = ["project-index", "project-browser", "browser-provenance", "levels", "sheets", "views", "schedules", "printed-context", "orientation"], Example = "{ \"includeBrowserProvenance\": true, \"includeModelContext\": true, \"browserSections\": [\"Views\", \"Sheets\", \"Schedules\"], \"projection\": { \"view\": \"Summary\" }, \"budget\": { \"maxEntries\": 25, \"maxSamplesPerEntry\": 5 } }")]
    private ProjectIndexData GetProjectIndexCore(ProjectIndexRequest request, RevitDocument activeDocument) {
        var document = activeDocument.Value;

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

    [Op("revit.detail.sheets", Does = "Read minimal native sheet anchors for extractor and scripting workflows: sheet identity, placed views, placed schedules, title blocks, sheet-owned text, and provenance.", Title = "Get Sheet Details", Finds = ["sheets", "sheet-anchors", "printed-context", "viewports", "schedule-placement", "title-blocks", "text-notes", "extractor-boundary"], Cost = OpCost.Bounded, Example = "{ \"references\": { \"currentActiveSheet\": true }, \"projection\": { \"view\": \"Anchors\", \"includeTextNotes\": true, \"includeBoundingBoxes\": true }, \"budget\": { \"maxEntries\": 1, \"maxSamplesPerEntry\": 80 } }")]
    private SheetDetailData GetSheetDetailsCore(SheetDetailRequest request, RevitDocument activeDocument) {
        var document = activeDocument.Value;

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

    [Op("revit.matrix.schedule-profiles", Does = "Read schedule profile projections from the active document.", Title = "Get Schedule Profiles Query", Finds = ["schedules", "profiles", "query", "projection", "authored-schedule-shape"], Cost = OpCost.Expensive, Tier = OpTier.Expert, Example = "{ \"query\": { \"kind\": \"CurrentActiveView\" } }")]
    private ScheduleProfilesQueryData GetScheduleProfilesQueryCore(ScheduleProfilesQueryRequest request, RevitDocument activeDocument) {
        var document = activeDocument.Value;
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

    [Op("revit.detail.schedules", Does = "Read schedule rows and field values from the active document.", Title = "Get Schedule Query", Finds = ["schedules", "query", "rows", "values", "detail"], Cost = OpCost.Bounded, Example = "{ \"query\": { \"kind\": \"ScheduleReferences\", \"scheduleIds\": [12345], \"projection\": { \"view\": \"Handles\" }, \"budget\": { \"maxEntries\": 1, \"maxRowsPerEntry\": 0 } } }")]
    private ScheduleQueryData GetScheduleQueryCore(ScheduleQueryRequest request, RevitDocument activeDocument) {
        var document = activeDocument.Value;
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

    [Op("revit.matrix.loaded-families", Does = "Read a matrix of loaded family snapshots (canonical family records: types, parameters with per-type values/formulas/scope, schedule membership) from the active document.", Title = "Get Loaded Families Matrix", Finds = ["loaded-families", "families", "matrix", "projection", "parameter-scope", "family-snapshot"], Cost = OpCost.Expensive, Example = "{ \"filter\": { \"categoryNames\": [\"Mechanical Equipment\"], \"familyNameContains\": \"VAV\", \"placementScope\": \"PlacedOnly\" }, \"budget\": { \"maxEntries\": 10, \"maxSamplesPerEntry\": 20 } }")]
    private LoadedFamiliesMatrixData GetLoadedFamiliesMatrixCore(LoadedFamiliesMatrixRequest request, RevitDocument activeDocument) {
        var filter = ValidateMatrixFilter(request);
        var document = activeDocument.Value;

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

    [Op("family.editor.snapshot", Does = "Read parameters, types, formulas, and display values from the active family editor document.", Title = "Get Family Editor Snapshot", Finds = ["family-editor", "family", "parameters", "types", "formulas", "snapshot"])]
    private FamilyEditorSnapshotData GetFamilyEditorSnapshotCore(NoRequest _, OpFamilyDocument activeDocument) {
        var document = activeDocument.Value;

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

    [Op("family.editor.apply", Does = "Apply parameter value and formula edits to the active family editor document in one host-owned transaction.", Title = "Apply Family Editor Edits", Finds = ["family-editor", "family", "parameters", "apply", "formulas", "mutation"], Intent = OpIntent.Mutate, Cost = OpCost.Mutation)]
    private FamilyEditorApplyData ApplyFamilyEditorEditsCore(FamilyEditorApplyRequest request, OpFamilyDocument activeDocument) {
        var document = activeDocument.Value;
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
        _ = failureOptions.SetFailuresPreprocessor(PeToolsFailureHandling.CreatePreprocessor(commitFailures));
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

    [Op("revit.apply.parameter-values", Does = "Apply parameter values to project elements in one host-owned transaction, redeeming binding handles (target element id + parameter id) returned by revit.detail.schedules projection.includeBindings.", Title = "Apply Parameter Values", Finds = ["parameters", "apply", "mutation", "elements", "schedule-bindings", "binding-handles", "cell-edit", "write"], Intent = OpIntent.Mutate, Cost = OpCost.Mutation, Example = "{ \"edits\": [{ \"elementId\": 12345, \"parameterId\": -1010106, \"value\": \"AHU-1\" }, { \"elementId\": 67890, \"parameterId\": -1002501, \"value\": \"Roof unit\" }] }")]
    private ParameterValueApplyData ApplyParameterValuesCore(ParameterValueApplyRequest request, RevitDocument activeDocument) {
        var document = activeDocument.Value;
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

    [Op("revit.apply.schedule", Does = "Create or update a schedule in one host-owned transaction. Two lanes: 'table' upserts a synthetic data table (a key schedule whose rows are freely user-editable and whose cells are shared parameters on stable row elements — ideal for arbitrary agent-authored tables like design conditions or install notes); 'profile' creates a regular element-driven schedule from an authored schedule profile. Either lane can also place the schedule on a sheet.", Title = "Apply Schedule", Finds = ["schedules", "data-table", "key-schedule", "table", "apply", "create", "upsert", "rows", "sheet-placement", "mutation"], Intent = OpIntent.Mutate, Cost = OpCost.Mutation, Example = "{ \"table\": { \"name\": \"ASHRAE Design Conditions\", \"columns\": [{ \"heading\": \"Condition\" }, { \"heading\": \"Value (°F)\", \"kind\": \"Number\" }], \"rows\": [{ \"key\": \"cooling-db\", \"values\": [\"Cooling Design DB\", \"94.1\"] }, { \"key\": \"heating-db\", \"values\": [\"Heating Design DB\", \"12.3\"] }] }, \"placement\": { \"sheet\": \"M-001\" } }")]
    private ScheduleApplyData ApplyScheduleCore(ScheduleApplyRequest request, RevitDocument activeDocument) {
        var document = activeDocument.Value;
        if ((request.Table == null) == (request.Profile == null)) {
            throw BridgeOperationExceptions.BadRequest(
                "Exactly one of 'table' or 'profile' must be set.");
        }

        if (!request.DryRun && document.IsReadOnly) {
            throw BridgeOperationExceptions.Conflict(
                "Active document is read-only.",
                [BridgeOperationExceptions.Issue(
                    "$",
                    "ScheduleApplyDocumentReadOnly",
                    "Active document is read-only.",
                    "Open a writable project document and retry, or use dryRun=true.")]);
        }

        try {
            using var sandbox = DocumentSandbox.BeginCommit(document, "Pe Apply Schedule");
            var warnings = new List<string>();

            ScheduleApplyData result;
            ViewSchedule schedule;
            if (request.Table != null) {
                result = DataTableEngine.Apply(document, request.Table, warnings);
                schedule = (ViewSchedule)document.GetElement(result.Table!.ScheduleId.ToElementId());
            } else {
                var creation = ScheduleHelper.CreateSchedule(document, request.Profile!);
                schedule = creation.Schedule;
                warnings.AddRange(creation.Warnings);
                result = new ScheduleApplyData {
                    Profile = new ScheduleApplyProfileSummary(
                        creation.ScheduleName,
                        schedule.Id.Value(),
                        schedule.UniqueId) {
                        AppliedFields = creation.AppliedFields.Select(field => field.ParameterName).ToList(),
                        SkippedFields = creation.SkippedFields
                    },
                    Warnings = warnings
                };
            }

            if (request.Placement != null)
                result = result with { Placement = DataTableEngine.Place(document, schedule, request.Placement) };

            // DryRun validates the full apply inside the transaction, then rolls back on dispose.
            if (!request.DryRun)
                sandbox.Complete();

            return result with { DryRun = request.DryRun };
        } catch (BridgeOperationException) {
            throw;
        } catch (ArgumentException ex) {
            throw BridgeOperationExceptions.BadRequest(ex.Message);
        } catch (Exception ex) {
            throw BridgeOperationExceptions.Unexpected(
                "ScheduleApplyException",
                ex,
                "Verify the active document is a writable project document and the spec references valid sheets/columns, then retry.");
        }
    }

    [Op("revit.detail.data-tables", Does = "Read every synthetic data table (or specific ones by name): columns, current cell values including user edits, stable row element ids/uniqueIds, and sheet placements. Row uniqueIds are the addressing surface for parameter-links and external table UIs.", Title = "Inspect Data Tables", Finds = ["schedules", "data-table", "key-schedule", "rows", "values", "handles", "sheet-placement"], Cost = OpCost.Bounded, Example = "{ }")]
    private DataTableDetailData GetDataTablesCore(DataTableDetailRequest request, RevitDocument activeDocument) {
        var document = activeDocument.Value;
        try {
            return DataTableEngine.CollectAll(document, request);
        } catch (Exception ex) {
            throw BridgeOperationExceptions.Unexpected(
                "DataTableDetailException",
                ex,
                "Verify the active document is a project document and retry.");
        }
    }

    [Op("revit.detail.parameter-links", Does = "Read the model-owned parameter-link profile and preview every proposed target write and issue.", Title = "Inspect Parameter Links", Finds = ["parameters", "links", "rules", "preview", "electrical", "circuits", "mocp"], Cost = OpCost.Bounded, Example = "{ \"includeEvaluation\": true }")]
    private ParameterLinksData GetParameterLinksCore(ParameterLinksDetailRequest request, ProjectDocument activeDocument) {
        var document = activeDocument.Value;
        return ParameterLinksService.Instance.Detail(document, request.IncludeEvaluation);
    }

    [Op("revit.apply.parameter-links", Does = "Preview or atomically replace the model-owned parameter-link profile and reconcile its changed target values.", Title = "Apply Parameter Links", Finds = ["parameters", "links", "rules", "apply", "reconcile", "electrical", "circuits", "mocp", "mutation"], Intent = OpIntent.Mutate, Cost = OpCost.Mutation, Example = "{ \"previewOnly\": true }")]
    private ParameterLinksData ApplyParameterLinksCore(ParameterLinksApplyRequest request, ProjectDocument activeDocument) {
        var document = activeDocument.Value;
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

    [Op("revit.matrix.schedule-coverage", Does = "Read bounded element-to-schedule coverage counts and samples from the active document, including active-view-visible or explicit-handle scopes.", Title = "Get Schedule Coverage Matrix", Finds = ["schedules", "coverage", "matrix", "elements", "handles", "active-view-visible", "explicit-handles", "visible-equipment", "printed-context"], Cost = OpCost.Expensive, Example = "{ \"scope\": \"ViewReferences\", \"viewIds\": [12345, 67890], \"categoryNames\": [\"Mechanical Equipment\"], \"scheduleRoleScope\": \"IssuedOrWorking\", \"scheduleFilter\": { \"scheduleNameContains\": \"Equipment\", \"placementScope\": \"PlacedOnly\", \"projection\": { \"view\": \"Handles\", \"includeSheetPlacements\": true }, \"budget\": { \"maxEntries\": 25 } }, \"includeMissingElementHandles\": true, \"includeMatchedScheduleNames\": true, \"budget\": { \"maxEntries\": 250, \"maxSamplesPerEntry\": 0 } }")]
    private ScheduleCoverageData GetScheduleCoverageCore(ScheduleCoverageRequest request, RevitDocument activeDocument) {
        var document = activeDocument.Value;

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

    [Op("revit.matrix.parameter-coverage", Does = "Read bounded parameter presence, blank/default counts, and sample handles from the active document.", Title = "Get Parameter Coverage Matrix", Finds = ["parameters", "coverage", "matrix", "elements", "handles"], Cost = OpCost.Expensive, Example = "{ \"categoryNames\": [\"Mechanical Equipment\"], \"scope\": \"ActiveViewVisible\", \"parameters\": [{ \"name\": \"Mark\" }, { \"name\": \"Comments\" }], \"defaultValues\": [\"0\", \"-\"], \"budget\": { \"maxEntries\": 25, \"maxSamplesPerEntry\": 5 } }")]
    private ParameterCoverageData GetParameterCoverageCore(ParameterCoverageRequest request, RevitDocument activeDocument) {
        var validationIssues = ValidateParameterCoverageRequest(request);
        if (validationIssues.Count != 0) {
            throw BridgeOperationExceptions.BadRequest(
                "Parameter coverage request is invalid.",
                validationIssues
            );
        }

        var document = activeDocument.Value;

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

    [Op("revit.catalog.concept-evidence", Does = "Infer project-specific parameter candidates for operator concepts from factual binding and schedule evidence. Category and subject hints are weak context, not expected-shape rules; use returned reasons and facts before detail or coverage calls.", Title = "Get Concept Evidence", Finds = ["concepts", "parameter-evidence", "project-standards", "bindings", "schedule-fields", "discovery"], Example = "{ \"query\": \"equipment electrical load circuit panel location\", \"subjectHints\": [\"Mechanical Equipment\", \"Plumbing Equipment\"], \"budget\": { \"maxEntries\": 5, \"maxSamplesPerEntry\": 3 } }")]
    private ConceptEvidenceData GetConceptEvidenceCore(ConceptEvidenceRequest request, RevitDocument activeDocument) {
        var document = activeDocument.Value;
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

    [Op("revit.catalog.parameter-evidence", Does = "Return factual parameter evidence from project bindings, schedule fields/filters, and scoped element presence. Use this when project-standard parameter names are uncertain; inspect binding categories, schedule usage, counts, and samples, then pass observed parameter identities or named references into detail or matrix calls.", Title = "Get Parameter Evidence", Finds = ["parameters", "evidence", "project-bindings", "schedule-fields", "categories", "parameter-usage"], Example = "{ \"categoryNames\": [\"Mechanical Equipment\"], \"scope\": \"ActiveViewVisible\", \"candidateParameters\": [{ \"name\": \"Mark\" }, { \"name\": \"Equipment Tag\" }], \"budget\": { \"maxEntries\": 10, \"maxSamplesPerEntry\": 2 } }")]
    private ParameterEvidenceData GetParameterEvidenceCore(ParameterEvidenceRequest request, RevitDocument activeDocument) {
        var validationIssues = ValidateParameterEvidenceRequest(request);
        if (validationIssues.Count != 0) {
            throw BridgeOperationExceptions.BadRequest(
                "Parameter evidence request is invalid.",
                validationIssues
            );
        }

        var document = activeDocument.Value;
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

    [Op("revit.catalog.parameter-bindings", Does = "Read project parameter bindings from the active document, using the same canonical parameter identity and shared-GUID string language returned by parameter evidence and coverage operations.", Title = "Get Project Parameter Bindings", Finds = ["parameters", "project-parameters", "bindings", "document", "catalog", "parameter-identity", "shared-guid"], Example = "{ \"projection\": { \"view\": \"Summary\" }, \"budget\": { \"maxEntries\": 50 } }")]
    private ProjectParameterBindingsData GetProjectParameterBindingsCore(
        ProjectParameterBindingsRequest request,
        RevitDocument activeDocument
    ) {
        var validationIssues = ValidateProjectParameterBindingsRequest(request);
        if (validationIssues.Count != 0) {
            throw BridgeOperationExceptions.BadRequest(
                "Project parameter bindings request is invalid.",
                validationIssues
            );
        }

        var document = activeDocument.Value;

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

    [Op("revit.detail.elements", Does = "Read exact element context, selected/visible equipment facts, requested parameters, electrical systems, circuits, panels, connectors, panel schedules, load classifications, and nearby document facts from connected Revit.", Title = "Get Element Context Query", Finds = ["elements", "selection", "context", "query", "requested-parameters", "electrical", "circuits", "panel", "load-name", "explicit-handles", "visible-handles", "selected-equipment", "equipment-alignment"], Cost = OpCost.Bounded, Example = "{ \"query\": { \"kind\": \"ElementReferences\", \"elementIds\": [12345, 67890], \"parameterQuery\": { \"parameters\": [{ \"name\": \"Mark\" }, { \"name\": \"Panel\" }, { \"name\": \"Circuit Number\" }, { \"name\": \"Load Name\" }] } } }")]
    private ElementContextQueryData GetElementContextQueryCore(
        ElementContextQueryRequest request,
        RevitDocument activeDocument
    ) {
        var document = activeDocument.Value;

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

    [Op("revit.catalog.electrical-panels", Does = "Read electrical panel facts, panel names, marks, panel-schedule counts, connected-load counts, and compact filter diagnostics from the active Revit document.", Title = "Get Electrical Panels Catalog", Finds = ["revit", "panels", "catalog", "distribution", "electrical-equipment", "panel-schedule-references", "panel-names"], Example = "{ \"filter\": { \"panelNames\": [\"C6P\"] } }")]
    private ElectricalPanelsCatalogData GetElectricalPanelsCatalogCore(
        ElectricalPanelsCatalogRequest request,
        RevitDocument activeDocument
    ) {
        var document = activeDocument.Value;

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

    [Op("revit.catalog.electrical-circuits", Does = "Read electrical circuit facts, connected load identity, panel names, circuit numbers, optional nearby proxy context, and compact filter diagnostics from the active Revit document.", Title = "Get Electrical Circuits Catalog", Finds = ["revit", "circuits", "catalog", "loads", "panel", "load-name", "connected-elements", "nearby-proxy", "equipment-alignment"], Example = "{ \"filter\": { \"panelNames\": [\"C6P\"], \"loadNames\": [\"RV-13, DH-7 - Lower Level\"], \"circuitNumbers\": [\"1\"] }, \"options\": { \"parameterQuery\": { \"parameters\": [{ \"name\": \"Mark\" }, { \"name\": \"Panel\" }, { \"name\": \"Circuit Number\" }, { \"name\": \"Load Name\" }] } } }")]
    private ElectricalCircuitsCatalogData GetElectricalCircuitsCatalogCore(
        ElectricalCircuitsCatalogRequest request,
        RevitDocument activeDocument
    ) {
        var document = activeDocument.Value;

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

    [Op("revit.detail.electrical-panel-schedules", Does = "Read electrical panel schedule row/cell projections from the active Revit document. Use this for known panels/schedules, not as the first-choice element-to-load join.", Title = "Get Electrical Panel Schedules Query", Finds = ["revit", "panel-schedules", "query", "schedules", "rows", "cells", "known-panel", "panel-references", "downstream-detail"], Cost = OpCost.Bounded, Example = "{ \"query\": { \"kind\": \"PanelReferences\", \"panelNames\": [\"C6P\"], \"projection\": { \"view\": \"RowsOnly\", \"circuitNumbers\": [\"1\"], \"loadNameContains\": [\"RV-13, DH-7\"], \"maxRows\": 10 } } }")]
    private ElectricalPanelSchedulesQueryData GetElectricalPanelSchedulesQueryCore(
        ElectricalPanelSchedulesQueryRequest request,
        RevitDocument activeDocument
    ) {
        var document = activeDocument.Value;
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

    [Op("revit.catalog.electrical-load-classifications", Does = "Read electrical load classification facts from the active Revit document.", Title = "Get Electrical Load Classifications Catalog", Finds = ["revit", "load-classifications", "catalog", "loads"], Tier = OpTier.Expert)]
    private ElectricalLoadClassificationsCatalogData GetElectricalLoadClassificationsCatalogCore(
        ElectricalLoadClassificationsCatalogRequest request,
        RevitDocument activeDocument
    ) {
        var document = activeDocument.Value;

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

    [Op("revit.context.document-session", Does = "Read open, active, and selected document session context from connected Revit. Use only when the question spans multiple open documents or there is no active document; revit.context.summary covers single-document orientation.", Title = "Get Revit Document Session Context", Finds = ["document", "session", "active-document", "open-documents"], Thread = OpThread.Revit)]
    private RevitDocumentSessionContextData GetRevitDocumentSessionContextCore(NoRequest _) {
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

    [Op("family.editor.open", Does = "Open a loaded family from the active project in the Revit family editor and activate it (saves to a scratch .rfa to make activation possible).", Title = "Open Family In Editor", Finds = ["family-editor", "family", "open", "edit-family", "activate"], Intent = OpIntent.Mutate, Cost = OpCost.Mutation)]
    private FamilyEditorOpenData OpenFamilyEditorCore(FamilyEditorOpenRequest request, ProjectDocument activeDocument) {
        var uiApp = RevitUiSession.CurrentUIApplication;
        var document = activeDocument.Value;

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
        return new FamilyEditorOpenData(family.Name, opened.Title, scratchPath);
    }

    private Autodesk.Revit.DB.Document OpenLocalRevitDocument(UIApplication uiApp, string path) {
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

        var alreadyOpen = uiApp.FindOpenDocumentByPath(path);
        if (alreadyOpen != null)
            return alreadyOpen;

        try {
            var modelPath = ModelPathUtils.ConvertUserVisiblePathToModelPath(path);
            return uiApp.OpenAndActivateDocument(modelPath, new OpenOptions(), false).Document;
        } catch (BridgeOperationException) {
            throw;
        } catch (Exception ex) when (ex is InvalidOperationException or OperationCanceledException) {
            throw BridgeOperationExceptions.Conflict(
                $"Revit could not open document: {path}",
                [
                    BridgeOperationExceptions.Issue(
                        "$.path",
                        "FamilyEditorDocumentOpenFailed",
                        ex.Message,
                        "Verify Revit is idle, no modal dialog or transaction is active, and the model can be opened manually."
                    )
                ]
            );
        } catch (Exception ex) {
            throw BridgeOperationExceptions.Unexpected(
                "FamilyEditorDocumentOpenException",
                ex,
                "Verify the path points to a supported local Revit document and retry."
            );
        }
    }

    [Op("revit.glance.model", Does = "One bounded 'what IS this model' packet: document identity, true project totals (views/sheets/schedules/families), levels, sheet-number series, family composition by category, and parameter-binding health. Summaries are complete, never truncated; observedAtUtc stamps freshness. Escalate to project-index for names/handles or loaded-families for rows.", Title = "Model at a Glance", Finds = ["glance", "model", "orientation", "totals", "composition", "discipline", "levels", "sheet-series", "binding-health", "start-here"], Cost = OpCost.Bounded, Tier = OpTier.Default)]
    private static GlanceModelData GetGlanceModelCore(NoRequest _, RevitDocument activeDocument) {
        var document = activeDocument.Value;
        try {
            var documentSummary = CreateDocumentSessionContext().ActiveDocument
                ?? throw new InvalidOperationException("Active document summary unavailable.");
            return GlanceModelCollector.Collect(document, documentSummary);
        } catch (BridgeOperationException) {
            throw;
        } catch (Exception ex) {
            throw BridgeOperationExceptions.Unexpected(
                "GlanceModelException",
                ex,
                "Verify a Revit document is active and retry."
            );
        }
    }

    [Op("revit.glance.attention", Does = "One bounded 'what is on the user's screen' packet: active-view identity, observed view state, visible category composition (counts, generous bounds), and the verbatim trust strip (confidenceWarnings, apiLimitations, notInspected). observedAtUtc stamps freshness. Escalate to visible-summary for element handles or view-rendering-state for multi-view comparison.", Title = "Screen at a Glance", Finds = ["glance", "attention", "screen", "active-view", "visible", "trust", "what-user-sees", "start-here"], Cost = OpCost.Bounded, Tier = OpTier.Default)]
    private static GlanceAttentionData GetGlanceAttentionCore(NoRequest _, RevitDocument activeDocument) {
        var document = activeDocument.Value;
        try {
            return GlanceAttentionCollector.Collect(
                document,
                RevitUiSession.CurrentUIApplication.GetActiveView()
            );
        } catch (BridgeOperationException) {
            throw;
        } catch (Exception ex) {
            throw BridgeOperationExceptions.Unexpected(
                "GlanceAttentionException",
                ex,
                "Verify a Revit document and active view are available, then retry."
            );
        }
    }

    [Op("revit.context.summary", Does = "THE orientation call: compact current document, active view or sheet, selection, browser counts, and visible-category context. Call this first; escalate to project-index for names/handles, visible-summary for element handles, or document-session for multi-document facts.", Title = "Get Revit Agent Context Summary", Finds = ["agent-context", "summary", "active-view", "selection", "visible", "browser", "orientation", "start-here"], Tier = OpTier.Default)]
    private RevitAgentContextSummaryData GetRevitAgentContextSummaryCore(NoRequest _, RevitDocument activeDocument) {
        var document = activeDocument.Value;
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

    [Op("revit.resolve.references", Does = "Resolve natural references like this view, selected equipment, or printed mech Level 1 plan into stable Revit handles with provenance; narrow by handle kind and printed context when the user already described the scope.", Title = "Resolve Revit Agent Context Reference", Finds = ["agent-context", "resolve", "natural-reference", "handles", "provenance", "printed-context", "view-handles"], Cost = OpCost.Bounded, Tier = OpTier.Default, Example = "{ \"referenceText\": \"printed lower level mechanical equipment plans M201 M202\", \"handleKinds\": [\"View\", \"Sheet\"], \"requirePrintedContext\": true, \"maxPerHandleKind\": 4, \"maxResults\": 8, \"compact\": true }")]
    private RevitAgentContextResolveData ResolveRevitAgentContextCore(
        RevitAgentContextResolveRequest request,
        RevitDocument activeDocument
    ) {
        var document = activeDocument.Value;
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

    [Op("revit.context.visible-summary", Does = "Read compact category counts and bounded visible element handles for the active view or explicit view references.", Title = "Get Revit Agent Visible Context Summary", Finds = ["agent-context", "visible", "active-view", "view-references", "categories", "handles", "printed-views", "visible-equipment"], Example = "{ \"scope\": \"ActiveViewVisible\", \"categoryNames\": [\"Mechanical Equipment\"], \"maxCategories\": 5, \"maxElementHandlesPerCategory\": 250 }")]
    private RevitAgentVisibleContextData GetRevitAgentVisibleContextCore(
        RevitAgentVisibleContextRequest request,
        RevitDocument activeDocument
    ) {
        var document = activeDocument.Value;
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

    [Op("revit.context.view-rendering-state", Does = "Read a bounded evidence packet for visibility/rendering-affecting state in the active view or explicit views, including explicit limitations and uninspected causes.", Title = "Get Revit Agent View Rendering State", Finds = ["agent-context", "view-rendering", "visibility", "active-view", "view-references", "filters", "links", "worksets", "view-range", "crop", "template"], Example = "{ \"scope\": \"ActiveView\", \"maxFiltersPerView\": 60, \"maxHiddenCategoriesPerView\": 40, \"maxLinksPerView\": 25 }")]
    private RevitAgentViewRenderingStateData GetRevitAgentViewRenderingStateCore(
        RevitAgentViewRenderingStateRequest request,
        RevitDocument activeDocument
    ) {
        var document = activeDocument.Value;
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

    [Op("revit.context.view-image", Does = "Export a view exactly as the user sees it (templates, VG overrides, temporary hide/isolate all apply) to a PNG and return its path. Target the active view (omit target), a view/sheet/viewport by id or name, or a schedule placed on a sheet. Optional focus crops to element ids, the current selection, or a scope box. Whole-view capture needs no transaction; focus capture sets a temporary crop box (clearing any scope box) and restores it afterward (editable document only).", Title = "Export View Image", Finds = ["view", "sheet", "viewport", "schedule", "image", "capture", "screenshot", "png", "export", "visual", "see", "look", "crop", "focus", "zoom"], Example = "{ \"target\": { \"name\": \"A101\" }, \"pixelSize\": 2000 }")]
    private RevitViewImageData GetRevitViewImageCore(RevitViewImageRequest request, RevitDocument activeDocument) {
        var document = activeDocument.Value;
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
    private static Element? ResolveCaptureTarget(DbDocument document, RevitViewImageTarget? target) {
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

    private static View? FindViewByName(DbDocument document, string name, string? onSheet) {
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

    private static ViewSheet? FindSheet(DbDocument document, string sheetKey) =>
        new FilteredElementCollector(document).OfClass(typeof(ViewSheet)).Cast<ViewSheet>()
            .FirstOrDefault(s => string.Equals(s.SheetNumber, sheetKey, StringComparison.OrdinalIgnoreCase)
                                 || string.Equals(s.Name, sheetKey, StringComparison.OrdinalIgnoreCase));

    private static (ViewSheet Sheet, ScheduleSheetInstance Instance) ResolveScheduleplacement(
        DbDocument document,
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
    private static BoundingBoxXYZ? ResolveFocusBox(DbDocument document, View view, RevitViewImageFocus? focus) {
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
                union = new BoundingBoxXYZ {
                    Transform = Transform.Identity,
                    Min = box.Transform.OfPoint(box.Min),
                    Max = box.Transform.OfPoint(box.Max)
                };
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
        DbDocument document,
        DbDocument? activeDocument
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

}
