using Pe.Shared.HostContracts.Scripting;
using Pe.Shared.HostContracts.SettingsStorage;
using Pe.Shared.RevitData;
using Pe.Shared.RevitData.Schedules;

namespace Pe.Shared.HostContracts.Operations;

public static class RevitBridgeOps {
    public static readonly BridgeOp SettingsSchema =
        BridgeOp.Create<SchemaRequest, SchemaData>(
            "settings.schema",
            "Get Schema",
            HostOperationAgentMetadata.Create(
                "Read a settings schema from the connected Revit runtime.",
                new[] { "schema", "settings", "profile", "profiles", "module", "family-foundry" },
                requiresActiveDocument: true
            ),
            static (request, context, ct) => context.Settings.GetSchemaAsync(request)
        );

    public static readonly BridgeOp FieldOptions =
        BridgeOp.Create<FieldOptionsRequest, FieldOptionsData>(
            "settings.field-options",
            "Get Field Options",
            HostOperationAgentMetadata.Create(
                "Read document-specific field option values for a settings module.",
                new[] { "settings", "field-options", "schema", "document" },
                requiresActiveDocument: true
            ),
            static (request, context, ct) => context.Settings.GetFieldOptionsAsync(request)
        );

    public static readonly BridgeOp SettingsModuleCatalog =
        BridgeOp.CreateInternal<NoRequest, GetSettingsModuleCatalogBridgeResponse>(
            "settings.module-catalog",
            "Get Settings Module Catalog",
            HostOperationAgentMetadata.Create(
                "Read the settings module catalog from Revit for bridge-side schema work.",
                new[] { "settings", "module", "catalog", "schema" },
                requiresActiveDocument: true
            ),
            static (request, context, ct) => context.Settings.GetSettingsModuleCatalogAsync()
        );

    public static readonly BridgeOp ParameterCatalog =
        BridgeOp.Create<ParameterCatalogRequest, ParameterCatalogData>(
            "settings.parameter-catalog",
            "Get Parameter Catalog",
            HostOperationAgentMetadata.Create(
                "Read Revit parameter definitions and available parameter facts from the active document for settings authoring.",
                new[] { "parameters", "catalog", "settings", "document" },
                requiresActiveDocument: true
            ),
            static (request, context, ct) => context.Settings.GetParameterCatalogAsync(request)
        );

    public static readonly BridgeOp LoadedFamiliesFilterFieldOptions =
        BridgeOp.FromDefinition<LoadedFamiliesFilterFieldOptionsRequest, FieldOptionsData>(
            GetLoadedFamiliesFilterFieldOptionsOperationContract.Definition,
            static (request, context, ct) => context.Settings.GetLoadedFamiliesFilterFieldOptionsAsync(request)
        );

    public static readonly BridgeOp LoadedFamiliesFilterSchema =
        BridgeOp.FromDefinition<NoRequest, SchemaData>(
            GetLoadedFamiliesFilterSchemaOperationContract.Definition,
            static (request, context, ct) => context.Settings.GetLoadedFamiliesFilterSchemaAsync()
        );

    public static readonly BridgeOp ScheduleCatalog =
        BridgeOp.FromDefinition<ScheduleCatalogRequest, ScheduleCatalogData>(
            GetScheduleCatalogOperationContract.Definition,
            static (request, context, ct) => context.RevitData.GetScheduleCatalogAsync(request)
        );

    public static readonly BridgeOp ProjectBrowser =
        BridgeOp.FromDefinition<ProjectBrowserRequest, ProjectBrowserData>(
            GetProjectBrowserOperationContract.Definition,
            static (request, context, ct) => context.RevitData.GetProjectBrowserAsync(request)
        );

    public static readonly BridgeOp ProjectIndex =
        BridgeOp.FromDefinition<ProjectIndexRequest, ProjectIndexData>(
            GetProjectIndexOperationContract.Definition,
            static (request, context, ct) => context.RevitData.GetProjectIndexAsync(request)
        );

    public static readonly BridgeOp SheetDetails =
        BridgeOp.FromDefinition<SheetDetailRequest, SheetDetailData>(
            GetSheetDetailsOperationContract.Definition,
            static (request, context, ct) => context.RevitData.GetSheetDetailsAsync(request)
        );

    public static readonly BridgeOp ScheduleProfilesQuery =
        BridgeOp.FromDefinition<ScheduleProfilesQueryRequest, ScheduleProfilesQueryData>(
            GetScheduleProfilesQueryOperationContract.Definition,
            static (request, context, ct) => context.RevitData.GetScheduleProfilesQueryAsync(request)
        );

    public static readonly BridgeOp ScheduleQuery =
        BridgeOp.FromDefinition<ScheduleQueryRequest, ScheduleQueryData>(
            GetScheduleQueryOperationContract.Definition,
            static (request, context, ct) => context.RevitData.GetScheduleQueryAsync(request)
        );

    public static readonly BridgeOp LoadedFamiliesCatalog =
        BridgeOp.FromDefinition<LoadedFamiliesCatalogRequest, LoadedFamiliesCatalogData>(
            GetLoadedFamiliesCatalogOperationContract.Definition,
            static (request, context, ct) => context.RevitData.GetLoadedFamiliesCatalogAsync(request)
        );

    public static readonly BridgeOp LoadedFamiliesMatrix =
        BridgeOp.FromDefinition<LoadedFamiliesMatrixRequest, LoadedFamiliesMatrixData>(
            GetLoadedFamiliesMatrixOperationContract.Definition,
            static (request, context, ct) => context.RevitData.GetLoadedFamiliesMatrixAsync(request)
        );

    public static readonly BridgeOp ScheduleCoverage =
        BridgeOp.FromDefinition<ScheduleCoverageRequest, ScheduleCoverageData>(
            GetScheduleCoverageOperationContract.Definition,
            static (request, context, ct) => context.RevitData.GetScheduleCoverageAsync(request)
        );

    public static readonly BridgeOp ParameterCoverage =
        BridgeOp.FromDefinition<ParameterCoverageRequest, ParameterCoverageData>(
            GetParameterCoverageOperationContract.Definition,
            static (request, context, ct) => context.RevitData.GetParameterCoverageAsync(request)
        );

    public static readonly BridgeOp ConceptEvidence =
        BridgeOp.FromDefinition<ConceptEvidenceRequest, ConceptEvidenceData>(
            GetConceptEvidenceOperationContract.Definition,
            static (request, context, ct) => context.RevitData.GetConceptEvidenceAsync(request)
        );

    public static readonly BridgeOp ParameterEvidence =
        BridgeOp.FromDefinition<ParameterEvidenceRequest, ParameterEvidenceData>(
            GetParameterEvidenceOperationContract.Definition,
            static (request, context, ct) => context.RevitData.GetParameterEvidenceAsync(request)
        );

    public static readonly BridgeOp ProjectParameterBindings =
        BridgeOp.FromDefinition<ProjectParameterBindingsRequest, ProjectParameterBindingsData>(
            GetProjectParameterBindingsOperationContract.Definition,
            static (request, context, ct) => context.RevitData.GetProjectParameterBindingsAsync(request)
        );

    public static readonly BridgeOp ElementContextQuery =
        BridgeOp.Create<ElementContextQueryRequest, ElementContextQueryData>(
            "revit.detail.elements",
            "Get Element Context Query",
            HostOperationAgentMetadata.Create(
                "Read exact element context, selected/visible equipment facts, requested parameters, electrical systems, circuits, panels, connectors, panel schedules, load classifications, and nearby document facts from connected Revit.",
                new[] { "elements", "selection", "context", "query", "requested-parameters", "electrical", "circuits", "panel", "load-name", "explicit-handles", "visible-handles", "selected-equipment", "equipment-alignment" },
                requiresActiveDocument: true,
                requestExamples: [
                    RevitDataHostOperationExamples.Example(
                        "visible equipment electrical context",
                        "Use element ids returned by revit.context.visible-summary ViewReferences/ActiveViewVisible to inspect exact visible equipment before broad electrical catalog queries.",
                        """
                        { "query": { "kind": "ElementReferences", "elementIds": [12345, 67890], "parameterQuery": { "parameters": [{ "name": "Mark" }, { "name": "Panel" }, { "name": "Circuit Number" }, { "name": "Load Name" }] } } }
                        """
                    ),
                    RevitDataHostOperationExamples.Example(
                        "explicit equipment electrical context by unique id",
                        "Use when prior host operations or scripts returned unique ids rather than numeric ids.",
                        """
                        { "query": { "kind": "ElementReferences", "elementUniqueIds": ["abcd-1234"], "parameterQuery": { "parameters": [{ "name": "Mark" }, { "name": "Panel" }, { "name": "Circuit Number" }, { "name": "Load Name" }] } } }
                        """
                    )
                ],
                callGuidance: [
                    "For instance-specific electrical alignment, call revit.detail.elements on exact handles from selection, visible-summary, schedule coverage samples, or a narrow script before broad panel schedule or circuit catalog queries.",
                    "Use parameterQuery.parameters with names or observed ParameterIdentity values for visible tag/load-name fields, then expand to revit.catalog.electrical-circuits or revit.detail.electrical-panel-schedules only after panel/circuit candidates are known.",
                ]
            ),
            static (request, context, ct) => context.RevitData.GetElementContextQueryAsync(request)
        );

    public static readonly BridgeOp ElectricalPanelsCatalog =
        BridgeOp.Create<ElectricalPanelsCatalogRequest, ElectricalPanelsCatalogData>(
            "revit.catalog.electrical-panels",
            "Get Electrical Panels Catalog",
            HostOperationAgentMetadata.Create(
                "Read electrical panel facts, panel names, marks, panel-schedule counts, connected-load counts, and compact filter diagnostics from the active Revit document.",
                new[] { "revit", "panels", "catalog", "distribution", "electrical-equipment", "panel-schedule-references", "panel-names" },
                requiresActiveDocument: true,
                requestExamples: [
                    RevitDataHostOperationExamples.Example(
                        "find a known panel",
                        "Resolve a panel name discovered from element context or circuit catalog before requesting panel schedule rows.",
                        """
                        { "filter": { "panelNames": ["C6P"] } }
                        """
                    ),
                    RevitDataHostOperationExamples.Example(
                        "find by mark",
                        "Use when equipment context exposes a panel mark rather than the display panel name.",
                        """
                        { "filter": { "marks": ["C6P"] } }
                        """
                    )
                ],
                callGuidance: [
                    "Use panel names/ids returned here as PanelReferences input to revit.detail.electrical-panel-schedules.",
                    "For per-equipment alignment, start with revit.detail.elements on exact equipment handles; this catalog is for resolving panel candidates, not proving element ownership. Inspect filterReport when a filtered lookup returns no entries."
                ]
            ),
            static (request, context, ct) => context.RevitData.GetElectricalPanelsCatalogAsync(request)
        );

    public static readonly BridgeOp ElectricalCircuitsCatalog =
        BridgeOp.Create<ElectricalCircuitsCatalogRequest, ElectricalCircuitsCatalogData>(
            "revit.catalog.electrical-circuits",
            "Get Electrical Circuits Catalog",
            HostOperationAgentMetadata.Create(
                "Read electrical circuit facts, connected load identity, panel names, circuit numbers, optional nearby proxy context, and compact filter diagnostics from the active Revit document.",
                new[] { "revit", "circuits", "catalog", "loads", "panel", "load-name", "connected-elements", "nearby-proxy", "equipment-alignment" },
                requiresActiveDocument: true,
                requestExamples: [
                    RevitDataHostOperationExamples.Example(
                        "filter by known panel/load/circuit",
                        "Use after exact element context identifies likely panel, load name, or circuit number candidates.",
                        """
                        { "filter": { "panelNames": ["C6P"], "loadNames": ["RV-13, DH-7 - Lower Level"], "circuitNumbers": ["1"] }, "options": { "parameterQuery": { "parameters": [{ "name": "Mark" }, { "name": "Panel" }, { "name": "Circuit Number" }, { "name": "Load Name" }] } } }
                        """
                    ),
                    RevitDataHostOperationExamples.Example(
                        "include nearby proxy context",
                        "Enable when exact connected elements are generic/proxy-like and need nearby identity candidates.",
                        """
                        { "filter": { "panelNames": ["C6P"] }, "options": { "includeNearbyProxyContext": true, "nearbyRadiusFeet": 3, "maxNearbyCandidatesPerElement": 5, "parameterQuery": { "parameters": [{ "name": "Mark" }, { "name": "Load Name" }] } } }
                        """
                    )
                ],
                callGuidance: [
                    "For per-equipment tag/load alignment, call revit.detail.elements on exact element handles first; use circuit catalog after you know panel/circuit/load candidates.",
                    "Use returned panel ids/names as PanelReferences input to revit.detail.electrical-panel-schedules when row/cell schedule detail is needed; inspect filterReport when candidate keys produce zero matches.",
                ]
            ),
            static (request, context, ct) => context.RevitData.GetElectricalCircuitsCatalogAsync(request)
        );

    public static readonly BridgeOp ElectricalPanelSchedulesQuery =
        BridgeOp.Create<ElectricalPanelSchedulesQueryRequest, ElectricalPanelSchedulesQueryData>(
            "revit.detail.electrical-panel-schedules",
            "Get Electrical Panel Schedules Query",
            HostOperationAgentMetadata.Create(
                "Read electrical panel schedule row/cell projections from the active Revit document. Use this for known panels/schedules, not as the first-choice element-to-load join.",
                new[] { "revit", "panel-schedules", "query", "schedules", "rows", "cells", "known-panel", "panel-references", "downstream-detail" },
                requiresActiveDocument: true,
                requestExamples: [
                    RevitDataHostOperationExamples.Example(
                        "row-filtered detail by known panel/load/circuit",
                        "Inspect only candidate panel schedule rows after element/circuit context identifies panel, circuit, or load-name values.",
                        """
                        { "query": { "kind": "PanelReferences", "panelNames": ["C6P"], "projection": { "view": "RowsOnly", "circuitNumbers": ["1"], "loadNameContains": ["RV-13, DH-7"], "maxRows": 10 } } }
                        """
                    ),
                    RevitDataHostOperationExamples.Example(
                        "current active panel schedule",
                        "Use when the active Revit view is already the panel schedule the user is asking about.",
                        """
                        { "query": { "kind": "CurrentActiveView" } }
                        """
                    )
                ],
                callGuidance: [
                    "Safe defaults or empty PanelReferences return no rows; first resolve panels through revit.detail.elements, revit.catalog.electrical-circuits, or revit.catalog.electrical-panels.",
                    "Use projection.view=RowsOnly with circuitNumbers, loadNameContains, and maxRows to avoid full panel schedule dumps."
                ]
            ),
            static (request, context, ct) => context.RevitData.GetElectricalPanelSchedulesQueryAsync(request)
        );

    public static readonly BridgeOp ElectricalLoadClassificationsCatalog =
        BridgeOp.Create<ElectricalLoadClassificationsCatalogRequest, ElectricalLoadClassificationsCatalogData>(
            "revit.catalog.electrical-load-classifications",
            "Get Electrical Load Classifications Catalog",
            HostOperationAgentMetadata.Create(
                "Read electrical load classification facts from the active Revit document.",
                new[] { "revit", "load-classifications", "catalog", "loads" },
                requiresActiveDocument: true
            ),
            static (request, context, ct) => context.RevitData.GetElectricalLoadClassificationsCatalogAsync(request)
        );

    public static readonly BridgeOp RevitDocumentSessionContext =
        BridgeOp.Create<NoRequest, RevitDocumentSessionContextData>(
            "revit.context.document-session",
            "Get Revit Document Session Context",
            HostOperationAgentMetadata.Create(
                "Read open, active, and selected document session context from connected Revit.",
                new[] { "document", "session", "active-document", "open-documents" }
            ),
            static (request, context, ct) => context.RevitData.GetRevitDocumentSessionContextAsync()
        );

    public static readonly BridgeOp RefreshParametersServiceCache =
        BridgeOp.Create<NoRequest, ParametersServiceCacheData>(
            "revit.apply.parameters-service-cache.refresh",
            "Refresh Parameters Service Cache",
            HostOperationAgentMetadata.Create(
                "Refresh the global APS Parameters Service cache through the connected Revit runtime.",
                new[] { "aps", "parameters", "cache", "refresh", "parameter-service" },
                intent: HostOperationIntent.Mutate,
                requiresActiveDocument: false,
                costTier: HostOperationCostTier.Mutation
            ),
            static (request, context, ct) => context.RevitData.RefreshParametersServiceCacheAsync()
        );

    public static readonly BridgeOp OpenRevitDocument =
        BridgeOp.Create<OpenRevitDocumentRequest, OpenRevitDocumentData>(
            "revit.apply.document.open",
            "Open Revit Document",
            HostOperationAgentMetadata.Create(
                "Open and activate a local or Autodesk cloud Revit document in the connected Revit session.",
                new[] { "document", "open", "activate", "cross-document", "cloud" },
                intent: HostOperationIntent.Mutate,
                requiresActiveDocument: false,
                costTier: HostOperationCostTier.Mutation,
                requestExamples: [
                    new HostOperationRequestExample(
                        "open local model",
                        "Open a local Revit project or family file by absolute path.",
                        """
                        { "path": "C:/Models/Project.rvt" }
                        """
                    ),
                    new HostOperationRequestExample(
                        "open cloud model",
                        "Open an Autodesk Docs / BIM 360 model by project + model GUID. Region defaults to US.",
                        """
                        { "cloudProjectGuid": "00000000-0000-0000-0000-000000000000", "cloudModelGuid": "00000000-0000-0000-0000-000000000000", "cloudRegion": "US" }
                        """
                    )
                ],
                callGuidance: [
                    "Pass a local RVT/RFA/RTE path, or cloudProjectGuid + cloudModelGuid (+ cloudRegion when not US); cloud opens need Autodesk sign-in and access.",
                    "Do not call while Revit is blocked by a modal dialog."
                ]
            ),
            static (request, context, ct) => context.RevitData.OpenRevitDocumentAsync(request)
        );

    public static readonly BridgeOp RevitAgentContextSummary =
        BridgeOp.Create<NoRequest, RevitAgentContextSummaryData>(
            "revit.context.summary",
            "Get Revit Agent Context Summary",
            HostOperationAgentMetadata.Create(
                "Read compact current document, active view or sheet, selection, browser counts, and visible-category context for Pea orientation.",
                new[] { "agent-context", "summary", "active-view", "selection", "visible", "browser" },
                requiresActiveDocument: true
            ),
            static (request, context, ct) => context.RevitData.GetRevitAgentContextSummaryAsync()
        );

    public static readonly BridgeOp RevitAgentContextResolve =
        BridgeOp.Create<RevitAgentContextResolveRequest, RevitAgentContextResolveData>(
            "revit.resolve.references",
            "Resolve Revit Agent Context Reference",
            HostOperationAgentMetadata.Create(
                "Resolve natural references like this view, selected equipment, or printed mech Level 1 plan into stable Revit handles with provenance; narrow by handle kind and printed context when the user already described the scope.",
                new[] { "agent-context", "resolve", "natural-reference", "handles", "provenance", "printed-context", "view-handles" },
                requiresActiveDocument: true,
                requestExamples: [
                    RevitDataHostOperationExamples.Example(
                        "printed lower-level mechanical views only",
                        "Use once for M201/M202-style scope, then reuse returned view/sheet handles for visible-summary or schedule-coverage.",
                        """
                        { "referenceText": "printed lower level mechanical equipment plans M201 M202", "handleKinds": ["View", "Sheet"], "requirePrintedContext": true, "maxPerHandleKind": 4, "maxResults": 8, "compact": true }
                        """
                    )
                ],
                callGuidance: [
                    "When the user asks about printed/current/lower-level scope, resolve once with handleKinds and requirePrintedContext instead of broad browser resolution.",
                    "Reuse returned handles for the rest of the turn; call revit.resolve.references again only if context changed or the result was ambiguous."
                ]
            ),
            static (request, context, ct) => context.RevitData.ResolveRevitAgentContextAsync(request)
        );

    public static readonly BridgeOp RevitAgentVisibleContext =
        BridgeOp.Create<RevitAgentVisibleContextRequest, RevitAgentVisibleContextData>(
            "revit.context.visible-summary",
            "Get Revit Agent Visible Context Summary",
            HostOperationAgentMetadata.Create(
                "Read compact category counts and bounded visible element handles for the active view or explicit view references.",
                new[] { "agent-context", "visible", "active-view", "view-references", "categories", "handles", "printed-views", "visible-equipment" },
                requiresActiveDocument: true,
                requestExamples: [
                    RevitDataHostOperationExamples.Example(
                        "active view mechanical equipment handles",
                        "Use when current/active view visible equipment is the audit scope and exact handles are needed for detail or matrix calls.",
                        """
                        { "scope": "ActiveViewVisible", "categoryNames": ["Mechanical Equipment"], "maxCategories": 5, "maxElementHandlesPerCategory": 250 }
                        """
                    ),
                    RevitDataHostOperationExamples.Example(
                        "resolved printed view references",
                        "Use view ids or unique ids returned by revit.resolve.references; sheet ids expand to their placed views.",
                        """
                        { "scope": "ViewReferences", "viewIds": [12345, 67890], "categoryNames": ["Mechanical Equipment"], "projection": "Handles", "maxViews": 10, "maxElementHandlesPerCategory": 500 }
                        """
                    )
                ],
                callGuidance: [
                    "For visible/current/printed equipment audits, resolve the view or sheet phrase once, then call this with ViewReferences and projection=Handles to get exact visible handles and visible-in-view provenance.",
                    "Feed returned element handles into revit.matrix.schedule-coverage with ExplicitHandles or revit.detail.elements for electrical/tag facts.",
                ]
            ),
            static (request, context, ct) => context.RevitData.GetRevitAgentVisibleContextAsync(request)
        );

    public static readonly BridgeOp RevitAgentViewRenderingState =
        BridgeOp.Create<RevitAgentViewRenderingStateRequest, RevitAgentViewRenderingStateData>(
            "revit.context.view-rendering-state",
            "Get Revit Agent View Rendering State",
            HostOperationAgentMetadata.Create(
                "Read a bounded evidence packet for visibility/rendering-affecting state in the active view or explicit views, including explicit limitations and uninspected causes.",
                new[] { "agent-context", "view-rendering", "visibility", "active-view", "view-references", "filters", "links", "worksets", "view-range", "crop", "template" },
                requiresActiveDocument: true,
                requestExamples: [
                    RevitDataHostOperationExamples.Example(
                        "active view rendering evidence",
                        "Use before diagnosing why something is hidden or why a view looks wrong; report limitations instead of claiming pixel-perfect visibility.",
                        """
                        { "scope": "ActiveView", "maxFiltersPerView": 60, "maxHiddenCategoriesPerView": 40, "maxLinksPerView": 25 }
                        """
                    ),
                    RevitDataHostOperationExamples.Example(
                        "resolved view comparison inputs",
                        "Use view ids or unique ids returned by revit.resolve.references when comparing likely visibility causes between named views.",
                        """
                        { "scope": "ViewReferences", "viewIds": [12345, 67890], "maxViews": 4 }
                        """
                    )
                ],
                callGuidance: [
                    "Treat this as evidence, not a final diagnosis: include confidenceWarnings, apiLimitations, and notInspected when answering.",
                    "Pair with revit.context.visible-summary or element detail calls when the user names a specific category or element."
                ]
            ),
            static (request, context, ct) => context.RevitData.GetRevitAgentViewRenderingStateAsync(request)
        );

    public static readonly BridgeOp ScriptWorkspaceBootstrap =
        BridgeOp.Create<ScriptWorkspaceBootstrapRequest, ScriptWorkspaceBootstrapData>(
            "scripting.workspace.bootstrap",
            "Bootstrap Script Workspace",
            HostOperationAgentMetadata.Create(
                "Create or update the host-owned C# Revit scripting workspace files.",
                new[] { "script", "workspace", "bootstrap", "files" },
                HostOperationIntent.Mutate
            ),
            static (request, context, ct) => context.Scripting.BootstrapWorkspaceAsync(request, ct)
        );

    public static readonly BridgeOp ExecuteRevitScript =
        BridgeOp.Create<ExecuteRevitScriptRequest, ExecuteRevitScriptData>(
            "scripting.execute",
            "Execute Revit Script",
            HostOperationAgentMetadata.Create(
                "Execute an inline or workspace-relative C# script in connected Revit. Inline content may be Execute-body statements with optional leading using directives or a full PeScriptContainer class; workspace files are normal C# PeScriptContainer entrypoints.",
                new[] { "script", "execute", "csharp", "revit" },
                HostOperationIntent.Mutate,
                requiresActiveDocument: true
            ),
            static (request, context, ct) => context.Scripting.ExecuteAsync(request, ct)
        );

    public static readonly BridgeOp ImportScriptPod =
        BridgeOp.Create<ScriptPodImportRequest, ScriptPodImportData>(
            "scripting.pod.import",
            "Import Script Pod",
            HostOperationAgentMetadata.Create(
                "Import a pod.json-backed Revit scripting workspace from a conservative zip archive into a new workspace slug.",
                new[] { "script", "pod", "import", "workspace", "zip", "archive" },
                HostOperationIntent.Mutate
            ),
            static (request, context, ct) => context.Scripting.ImportPodAsync(request, ct)
        );

    public static readonly BridgeOp ExportScriptPod =
        BridgeOp.Create<ScriptPodExportRequest, ScriptPodExportData>(
            "scripting.pod.export",
            "Export Script Pod",
            HostOperationAgentMetadata.Create(
                "Export a validated pod.json-backed Revit scripting workspace as a portable source-first zip archive.",
                new[] { "script", "pod", "export", "workspace", "zip", "archive" },
                HostOperationIntent.Mutate
            ),
            static (request, context, ct) => context.Scripting.ExportPodAsync(request, ct)
        );
}

public static class BridgeOpCatalog {
    public static readonly IReadOnlyList<BridgeOp> All = [
        RevitBridgeOps.SettingsSchema,
        RevitBridgeOps.FieldOptions,
        RevitBridgeOps.SettingsModuleCatalog,
        RevitBridgeOps.ParameterCatalog,
        RevitBridgeOps.LoadedFamiliesFilterFieldOptions,
        RevitBridgeOps.LoadedFamiliesFilterSchema,
        RevitBridgeOps.ScheduleCatalog,
        RevitBridgeOps.ProjectBrowser,
        RevitBridgeOps.ProjectIndex,
        RevitBridgeOps.SheetDetails,
        RevitBridgeOps.ScheduleProfilesQuery,
        RevitBridgeOps.ScheduleQuery,
        RevitBridgeOps.LoadedFamiliesCatalog,
        RevitBridgeOps.LoadedFamiliesMatrix,
        RevitBridgeOps.ScheduleCoverage,
        RevitBridgeOps.ParameterCoverage,
        RevitBridgeOps.ConceptEvidence,
        RevitBridgeOps.ParameterEvidence,
        RevitBridgeOps.ProjectParameterBindings,
        RevitBridgeOps.ElementContextQuery,
        RevitBridgeOps.ElectricalPanelsCatalog,
        RevitBridgeOps.ElectricalCircuitsCatalog,
        RevitBridgeOps.ElectricalPanelSchedulesQuery,
        RevitBridgeOps.ElectricalLoadClassificationsCatalog,
        RevitBridgeOps.RevitDocumentSessionContext,
        RevitBridgeOps.RefreshParametersServiceCache,
        RevitBridgeOps.OpenRevitDocument,
        RevitBridgeOps.RevitAgentContextSummary,
        RevitBridgeOps.RevitAgentContextResolve,
        RevitBridgeOps.RevitAgentVisibleContext,
        RevitBridgeOps.RevitAgentViewRenderingState,
        RevitBridgeOps.ScriptWorkspaceBootstrap,
        RevitBridgeOps.ExecuteRevitScript,
        RevitBridgeOps.ImportScriptPod,
        RevitBridgeOps.ExportScriptPod
    ];

    public static IReadOnlyDictionary<string, BridgeOp> ByKey { get; } =
        All.ToDictionary(op => op.Key, StringComparer.Ordinal);

    public static IReadOnlyList<HostOperationDefinition> Definitions { get; } =
        All.Select(op => op.Definition).ToArray();
}
