using Pe.Shared.Product;
using Pe.Revit.DocumentData.Schedules;
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
using Pe.Revit.Extensions.ProjDocument;
using Pe.Revit.Failures;
using Pe.Revit.Global.Services.Aps;
using Pe.Revit.Global.Services.Document;
using Pe.Revit.Global.Services.ParameterLinks;
using Pe.Revit.Parameters;
using Pe.Revit.Takeoff;
using Pe.Revit.Tasks;
using Pe.Revit.Loader.Documents;
using Pe.Shared.HostContracts.Operations;
using Pe.Shared.HostContracts.SettingsStorage;
using Pe.Shared.RevitData;
using Pe.Shared.RevitData.Ducts;
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
    private static TakeoffSnapshotResponse GetTakeoffSnapshotCore(NoRequest _, ProjectDocument activeDocument) =>
        RunTakeoff(activeDocument.Value, document =>
            new TakeoffSnapshotResponse(DocumentReading.Here(document), TakeoffAtlas.Snapshot(document)));

    [Op("takeoffs.candidates", Does = "Read Filled Regions and their boundary loops from one named plan view.", Title = "Get Takeoff Candidate Regions", Finds = ["takeoffs", "candidates", "filled-regions", "boundaries", "view"], Cost = OpCost.Bounded)]
    private static TakeoffCandidatesData GetTakeoffCandidatesCore(TakeoffCandidatesRequest request, ProjectDocument activeDocument) =>
        RunTakeoff(activeDocument.Value, document => new TakeoffCandidatesData(TakeoffAtlas.CandidateRegions(document, request)));

    [Op("takeoffs.adopt", Does = "Adopt Filled Regions as Zoning Regions and register their System tags in one transaction.", Title = "Adopt Takeoff Regions", Finds = ["takeoffs", "adopt", "zones", "filled-regions", "register"], Intent = OpIntent.Mutate, Actor = OpActor.Any, Cost = OpCost.Mutation)]
    private static TakeoffAdoptResult AdoptTakeoffRegionsCore(TakeoffAdoptRequest request, ProjectDocument activeDocument) =>
        RunTakeoff(activeDocument.Value, document => TakeoffAtlas.AdoptZones(document, request), "Pe Adopt Takeoff Regions");

    [Op("takeoffs.initialize-carrier", Does = "Bind the next missing Takeoff carrier for the requested stage in one transaction.", Title = "Initialize Next Takeoff Carrier", Finds = ["takeoffs", "initialize", "carriers", "shared-parameters"], Intent = OpIntent.Mutate, Actor = OpActor.Any, Cost = OpCost.Mutation)]
    private static TakeoffCarrierInitializationData InitializeTakeoffCarrierCore(TakeoffCarrierInitializationRequest request, ProjectDocument activeDocument) =>
        RunTakeoff(
            activeDocument.Value,
            document => TakeoffCarriers.InitializeNext(document, request.Stage),
            "Pe Initialize Takeoff Carrier");

    [Op("takeoffs.partition", Does = "Partition one Zoning Region on the resident Space soup and materialize Room Regions in one transaction.", Title = "Partition Takeoff Zone", Finds = ["takeoffs", "partition", "zones", "rooms", "materialize"], Intent = OpIntent.Mutate, Actor = OpActor.Any, Cost = OpCost.Mutation)]
    private static TakeoffPartitionResult PartitionTakeoffCore(TakeoffPartitionRequest request, ProjectDocument activeDocument) =>
        // ADR 0011: TakeoffAtlas.Partition calls Pe.Revit.Partition.Verbs.Partition and hands the
        // PartitionAnswer to ZoneMaterializer. The call cannot live in this file: Pe.Revit.Space
        // references Pe.Revit.Global, so Global referencing Partition is a project cycle.
        RunTakeoff(activeDocument.Value, document => TakeoffAtlas.Partition(document, request), "Pe Partition Takeoff Zone");

    [Op("takeoffs.rhvac-links", Does = "Write RHVAC file and room links to Room Region provenance in one transaction.", Title = "Link Takeoff Rooms to RHVAC", Finds = ["takeoffs", "rhvac", "links", "rooms", "provenance"], Intent = OpIntent.Mutate, Actor = OpActor.Any, Cost = OpCost.Mutation)]
    private static TakeoffRhvacLinksData LinkTakeoffRhvacCore(TakeoffRhvacLinksRequest request, ProjectDocument activeDocument) =>
        RunTakeoff(
            activeDocument.Value,
            document => new TakeoffRhvacLinksData(TakeoffAtlas.LinkRhvacBatch(document, request)),
            "Pe Link Takeoff Rooms to RHVAC");

    [Op("rooms.snapshot", Does = "Read plan-view levels and every zone, room, and held region on them with its parent zone, designation, room fields, geometry, and locked, touched, and stale state.", Title = "Get Rooms Snapshot", Finds = ["rooms", "snapshot", "levels", "room-regions", "filled-regions"], Cost = OpCost.Bounded)]
    private static RoomsSnapshotData GetRoomsSnapshotCore(NoRequest _, ProjectDocument activeDocument) =>
        RunTakeoff(activeDocument.Value, Rooms.Snapshot);

    [Op("ducts.snapshot", Does = "Read every duct network in the project: ducts, flex, fittings, accessories, terminals and HVAC equipment with their connectors, grouped by topology with equipment cut out, plus pass-1 terminal flow, fitting geometry ratios, fitting and accessory loss methods, terminal drops, Revit's supply/return/exhaust systems with critical path and sections, issues and the query behind each layer. Slots name the fan static, fan flow, component drop and terminal catalog drop parameters; labelParameter names the instance parameter whose value names equipment for people (each node's label). Read-only.", Title = "Get Duct Snapshot", Finds = ["ducts", "snapshot", "networks", "hvac", "connectors", "flow", "pressure", "loss", "critical-path"], Cost = OpCost.Bounded, Example = "{}")]
    private static DuctSnapshotData GetDuctSnapshotCore(DuctSnapshotRequest request, ProjectDocument activeDocument) =>
        Lib.Mep.DuctSnapshots.Snapshot(activeDocument.Value, request.Slots, request.LabelParameter);

    [Op("ducts.apply", Does = "Write duct losses into Revit so they travel with the model. Each fitting names a method: pe-server points it at the Pe loss server, which charges the family's own coefficient parameter live (the fittingCoefficient slot, default Pe_C) when the family carries one and otherwise prices each leg live from the write's ASHRAE table and the connectors' flows (taps, transitions, unstamped elbows); specific-coefficient freezes a number (export only). Revit's own ASHRAE-table route is never written. Also Specific Loss (in-wg) on duct accessories, terminal connector drops where the family connector is Specific Loss, fan external static on equipment through the fanStatic slot, and Pe's provenance store in the hidden _PE_DuctLosses Project Information parameter. previewOnly plans every write and refusal without a transaction. A real apply commits Not Defined on every targeted fitting, then the losses, in one undo step; a failed stage rolls everything back and is named. Returns per-target outcomes and the touched systems' critical path after.", Title = "Apply Duct Losses", Finds = ["ducts", "apply", "pressure", "loss", "coefficient", "terminal", "fan-static", "critical-path", "mutation"], Intent = OpIntent.Mutate, Actor = OpActor.Any, Cost = OpCost.Mutation, Example = "{ \"previewOnly\": true, \"fittings\": [{ \"id\": 12345, \"method\": \"pe-server\", \"coefficient\": 0.25, \"table\": \"CD3-1\", \"ruleKey\": \"elbow-1d-le10\" }, { \"id\": 12346, \"method\": \"pe-server\", \"coefficient\": 0.35, \"table\": \"SD5-10\", \"ruleKey\": \"tap-std\" }], \"terminals\": [], \"components\": [], \"equipment\": [], \"store\": { \"version\": 1 } }")]
    private static DuctApplyResult ApplyDuctsCore(DuctApplyRequest request, ProjectDocument activeDocument) {
        var document = activeDocument.Value;
        if (!request.PreviewOnly && document.IsReadOnly)
            throw BridgeOperationExceptions.Conflict(
                "The active project document is read-only.",
                [BridgeOperationExceptions.Issue("$", "DuctsDocumentReadOnly", "The active project document is read-only.",
                    "Open a writable project document and retry, or use previewOnly=true.")]);
        if (request.Store is null)
            throw BridgeOperationExceptions.Conflict(
                "ducts.apply needs the store read from ducts.snapshot.",
                [BridgeOperationExceptions.Issue("$.store", "DuctsStoreMissing", "The request carries no store.",
                    "Send ducts.snapshot's store (or { \"version\": 1 } when it has none) with the changes merged in.")]);
        try {
            return Lib.Mep.DuctApplier.Apply(document, request);
        } catch (BridgeOperationException) {
            throw;
        } catch (Exception ex) {
            Serilog.Log.Error(ex, "ducts.apply failed outside a stage");
            throw BridgeOperationExceptions.Unexpected("DuctsApplyException", ex, "Run ducts.apply with previewOnly=true and read each refusal, then retry.");
        }
    }

    [Op("ducts.heal", Does = "Heal duct geometry so the model itself is whole: cap a dangling open end with its duct type's Caps routing rule, connect coincident same-size ends, and close a same-size gap of at most 3 in with a union (two ducts) or by extending the duct (duct to part). Each item names connector keys elementId:connectorIndex from ducts.snapshot; the op refuses size changes, cross-class or cross-system joins, equipment, and longer gaps (a person's, in Revit). Every item must pass Pe's own post-check (connected, sizes equal, origins within 1/16 in, no system split or merged) or it is refused and rolled back alone. previewOnly runs everything and rolls it back; a real heal commits one transaction per group. Returns per-item outcomes with created and replaced element ids (Revit gives new ids to what it rebuilds; read ducts.snapshot again) and the touched systems' Revit critical path before and after.", Title = "Heal Duct Geometry", Finds = ["ducts", "heal", "cap", "open-end", "connect", "union", "repair", "mutation"], Intent = OpIntent.Mutate, Actor = OpActor.Any, Cost = OpCost.Mutation, Example = "{ \"previewOnly\": true, \"groups\": [{ \"group\": \"g12345\", \"items\": [{ \"key\": \"cap:12345:1\", \"kind\": \"cap\", \"end\": \"12345:1\" }, { \"key\": \"join:12350:0|12351:1\", \"kind\": \"join\", \"end\": \"12350:0\", \"other\": \"12351:1\" }] }] }")]
    private static DuctHealResult HealDuctsCore(DuctHealRequest request, ProjectDocument activeDocument) {
        var document = activeDocument.Value;
        if (document.IsReadOnly)
            throw BridgeOperationExceptions.Conflict(
                "The active project document is read-only.",
                [BridgeOperationExceptions.Issue("$", "DuctsDocumentReadOnly", "The active project document is read-only.",
                    "Open a writable project document and retry.")]);
        try {
            return Lib.Mep.DuctHealer.Heal(document, request);
        } catch (BridgeOperationException) {
            throw;
        } catch (Exception ex) {
            Serilog.Log.Error(ex, "ducts.heal failed outside an item");
            throw BridgeOperationExceptions.Unexpected("DuctsHealException", ex, "Run ducts.heal with previewOnly=true and read each refusal, then retry.");
        }
    }

    [Op("ducts.assign-fan", Does = "Make a unit the base equipment of a duct system (Revit's Duct Systems > Select Equipment), keeping the system's id, name, type and parameters. Refuses a system that already has base equipment (a swap drops the old base from the members and Revit does not restore it), anything that is not mechanical equipment, and a unit with no port of the system's air classification that is a member of the system or joined to its ducts (Revit itself checks neither). Reads back that the base equipment is the unit and the name, type and classification are unchanged, else refuses and rolls back. previewOnly runs the write and the read back and rolls them back. Returns the outcome and the system before and after (read ducts.snapshot again: systems[].baseEquipmentId).", Title = "Assign Duct System Fan", Finds = ["ducts", "fan", "base-equipment", "system", "select-equipment", "unit", "mutation"], Intent = OpIntent.Mutate, Actor = OpActor.Any, Cost = OpCost.Mutation, Example = "{ \"previewOnly\": true, \"systemId\": 6103113, \"unitId\": 9668311 }")]
    private static DuctAssignFanResult AssignDuctFanCore(DuctAssignFanRequest request, ProjectDocument activeDocument) {
        var document = activeDocument.Value;
        if (document.IsReadOnly)
            throw BridgeOperationExceptions.Conflict(
                "The active project document is read-only.",
                [BridgeOperationExceptions.Issue("$", "DuctsDocumentReadOnly", "The active project document is read-only.",
                    "Open a writable project document and retry.")]);
        try {
            return Lib.Mep.DuctFanAssigner.Assign(document, request);
        } catch (BridgeOperationException) {
            throw;
        } catch (Exception ex) {
            Serilog.Log.Error(ex, "ducts.assign-fan failed outside its guards");
            throw BridgeOperationExceptions.Unexpected("DuctsAssignFanException", ex, "Run ducts.assign-fan with previewOnly=true and read its refusal, then retry.");
        }
    }

    [Op("ducts.family-patch", Does = "Build the Family Foundry patch that gives a duct fitting family its own loss coefficient: an embedded lookup table (PeElbowC, dense over r/D, angle and diameter from Revit's shipped ASHRAE CD3 grids) and an instance number parameter (default Pe_C) with a rounding size_lookup formula, plus the run policy that lets Revit disconnect a fitting it cannot keep joined on reload. Hand the patch to families.plan then families.apply; ducts.apply with method pe-server then charges it live. Read-only; needs no document.", Title = "Build Duct Family Patch", Finds = ["ducts", "family", "patch", "lookup-table", "coefficient", "family-foundry", "elbow"], Actor = OpActor.Any, Cost = OpCost.Cheap, Example = "{ \"family\": \"Round Elbow\", \"kind\": \"round-elbow\", \"parameter\": \"Pe_C\" }")]
    private static DuctFamilyPatchData GetDuctFamilyPatchCore(DuctFamilyPatchRequest request) {
        try {
            return DuctFamilyTables.Patch(request, AshraeTables.Read(AshraeTables.DefaultFolder, DuctFamilyTables.ElbowSources));
        } catch (Exception ex) when (ex is DirectoryNotFoundException or InvalidOperationException or ArgumentException) {
            throw BridgeOperationExceptions.Conflict(
                ex.Message,
                [BridgeOperationExceptions.Issue("$", "DuctFamilyPatchUnavailable", ex.Message, "Name a loaded fitting family and make sure Revit's ASHRAE duct fitting tables are installed.")]);
        }
    }

    [Op("ducts.tables", Does = "Read ASHRAE duct fitting coefficient grids (Co, Cb, Cs) by table id from the .tbl files Revit installs, verbatim: axes, labels and values for a web lookup. Read-only; needs no document.", Title = "Get ASHRAE Duct Tables", Finds = ["ducts", "ashrae", "tables", "coefficient", "fittings", "pressure"], Actor = OpActor.Any, Cost = OpCost.Cheap, Example = "{ \"ids\": [\"CD3-2\", \"SD5-9\"] }")]
    private static DuctTablesData GetDuctTablesCore(DuctTablesRequest request) {
        try {
            return AshraeTables.Read(AshraeTables.DefaultFolder, request.Ids);
        } catch (DirectoryNotFoundException ex) {
            throw BridgeOperationExceptions.Conflict(
                ex.Message,
                [BridgeOperationExceptions.Issue(
                    "$",
                    "AshraeTablesMissing",
                    ex.Message,
                    "Install Revit's ASHRAE duct fitting tables (they ship with Revit 2025) and retry.")]);
        }
    }

    [Op("rooms.trace",Does = "Read the solver's layer 1 for each zone on one plan view from a rooms.partition run, the newest when runId is absent: rails, network segments by kind, openings with their evidence, per-face facts before judgment, and accounting.", Title = "Get Rooms Solver Trace", Finds = ["rooms", "trace", "partition", "rails", "openings", "solver"], Cost = OpCost.Bounded)]
    private static RoomsTraceData GetRoomsTraceCore(RoomsTraceRequest request, ProjectDocument activeDocument) =>
        RunTakeoff(activeDocument.Value, document => Rooms.Trace(document, request));

    [Op("rooms.partition",Does = "Partition each zone drawn on one plan view into rooms, adopting role-less Filled Regions as zones or rooms by wall evidence and keeping locked and matched Room Regions, in one transaction.", Title = "Partition Rooms", Finds = ["rooms", "partition", "level", "room-regions", "materialize"], Intent = OpIntent.Mutate, Actor = OpActor.Any, Cost = OpCost.Mutation)]
    private static RoomsPartitionResult PartitionRoomsCore(RoomsPartitionRequest request, ProjectDocument activeDocument) =>
        RunTakeoff(activeDocument.Value, document => Rooms.Partition(document, request), "Pe Partition Rooms");

    [Op("rooms.draw", Does = "Draw one room or zone region from loops on a plan view; a person's designation, so a room is locked.", Title = "Draw Room Region", Finds = ["rooms", "draw", "room-regions", "filled-regions", "loops"], Intent = OpIntent.Mutate, Actor = OpActor.Any, Cost = OpCost.Mutation)]
    private static RoomsDrawResult DrawRoomCore(RoomsDrawRequest request, ProjectDocument activeDocument) =>
        RunTakeoff(activeDocument.Value, document => Rooms.Draw(document, request), "Pe Draw Room Region");

    [Op("rooms.write", Does = "Write the given room fields, and a person's room or zone designation, onto regions by guid.", Title = "Write Room Fields", Finds = ["rooms", "write", "room-regions", "fields", "parameters"], Intent = OpIntent.Mutate, Actor = OpActor.Any, Cost = OpCost.Mutation)]
    private static RoomsWriteResult WriteRoomsCore(RoomsWriteRequest request, ProjectDocument activeDocument) =>
        RunTakeoff(activeDocument.Value, document => Rooms.Write(document, request), "Pe Write Room Fields");

    [Op("rooms.merge", Does = "Combine two or more rooms or held regions of one zone on one plan view into one locked Room Region, keeping the largest member's fields and RHVAC link and deleting the sources.", Title = "Merge Room Regions", Finds = ["rooms", "merge", "combine", "room-regions", "filled-regions"], Intent = OpIntent.Mutate, Actor = OpActor.Any, Cost = OpCost.Mutation)]
    private static RoomsMergeResult MergeRoomsCore(RoomsMergeRequest request, ProjectDocument activeDocument) =>
        RunTakeoff(activeDocument.Value, document => Rooms.Merge(document, request), "Pe Merge Room Regions");

    [Op("revit.apply.parameters-service-cache.refresh", Does = "Refresh the global APS Parameters Service cache through the connected Revit runtime.", Title = "Refresh Parameters Service Cache", Finds = ["aps", "parameters", "cache", "refresh", "parameter-service"], Intent = OpIntent.Mutate, Actor = OpActor.Any, Cost = OpCost.Mutation, Tier = OpTier.Expert, Thread = OpThread.Revit)]
    private static Task<ParametersServiceCacheData> RefreshParametersServiceCacheCore(
        NoRequest _,
        CancellationToken cancellationToken
    ) => cancellationToken.IsCancellationRequested
        ? Task.FromCanceled<ParametersServiceCacheData>(cancellationToken)
        : ParametersServiceCache.RefreshAsync();

    [Op("revit.apply.command.execute", Does = "Search Revit ribbon/postable commands by name and execute one by command id — the same discovery and PostCommand machinery as the command palette. Call with searchText to list candidates without executing, then commandId to post.", Title = "Execute Ribbon Command", Finds = ["command", "execute", "postable", "ribbon", "palette", "post", "trigger"], Intent = OpIntent.Mutate, Actor = OpActor.Any, Cost = OpCost.Mutation, Example = "{ \"searchText\": \"sheet\" }", Thread = OpThread.Revit)]
    private static RibbonCommandExecuteData ExecuteRibbonCommandCore(RibbonCommandExecuteRequest request, RevitDocument activeDocument) {
        // Ribbon commands act on the active window, so even discovery (CanExecute) reads it.
        var uiApp = RequireUi(activeDocument.Value, "window for ribbon commands").Application;

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
        } catch (TakeoffCarrierPrerequisiteException ex) {
            throw BridgeOperationExceptions.Conflict(
                ex.Message,
                [BridgeOperationExceptions.Issue(
                    "$",
                    "TakeoffCarriersNeedInitialization",
                    $"Missing carrier GUIDs: {string.Join(", ", ex.Preflight.MissingCarrierGuids.Select(guid => guid.ToString("D")))}",
                    $"Call takeoffs.initialize-carrier with stage '{ex.Preflight.Stage}' until status is ready.")]);
        } catch (System.InvalidOperationException ex) when (transactionName != null) {
            // Takeoff verbs refuse a failed precondition (cross-zone merge, no zone drawn) with this type, inside the
            // sandbox, so nothing committed: a conflict the host settles `failed`, never an uncertain fault.
            throw BridgeOperationExceptions.Conflict(
                ex.Message,
                [BridgeOperationExceptions.Issue("$", "TakeoffRefused", ex.Message, "Fix what the message names, then retry.")]);
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
        // Omitted references mean the current active sheet (SheetDetailCollector).
        var ui = UiFor(document, request.References?.CurrentActiveSheet ?? true, "active sheet");

        try {
            return SheetDetailCollector.Collect(document, ui?.ActiveView, request, DocShadow.For(document));
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
        var readsActiveView = request.Query?.Kind == ScheduleProfilesQueryKind.CurrentActiveView;
        var activeView = UiFor(document, readsActiveView, "active view")?.ActiveView;
        if (readsActiveView && activeView is not ViewSchedule) {
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
            return ScheduleProfileQueryCollector.Collect(document, request.Query, activeView);
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
        var activeScheduleView = UiFor(document, request.Query?.Kind == ScheduleQueryKind.CurrentActiveView, "active view")
            ?.ActiveView as ViewSchedule;
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
            (activeScheduleView.IsTemplate || !document.TryGetUserSchedule(activeScheduleView.Id, out _))) {
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

    [Op("revit.matrix.loaded-families", Does = "Read a matrix of loaded family snapshots (canonical family records: types, parameters with per-type values/formulas/scope, schedule membership) from the active document.", Title = "Get Loaded Families Matrix", Finds = ["loaded-families", "families", "matrix", "projection", "parameter-scope", "family-snapshot"], Cost = OpCost.Expensive, Example = "{ \"filter\": { \"categoryNames\": [\"Mechanical Equipment\"], \"familyNameContains\": \"VAV\", \"placementScope\": \"PlacedOnly\" }, \"budget\": { \"maxEntries\": 10, \"maxSamplesPerEntry\": 20 } }", UsesTransactions = true)]
    private LoadedFamiliesMatrixData GetLoadedFamiliesMatrixCore(LoadedFamiliesMatrixRequest request, RevitDocument activeDocument) {
        var filter = ValidateMatrixFilter(request);
        var document = activeDocument.Value;

        try {
            return ReadLoadedFamiliesMatrix(document, filter, request.Budget, request.IncludeTempPlacement, DocShadow.For(document));
        } catch (Exception ex) {
            throw BridgeOperationExceptions.Unexpected(
                "LoadedFamiliesMatrixException",
                ex,
                "Verify the active document is a project document and retry."
            );
        }
    }

    /// <summary>
    ///     The matrix read opens every family copy through the EditFamily gate. The gate refuses a destructive copy by name, and
    ///     Revit may still show that failure as a dialog (project-a hold 4b: 6 min blocked). The read runs in the dialog lane, and each
    ///     answered dialog is a named matrix issue.
    /// </summary>
    internal static LoadedFamiliesMatrixData ReadLoadedFamiliesMatrix(Autodesk.Revit.DB.Document document, LoadedFamiliesFilter? filter,
        RevitDataOutputBudget? budget, bool includeTempPlacement, Pe.Revit.DocumentData.Families.Extraction.IFamilySnapshotCache? snapshotCache) {
        var dialogs = new List<(bool IsError, string Message)>();
        var data = RevitDialogs.NoModal(dialogs, () => LoadedFamiliesMatrixCollector.Collect(document, filter,
            budget: budget, includeTempPlacement: includeTempPlacement, snapshotCache: snapshotCache));
        return data with { Issues = [.. data.Issues, .. dialogs.Select(d => new RevitDataIssue("RevitDialogAnswered", RevitDataIssueSeverity.Warning, d.Message))] };
    }

    [Op("data-table.apply", Does = "Upsert a synthetic data table in one host-owned transaction: a key schedule whose rows are freely user-editable and whose cells are shared parameters on stable row elements — ideal for arbitrary agent-authored tables like design conditions or install notes. Can also place the table on a sheet. Authored element schedules apply through schedule.apply.", Title = "Apply Data Table", Finds = ["schedules", "data-table", "key-schedule", "table", "apply", "create", "upsert", "rows", "sheet-placement", "mutation"], Intent = OpIntent.Mutate, Actor = OpActor.Any, Cost = OpCost.Mutation, Example = "{ \"table\": { \"name\": \"ASHRAE Design Conditions\", \"columns\": [{ \"heading\": \"Condition\" }, { \"heading\": \"Value (°F)\", \"kind\": \"Number\" }], \"rows\": [{ \"key\": \"cooling-db\", \"values\": [\"Cooling Design DB\", \"94.1\"] }, { \"key\": \"heating-db\", \"values\": [\"Heating Design DB\", \"12.3\"] }] }, \"placement\": { \"sheet\": \"M-001\" } }")]
    private ScheduleApplyData ApplyScheduleCore(ScheduleApplyRequest request, RevitDocument activeDocument) {
        var document = activeDocument.Value;
        if (request.Table is null)
            throw BridgeOperationExceptions.BadRequest("'table' is required.");

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

            var result = DataTableEngine.Apply(document, request.Table, warnings);
            var schedule = (ViewSchedule)document.GetElement(result.Table!.ScheduleId.ToElementId());

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

    [Op("revit.apply.parameter-links", Does = "Preview or atomically replace the model-owned parameter-link profile and reconcile its changed target values.", Title = "Apply Parameter Links", Finds = ["parameters", "links", "rules", "apply", "reconcile", "electrical", "circuits", "mocp", "mutation"], Intent = OpIntent.Mutate, Cost = OpCost.Mutation, Example = "{ \"previewOnly\": true }", Actor = OpActor.Human)]
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
        var ui = UiFor(document, request.Scope == RevitElementScope.ActiveViewVisible, "active view");

        try {
            return ScheduleCoverageCollector.Collect(document, request, ui?.ActiveView, DocShadow.For(document));
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
        var ui = UiFor(document, ReadsUi(request.Scope), "active view and selection");

        try {
            return ParameterCoverageCollector.Collect(document, request, SelectionOf(ui));
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
        var ui = UiFor(document, ReadsUi(request.Scope), "active view and selection");
        try {
            var primitives = DocShadow.For(document).GetParameterEvidencePrimitives(document, request.UseCache);
            return ParameterEvidenceCollector.Collect(document, request, primitives, SelectionOf(ui));
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
        var readsSelection = (request.Query?.Kind ?? ElementContextQueryKind.CurrentSelection) == ElementContextQueryKind.CurrentSelection;
        var ui = UiFor(document, readsSelection, "selection");

        try {
            return ElementContextCollector.Collect(document, request.Query, SelectionOf(ui));
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
        var readsActiveView = request.Query?.Kind == ElectricalPanelSchedulesQueryKind.CurrentActiveView;
        var activeView = UiFor(document, readsActiveView, "active view")?.ActiveView;
        if (readsActiveView && activeView is not PanelScheduleView) {
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

    [Op("family.temporary.acquire", Does = "Acquire an independent inactive copy of a loaded family for multiple calls. Retain acquisitionId before calling; retry only with that ID. Use the returned exact document ref for each query/action. Release at turn end; unchanged cleanup never saves or loads back.", Title = "Acquire Temporary Family", Finds = ["family", "temporary", "acquire", "edit-family"], Intent = OpIntent.Mutate, Actor = OpActor.Any, Cost = OpCost.Mutation)]
    private static TemporaryDocumentData AcquireTemporaryFamily(TemporaryFamilyAcquireRequest request, ProjectDocument source) {
        var session = HostRuntime.SessionId ?? throw new InvalidOperationException("Bridge session identity is unavailable.");
        var tracker = DocumentTrackerAccessor.Current ?? throw new InvalidOperationException("Document tracker is unavailable.");
        var document = source.Value;
        var trackedSource = tracker.Track(document);
        var family = document.GetElement(request.FamilyId.ToElementId()) as Family
            ?? throw new InvalidOperationException("Loaded family was not found in the selected project.");
        var diagnostics = new List<(bool IsError, string Message)>();
        var receipt = document.HandleFamilyCopyFailures(family,
            () => OwnedTemporaryDocuments.Acquire(RevitUiSession.CurrentUIApplication, tracker, request.AcquisitionId,
                $"{trackedSource.OpenId}:{request.FamilyId}", () => document.EditFamily(family)), diagnostics);
        return TemporaryResult(session, receipt);
    }

    [Op("document.temporary.release", Does = "Release only the native lifetime owned by acquisitionId. Default refuses changes since acquisition; discard is an explicit decision. Borrowed documents never close. A recovery-required result needs a user decision. Does not load a family back.", Title = "Release Temporary Document", Finds = ["family", "temporary", "release", "cleanup"], Intent = OpIntent.Mutate, Actor = OpActor.Any, Cost = OpCost.Mutation, Thread = OpThread.Revit)]
    private static TemporaryDocumentData ReleaseTemporaryDocument(TemporaryDocumentReleaseRequest request) {
        var session = HostRuntime.SessionId ?? throw new InvalidOperationException("Bridge session identity is unavailable.");
        var tracker = DocumentTrackerAccessor.Current ?? throw new InvalidOperationException("Document tracker is unavailable.");
        return TemporaryResult(session, OwnedTemporaryDocuments.Release(RevitUiSession.CurrentUIApplication, tracker,
            request.AcquisitionId, request.ReleaseId, request.ExpectedOpenId, request.Discard));
    }

    [Op("document.temporary.status", Does = "Recover a temporary document by its original acquisitionId without opening it again. SDK op result uses the returned recoveryId.", Title = "Recover Temporary Document", Finds = ["family", "temporary", "recovery", "status"], Thread = OpThread.Revit)]
    private static TemporaryDocumentData TemporaryDocumentStatus(TemporaryDocumentStatusRequest request) =>
        TemporaryResult(HostRuntime.SessionId ?? throw new InvalidOperationException("Bridge session identity is unavailable."),
            OwnedTemporaryDocuments.Status(request.AcquisitionId));

    private static TemporaryDocumentData TemporaryResult(string session, TemporaryDocumentReceipt receipt) =>
        new(receipt.AcquisitionId, receipt.Status, receipt.OpenId is { } openId ? new(session, openId) : null,
            receipt.RecoveryId, receipt.Detail, receipt.RecordedOpenId, receipt.RecordedStatus);

    [Op("family.open", Does = "Open a loaded family from the active project in the Revit family editor and activate it (saves to a scratch .rfa to make activation possible).", Title = "Open Family In Editor", Finds = ["family-editor", "family", "open", "edit-family", "activate"], Intent = OpIntent.Mutate, Actor = OpActor.Any, Cost = OpCost.Mutation)]
    private FamilyOpenData OpenFamilyCore(FamilyOpenRequest request, ProjectDocument activeDocument) {
        // EditFamily reads only the source document, so it may be inactive or headless; the family opens in a new window.
        var document = activeDocument.Value;
        var uiApp = RevitUiSession.CurrentUIApplication;

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
        var scratchDir = Path.Combine(ProductRuntimeLayout.ForCurrentUser().ScratchPath, "pe-family-editor");
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
        return new FamilyOpenData(family.Name, opened.Title, scratchPath);
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
                        "FamilyOpenFailed",
                        ex.Message,
                        "Verify Revit is idle, no modal dialog or transaction is active, and the model can be opened manually."
                    )
                ]
            );
        } catch (Exception ex) {
            throw BridgeOperationExceptions.Unexpected(
                "FamilyOpenException",
                ex,
                "Verify the path points to a supported local Revit document and retry."
            );
        }
    }

    [Op("revit.glance.model", Does = "One bounded 'what IS this model' packet: document identity, true project totals (views/sheets/schedules/families), levels, sheet-number series, family composition by category, and parameter-binding health. Summaries are complete, never truncated; observedAtUtc stamps freshness. Escalate to project-index for names/handles or loaded-families for rows.", Title = "Model at a Glance", Finds = ["glance", "model", "orientation", "totals", "composition", "discipline", "levels", "sheet-series", "binding-health", "start-here"], Cost = OpCost.Bounded, Tier = OpTier.Default)]
    private static GlanceModelData GetGlanceModelCore(NoRequest _, RevitDocument activeDocument) {
        var document = activeDocument.Value;
        try {
            return GlanceModelCollector.Collect(document, CreateDocumentSummary(document, ActiveUi(document)?.Document));
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
            return GlanceAttentionCollector.Collect(document, RequireUi(document, "screen (active view)").ActiveView);
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
            // A headless or inactive document answers its document-owned part; Document.IsHeadless says why the rest is empty.
            var ui = ActiveUi(document);
            return RevitAgentContextCollector.CollectSummary(
                document,
                CreateDocumentSummary(document, ui?.Document),
                CreateDocumentSessionContext(),
                ui?.ActiveView,
                SelectionOf(ui)
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
            // "this view" and "selected" resolve only on the active document; names and numbers resolve on any.
            var ui = ActiveUi(document);
            return RevitAgentContextCollector.Resolve(document, ui?.ActiveView, SelectionOf(ui), request);
        } catch (Exception ex) {
            throw BridgeOperationExceptions.Unexpected(
                "RevitAgentContextResolveException",
                ex,
                "Verify a Revit document is active and retry."
            );
        }
    }

    [Op("revit.resolve.family-instances", Does = "Resolve the exact captured familyId and familyUniqueId into current placed FamilyInstance refs across all of that family's types in this project document. Checks the paired family identity with no name or UniqueId fallback. Read-only; no transaction, family editor, active-view filter, or linked traversal. Scans document instances, returns exact total and at most maxResults refs (default 500, range 1..1000) with IDs and UniqueIds. Error issues refuse identity; empty or truncated results must not authorize Select or Selection Box. Does not select a family definition or resolve a type name. Use the captured document lifetime for this read and any later action.", Title = "Resolve Placed Family Instances", Finds = ["families", "family-instances", "placements", "resolve", "element-references", "select", "selection-box"], Intent = OpIntent.Read, Actor = OpActor.Any, Cost = OpCost.Bounded, Tier = OpTier.Default, Thread = OpThread.Revit, Example = "{ \"familyId\": 12345, \"familyUniqueId\": \"captured-family-unique-id\", \"maxResults\": 500 }")]
    private static FamilyInstanceReferencesData ResolveFamilyInstancesCore(
        FamilyInstanceReferencesRequest request,
        ProjectDocument document
    ) =>
        document.Value.ResolveFamilyInstances(request);

    [Op("revit.resolve.unit-value", Does = "Read what typed text means as a measured value in this document: Revit parses it for the given spec with the document's own units and answers with the value converted into the given display unit plus Revit's own rendering of it in that unit (no symbol). Read-only, no transaction. A surface stages { text, unit }; a refusal carries Revit's reason and stages nothing.", Title = "Resolve Measured Value", Finds = ["unit", "units", "parse", "measured", "value", "display-unit", "cell"], Cost = OpCost.Bounded, Example = "{ \"spec\": \"autodesk.spec.aec:airFlow-2.0.0\", \"unit\": \"CFM\", \"text\": \"300 L/s\" }")]
    private UnitValueResolveData ResolveUnitValueCore(
        UnitValueResolveRequest request,
        RevitDocument document
    ) =>
        UnitValueResolver.Resolve(document.Value, request);

    [Op("revit.context.visible-summary", Does = "Read compact category counts and bounded visible element handles for the active view or explicit view references.", Title = "Get Revit Agent Visible Context Summary", Finds = ["agent-context", "visible", "active-view", "view-references", "categories", "handles", "printed-views", "visible-equipment"], Example = "{ \"scope\": \"ActiveViewVisible\", \"categoryNames\": [\"Mechanical Equipment\"], \"maxCategories\": 5, \"maxElementHandlesPerCategory\": 250 }")]
    private RevitAgentVisibleContextData GetRevitAgentVisibleContextCore(
        RevitAgentVisibleContextRequest request,
        RevitDocument activeDocument
    ) {
        var document = activeDocument.Value;
        var ui = UiFor(document, request.Scope == RevitAgentVisibleContextScope.ActiveViewVisible, "active view");
        try {
            return RevitAgentContextCollector.CollectVisibleContext(document, ui?.ActiveView, request);
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
        var ui = UiFor(document, request.Scope == RevitAgentViewRenderingScope.ActiveView, "active view");
        try {
            return RevitAgentContextCollector.CollectViewRenderingState(document, ui?.ActiveView, request);
        } catch (Exception ex) {
            throw BridgeOperationExceptions.Unexpected(
                "RevitAgentViewRenderingStateException",
                ex,
                "Verify a project document and inspectable view are available, then retry."
            );
        }
    }

    [Op("revit.context.view-image", Does = "Export a view exactly as the user sees it (templates, VG overrides, temporary hide/isolate all apply) to a PNG and return its path. Target the active view (omit target), a view/sheet/viewport by id or name, or a schedule placed on a sheet. Optional focus crops to element ids, the current selection, or a scope box. The view exports unmodified, with all the user's settings; focus capture sets a temporary crop box (clearing any scope box, annotation crop on so the export spans only the crop) and restores it afterward (editable document only). A cropped view's image is exactly its model crop, cut from the export (which covers the view's whole outline) at the requested width (the response gives the delivered width and height, and a warning when a crop that is a small part of the view comes back a thumbnail), and returns registration: the model XY of the image's top-left, top-right and bottom-left corners plus the image sha256, which places pixels under model geometry even on a rotated crop.", Title = "Export View Image", Finds = ["view", "sheet", "viewport", "schedule", "image", "capture", "screenshot", "png", "export", "visual", "see", "look", "crop", "focus", "zoom", "registration", "underlay", "plan"], Example = "{ \"target\": { \"name\": \"A101\" }, \"pixelSize\": 2000 }", UsesTransactions = true)]
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

    [Op("revit.context.show-elements", Does = "Select elements in the active windowed document, or select model elements and box a 3D view around them. Selection changes UI state. Boxing creates or updates one view in one transaction, then activates it and zooms. With viewId, select and zoom that graphical view; with selectOnly, change selection only. ExpectedUniqueIds verify paired identity before selection. Answers selected, missing, identity-verified, boxed, hidden and unavailable targets separately; boxed does not guarantee visible. Nested linked elements are unsupported; no link-instance substitution. Requires an exact open document lifetime and refuses headless or linked documents.", Title = "Show Elements (Point At)", Finds = ["show", "select", "selection", "zoom", "focus", "point-at", "section-box", "3d", "highlight", "find", "navigate", "elements", "view"], Intent = OpIntent.Mutate, Actor = OpActor.Any, Cost = OpCost.Mutation, Tier = OpTier.Default, Example = "{ \"elementIds\": [12345, 67890] }")]
    private static RevitShowElementsData ShowElementsCore(RevitShowElementsRequest request, RevitDocument activeDocument) {
        var document = activeDocument.Value;
        var requested = (request.ElementIds ?? []).Distinct().ToList();
        if (requested.Count == 0)
            throw BridgeOperationExceptions.BadRequest("Name at least one element.",
                [BridgeOperationExceptions.Issue("$.elementIds", "ElementIdsEmpty", "elementIds is empty.",
                    "Pass element ids from a handle-returning op such as revit.context.visible-summary.")]);

        var ui = RequireUi(document, "window to show elements in");
        var view = request.ViewId is { } viewId ? document.GetElement(viewId.ToElementId()) as View : null;
        if (request.ViewId is not null && view is null or { IsTemplate: true } or ViewSchedule)
            throw BridgeOperationExceptions.Conflict("The view cannot show elements.",
                [BridgeOperationExceptions.Issue("$.viewId", "ViewNotGraphical",
                    $"{request.ViewId} is not a graphical, non-template view in '{document.Title}'.",
                    "Omit viewId for the active view, or pass a plan, section, 3D view, or sheet id.")]);

        if (request.ExpectedUniqueIds?.Keys.Except(requested).Any() == true)
            throw BridgeOperationExceptions.BadRequest("Expected identities must name requested IDs.",
                [BridgeOperationExceptions.Issue("$.expectedUniqueIds", "UnexpectedIdentity", "An expected identity names an ID outside elementIds.", "Pair each expected UniqueId with its requested element ID.")]);
        var resolved = document.ResolveShowTargets(requested, request.ExpectedUniqueIds);
        var ids = resolved.Resolved;
        var shown = new List<long>();
        var boxedIds = new List<long>();
        var hidden = new List<long>();
        var issues = resolved.Issues;
        RevitShowElementsData Answer(View target, string message) {
            var selected = ui.Selection.GetElementIds().Select(id => id.Value()).ToHashSet();
            issues.AddRange(shown.Where(id => !selected.Contains(id)).Select(id =>
                new RevitShowElementsIssue(id, "SelectionUnavailable", "Revit did not retain this target in the current selection.")));
            shown = shown.Where(selected.Contains).ToList();
            return new(shown, resolved.Missing, target.Id.Value(), target.Name, message,
                boxedIds, hidden, resolved.IdentityVerified, issues);
        }
        if (ids.Count == 0) return Answer(ui.ActiveView, "No requested target could be resolved; selection and view were left as they were.");
        string note;
        View target;
        try {
            if (request.SelectOnly) {
                ui.Selection.SetElementIds(ids);
                shown = ids.Select(id => id.Value()).ToList();
                target = ui.ActiveView;
                note = $"Selected {shown.Count}; '{target.Name}' left as it was.";
            } else if (view != null) {
                var box = ui.SelectAndZoom(ids, view);
                shown = ids.Select(id => id.Value()).ToList();
                target = ui.ActiveView;
                note = box is null
                    ? $"Selected {shown.Count}; none has a bounding box, so '{target.Name}' did not zoom."
                    : $"Selected {shown.Count} and zoomed '{target.Name}' to them.";
            } else {
                var boxed = ui.BoxInThreeD(ids);
                issues.AddRange(boxed.Issues);
                if (boxed.View is null) return Answer(ui.ActiveView, "Selection Box unavailable; no target has model geometry. Selection and view were left as they were.");
                target = boxed.View;
                shown = boxed.BoxedIds.Select(id => id.Value()).ToList();
                boxedIds = [..shown];
                hidden = boxed.HiddenIds.Select(id => id.Value()).ToList();
                note = $"Selected {shown.Count} and boxed '{target.Name}' around them";
                if (boxed.Created) note += "; the document had no {3D} view, so 'Pe 3D' was made";
                if (hidden.Count != 0) note += "; the view still hides some of them (filter, phase, or visibility)";
                note += ".";
            }
        } catch (Exception ex) when (ex is Autodesk.Revit.Exceptions.ApplicationException or InvalidOperationException) {
            var selected = ui.Selection.GetElementIds().ToHashSet();
            shown = ids.Where(selected.Contains).Select(id => id.Value()).ToList();
            issues.AddRange(ids.Select(id => new RevitShowElementsIssue(id.Value(), "ShowElementsRefused", ex.Message)));
            return Answer(ui.ActiveView, "Revit could not complete the action. The selected IDs report the current selection; a committed view edit may remain.");
        }

        if (resolved.Missing.Count != 0) note += $" {resolved.Missing.Count} id(s) not found.";
        return Answer(target, note);
    }

    // The clutter a lens hides: everything that is not the model. A whole-house 3D view at Fine with the architect's
    // links visible hung Revit's UI thread for 10+ minutes (2026-10-01); the lens stays at Medium, hidden lines, boxed.
    private static readonly BuiltInCategory[] LensClutter = [
        BuiltInCategory.OST_RvtLinks, BuiltInCategory.OST_VolumeOfInterest, BuiltInCategory.OST_Levels, BuiltInCategory.OST_Grids,
        BuiltInCategory.OST_CLines, BuiltInCategory.OST_MEPSpaces, BuiltInCategory.OST_HVAC_Zones, BuiltInCategory.OST_Rooms, BuiltInCategory.OST_Areas,
    ];

    [Op("revit.context.lens", Does = "Make or refresh this document's lens: a 3D view (default name 'Pe lens') with its section box around the elements, medium detail, hidden lines, and links, levels, grids, rooms, spaces and zones hidden. Answers the view id to pass to revit.context.show-elements. Adds or updates that one view and changes nothing else; the document may be headless.", Title = "Lens (Box a 3D View Around Elements)", Finds = ["lens", "3d", "view", "section-box", "box", "isolate", "zoom", "show", "focus", "look"], Intent = OpIntent.Mutate, Actor = OpActor.Any, Cost = OpCost.Mutation, Tier = OpTier.Default, Example = "{ \"elementIds\": [12345, 67890] }")]
    private static RevitLensData LensCore(RevitLensRequest request, RevitDocument activeDocument) {
        var document = activeDocument.Value;
        var requested = (request.ElementIds ?? []).Distinct().ToList();
        if (requested.Count == 0)
            throw BridgeOperationExceptions.BadRequest("Name at least one element.",
                [BridgeOperationExceptions.Issue("$.elementIds", "ElementIdsEmpty", "elementIds is empty.",
                    "Pass element ids from a handle-returning op such as revit.context.visible-summary.")]);
        var boxes = requested.Select(id => document.GetElement(id.ToElementId()))
            .Where(e => e is not null and not ElementType)
            .Select(e => e.get_BoundingBox(null))
            .Where(b => b is not null)
            .ToList();
        if (boxes.Count == 0)
            throw BridgeOperationExceptions.Conflict("None of the elements has a bounding box to look at.",
                [BridgeOperationExceptions.Issue("$.elementIds", "ElementsUnboxed",
                    $"No element in '{document.Title}' with the ids {string.Join(", ", requested)} has model geometry.",
                    "Pass model elements (not types, views, or systems); for a system pass its members.")]);

        var name = string.IsNullOrWhiteSpace(request.Name) ? "Pe lens" : request.Name.Trim();
        var pad = request.PaddingFeet ?? 4.0;
        var view = new FilteredElementCollector(document).OfClass(typeof(View3D)).Cast<View3D>()
            .FirstOrDefault(v => !v.IsTemplate && v.Name == name);
        var created = view is null;
        using var transaction = new Transaction(document, $"Lens: {name}");
        transaction.Start();
        if (view is null) {
            var family = new FilteredElementCollector(document).OfClass(typeof(ViewFamilyType)).Cast<ViewFamilyType>()
                .First(x => x.ViewFamily == ViewFamily.ThreeDimensional);
            view = View3D.CreateIsometric(document, family.Id);
            view.Name = name;
            view.ViewTemplateId = ElementId.InvalidElementId;
        }
        view.DetailLevel = ViewDetailLevel.Medium;
        view.DisplayStyle = DisplayStyle.HLR;
        foreach (var category in LensClutter) {
            var id = new ElementId(category);
            try { if (view.CanCategoryBeHidden(id)) view.SetCategoryHidden(id, true); } catch (Autodesk.Revit.Exceptions.ApplicationException) { }
        }
        var margin = new XYZ(pad, pad, pad);
        view.SetSectionBox(new BoundingBoxXYZ {
            Min = new XYZ(boxes.Min(b => b.Min.X), boxes.Min(b => b.Min.Y), boxes.Min(b => b.Min.Z)) - margin,
            Max = new XYZ(boxes.Max(b => b.Max.X), boxes.Max(b => b.Max.Y), boxes.Max(b => b.Max.Z)) + margin,
        });
        view.IsSectionBoxActive = true;
        if (transaction.Commit() != TransactionStatus.Committed)
            throw BridgeOperationExceptions.Conflict("Revit did not keep the lens.",
                [BridgeOperationExceptions.Issue("$", "LensRefused", $"The transaction for '{name}' was not committed.",
                    "Close any modal dialog or edit mode in Revit and retry.")]);
        return new RevitLensData(view.Id.Value(), name, created, boxes.Count,
            $"{(created ? "Made" : "Refreshed")} '{name}' boxed around {boxes.Count} element(s); pass viewId {view.Id.Value()} to revit.context.show-elements.");
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
            element = RequireUi(document, "active view").ActiveView;
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
            ids = SelectionOf(RequireUi(document, "selection"))!;
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

        return document.UnionBoundingBox(ids, view)
               ?? throw FocusError("NoFocusGeometry", "None of the focus elements have a bounding box in this view.");
    }

    private static BridgeOperationException FocusError(string code, string detail) =>
        BridgeOperationExceptions.Conflict(
            "Cannot resolve focus.",
            [BridgeOperationExceptions.Issue("$.focus", code, detail, "Adjust the focus and retry, or omit focus for the whole view.")]
        );

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

    /// <summary>The document's UI when it is the active document, else null. Document-owned branches pass it through for context only.</summary>
    private static UIDocument? ActiveUi(DbDocument document) =>
        RevitUiSession.CurrentUIApplication.GetActiveUIDocumentFor(document);

    /// <summary>
    ///     UI state (active view, selection, window) for a request branch that needs it. A headless document has
    ///     none and can never be activated, so its refusal names the document-owned way instead.
    /// </summary>
    private static UIDocument RequireUi(DbDocument document, string needs) =>
        ActiveUi(document) ?? throw (document.IsHeadless()
            ? BridgeOperationExceptions.Conflict(
                $"'{document.Title}' is headless (open with no window), so it has no {needs}.",
                [BridgeOperationExceptions.Issue("$", "DocumentHeadless",
                    $"This request needs the {needs}, which only the active windowed document has; a headless document cannot be activated.",
                    "Name explicit element, view, or sheet ids in the request, or run `pea script execute` against this document.")])
            : BridgeOperationExceptions.Conflict(
                $"This request needs the {needs}, and '{document.Title}' is not the active document.",
                [BridgeOperationExceptions.Issue("$", "DocumentNotActive",
                    $"Only the active document has a {needs}.",
                    "Activate its window in Revit and retry, or name explicit element, view, or sheet ids in the request.")]));

    /// <summary>UI for a request: required when the branch needs UI state, optional context otherwise.</summary>
    private static UIDocument? UiFor(DbDocument document, bool needsUi, string needs) =>
        needsUi ? RequireUi(document, needs) : ActiveUi(document);

    private static List<ElementId>? SelectionOf(UIDocument? ui) => ui?.Selection.GetElementIds().ToList();

    // The coverage and evidence collectors read Document.ActiveView for ActiveViewVisible, which is null on a
    // headless document, and they would answer for the whole document with only a warning.
    private static bool ReadsUi(RevitElementScope scope) =>
        scope is RevitElementScope.ActiveViewVisible or RevitElementScope.CurrentSelection;

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
            document.IsHeadless(),
            document.IsModifiable,
            document.IsReadOnly,
            document.IsModelInCloud,
            document.GetCloudProjectGuid(),
            document.GetCloudModelGuid(),
            document.GetCloudModelUrn()
        );
    }

}
