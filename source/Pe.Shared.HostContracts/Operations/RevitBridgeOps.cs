using Pe.Shared.HostContracts.Scripting;
using Pe.Shared.HostContracts.SettingsStorage;
using Pe.Shared.RevitData;
using Pe.Shared.RevitData.Schedules;

namespace Pe.Shared.HostContracts.Operations;

/// <summary>
///     Bridge operations as static <see cref="BridgeOp" /> fields — discovered by
///     <see cref="BridgeOpRegistry.RegisterFromLoadedPeAssemblies" /> at runtime. There is no
///     static catalog, no per-op contract class, no interface entry, and no codegen: a new op is
///     one field (or one [BridgeOperation] method for metadata-light cases) anywhere in a loaded
///     Pe.* assembly.
/// </summary>
public static class RevitBridgeOps {
    private static readonly IReadOnlyList<string> CatalogExpansionHints = [
        "Start with summary/handles plus maxEntries; only request full catalog facts after filters prove useful.",
        "Use catalog operations to discover stable ids/names before detail or matrix calls."
    ];

    private static readonly IReadOnlyList<string> MatrixExpansionHints = [
        "Matrix operations are expensive; constrain by category, family, schedule, parameter, visible scope, or explicit handles.",
        "Use budget.maxEntries and budget.maxSamplesPerEntry before requesting wider joins."
    ];

    private static readonly IReadOnlyList<string> ScheduleDetailExpansionHints = [
        "Resolve schedules through revit.catalog.schedules first, then pass ids, unique ids, or exact names under the query wrapper.",
        "Summary/handles omit row cell values; set projection.view=Rows or Full and includeCellValues=true only when rows are needed."
    ];

    private static HostOperationRequestExample Example(
        string name,
        string description,
        string json
    ) => new(name, description, json);

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
        BridgeOp.Create<LoadedFamiliesFilterFieldOptionsRequest, FieldOptionsData>(
            "revit.catalog.loaded-families.filter-field-options",
            "Get Loaded Families Filter Field Options",
            HostOperationAgentMetadata.Create(
                "Read document-specific option values for loaded-family query filters.",
                new[] { "loaded-families", "families", "filter", "field-options" },
                requiresActiveDocument: true
            ),
            static (request, context, ct) => context.Settings.GetLoadedFamiliesFilterFieldOptionsAsync(request)
        );

    public static readonly BridgeOp LoadedFamiliesFilterSchema =
        BridgeOp.Create<NoRequest, SchemaData>(
            "revit.catalog.loaded-families.filter-schema",
            "Get Loaded Families Filter Schema",
            HostOperationAgentMetadata.Create(
                "Read the filter schema for loaded-family catalog and matrix queries.",
                new[] { "loaded-families", "families", "filter", "schema" },
                requiresActiveDocument: true
            ),
            static (request, context, ct) => context.Settings.GetLoadedFamiliesFilterSchemaAsync()
        );

    public static readonly BridgeOp ScheduleCatalog =
        BridgeOp.Create<ScheduleCatalogRequest, ScheduleCatalogData>(
            "revit.catalog.schedules",
            "Get Schedule Catalog",
            HostOperationAgentMetadata.Create(
                "Read compact schedule handles, names, sheet placement, optional field metadata, and factual schedule evidence summaries from the active document. Revit-generated duplicate suffixes like '(2)' and 'Copy 1' are normalized out of name summary weighting. Do not use broad schedule catalog discovery for visible equipment coverage when revit.matrix.schedule-coverage can answer from view or element handles.",
                new[] { "schedules", "catalog", "fields", "columns", "parameters", "document", "sheet-placement", "printed-context" },
                requiresActiveDocument: true,
                requestExamples: [
                    Example(
                        "compact schedule catalog",
                        "Start with names, ids, sheet placement facts, and a small page.",
                        """
                        { "projection": { "view": "Summary" }, "budget": { "maxEntries": 25 } }
                        """
                    ),
                    Example(
                        "printed/sheet-filtered schedules",
                        "Find schedules placed on sheets matching user printed-context language.",
                        """
                        { "placementScope": "PlacedOnly", "sheetNumberContains": "M", "scheduleNameContains": "Equipment", "projection": { "view": "Handles", "includeSheetPlacements": true }, "budget": { "maxEntries": 25 } }
                        """
                    )
                ],
                callGuidance: [
                    "Start with summary/handles plus maxEntries; only request full catalog facts after filters prove useful.",
                    "For visible/current/printed equipment coverage, prefer revit.matrix.schedule-coverage with ViewReferences or ExplicitHandles; use this catalog only when schedule candidates themselves are unknown.",
                ]
            ),
            static (request, context, ct) => context.RevitData.GetScheduleCatalogAsync(request)
        );

    public static readonly BridgeOp ProjectBrowser =
        BridgeOp.Create<ProjectBrowserRequest, ProjectBrowserData>(
            "revit.catalog.project-browser",
            "Get Project Browser",
            HostOperationAgentMetadata.Create(
                "Read bounded Project Browser organization for views, sheets, and schedules as navigation/provenance metadata.",
                new[] { "project-browser", "browser", "views", "sheets", "schedules", "folders", "navigation", "provenance" },
                requiresActiveDocument: true,
                requestExamples: [
                    Example(
                        "compact browser summary",
                        "Start with folder/path vocabulary for views, sheets, and schedules without item membership.",
                        """
                        { "sections": ["Views", "Sheets", "Schedules"], "view": "Folders", "budget": { "maxSamplesPerEntry": 5 } }
                        """
                    ),
                    Example(
                        "exact folder items",
                        "Resolve items under a known browser path after inspecting folder vocabulary.",
                        """
                        { "sections": ["Schedules"], "view": "Items", "filter": { "section": "Schedules", "path": ["Mechanical", "Archive"], "matchMode": "Exact" }, "budget": { "maxEntries": 50 } }
                        """
                    )
                ],
                callGuidance: [
                    "Use Folders mode to inspect browser vocabulary before Items mode.",
                    "Browser organization is navigation/provenance for views, sheets, and schedules; use semantic catalog/detail ops for BIM facts."
                ]
            ),
            static (request, context, ct) => context.RevitData.GetProjectBrowserAsync(request)
        );

    public static readonly BridgeOp ProjectIndex =
        BridgeOp.Create<ProjectIndexRequest, ProjectIndexData>(
            "revit.catalog.project-index",
            "Get Project Index",
            HostOperationAgentMetadata.Create(
                "Read a compact semantic project index with bounded Project Browser provenance for levels, sheets, views, schedules, categories, and families.",
                new[] { "project-index", "project-browser", "browser-provenance", "levels", "sheets", "views", "schedules", "printed-context", "orientation" },
                requiresActiveDocument: true,
                requestExamples: [
                    Example(
                        "compact project index",
                        "Start with cheap orientation across levels, sheets, views, schedules, categories, and families.",
                        """
                        { "includeBrowserProvenance": true, "includeModelContext": true, "browserSections": ["Views", "Sheets", "Schedules"], "projection": { "view": "Summary" }, "budget": { "maxEntries": 25, "maxSamplesPerEntry": 5 } }
                        """
                    ),
                    Example(
                        "printed Level 1 equipment context",
                        "Resolve user language around levels, sheets, schedules, and equipment before deeper coverage/detail joins.",
                        """
                        { "searchText": "Level 1 equipment", "levelNames": ["Level 1"], "categoryNames": ["Mechanical Equipment"], "sections": ["Levels", "Sheets", "Schedules", "Families"], "browserSections": ["Sheets", "Schedules"], "includeBrowserProvenance": true, "projection": { "view": "Handles" }, "budget": { "maxEntries": 25, "maxSamplesPerEntry": 8 } }
                        """
                    )
                ],
                callGuidance: CatalogExpansionHints
            ),
            static (request, context, ct) => context.RevitData.GetProjectIndexAsync(request)
        );

    public static readonly BridgeOp SheetDetails =
        BridgeOp.Create<SheetDetailRequest, SheetDetailData>(
            "revit.detail.sheets",
            "Get Sheet Details",
            HostOperationAgentMetadata.Create(
                "Read minimal native sheet anchors for extractor and scripting workflows: sheet identity, placed views, placed schedules, title blocks, sheet-owned text, and provenance.",
                new[] { "sheets", "sheet-anchors", "printed-context", "viewports", "schedule-placement", "title-blocks", "text-notes", "extractor-boundary" },
                requiresActiveDocument: true,
                requestExamples: [
                    Example(
                        "active sheet anchors",
                        "Start with deterministic Revit anchors before exporting/parsing a sheet image or PDF.",
                        """
                        { "references": { "currentActiveSheet": true }, "projection": { "view": "Anchors", "includeTextNotes": true, "includeBoundingBoxes": true }, "budget": { "maxEntries": 1, "maxSamplesPerEntry": 80 } }
                        """
                    ),
                    Example(
                        "sheet text sources",
                        "Extract sheet-owned text with handles/provenance for script or external spellcheck workflows.",
                        """
                        { "references": { "sheetNumbers": ["M002"] }, "projection": { "view": "Text", "includeTextNotes": true }, "budget": { "maxEntries": 1, "maxSamplesPerEntry": 200 } }
                        """
                    )
                ],
                callGuidance: [
                    "Use this as a native anchor map for scripts and external extractors; do not treat it as OCR or model vision.",
                    "Start with active sheet or exact sheet numbers, then export/parse artifacts only when semantic anchors are insufficient."
                ]
            ),
            static (request, context, ct) => context.RevitData.GetSheetDetailsAsync(request)
        );

    public static readonly BridgeOp ScheduleProfilesQuery =
        BridgeOp.Create<ScheduleProfilesQueryRequest, ScheduleProfilesQueryData>(
            "revit.matrix.schedule-profiles",
            "Get Schedule Profiles Query",
            HostOperationAgentMetadata.Create(
                "Read schedule profile projections from the active document.",
                new[] { "schedules", "profiles", "query", "projection", "authored-schedule-shape" },
                requiresActiveDocument: true,
                requestExamples: [
                    Example(
                        "active schedule profile",
                        "Use when the active Revit view is the schedule to inspect.",
                        """
                        { "query": { "kind": "CurrentActiveView" } }
                        """
                    ),
                    Example(
                        "profiles by exact schedule names",
                        "Nested wrapper shape for named schedule profile queries.",
                        """
                        { "query": { "kind": "ScheduleNames", "scheduleNames": ["Mechanical Equipment Schedule"] } }
                        """
                    )
                ],
                callGuidance: MatrixExpansionHints
            ),
            static (request, context, ct) => context.RevitData.GetScheduleProfilesQueryAsync(request)
        );

    public static readonly BridgeOp ScheduleQuery =
        BridgeOp.Create<ScheduleQueryRequest, ScheduleQueryData>(
            "revit.detail.schedules",
            "Get Schedule Query",
            HostOperationAgentMetadata.Create(
                "Read schedule rows and field values from the active document.",
                new[] { "schedules", "query", "rows", "values", "detail" },
                requiresActiveDocument: true,
                requestExamples: [
                    Example(
                        "detail by schedule id, compact rows omitted",
                        "Correct nested wrapper shape for schedule detail summary/handles.",
                        """
                        { "query": { "kind": "ScheduleReferences", "scheduleIds": [12345], "projection": { "view": "Handles" }, "budget": { "maxEntries": 1, "maxRowsPerEntry": 0 } } }
                        """
                    ),
                    Example(
                        "audit required schedule fields",
                        "Return only rows with required-field issues and include cell values for those rows.",
                        """
                        { "query": { "kind": "ScheduleNames", "scheduleNames": ["Mechanical Equipment Schedule"], "projection": { "view": "Rows", "includeRows": true, "includeCellValues": true, "includeOnlyRowsWithIssues": true, "requiredFieldAudit": { "fieldNames": ["Mark", "Comments"], "treatDashAsBlank": true } }, "budget": { "maxEntries": 1, "maxRowsPerEntry": 25 } } }
                        """
                    )
                ],
                callGuidance: ScheduleDetailExpansionHints
            ),
            static (request, context, ct) => context.RevitData.GetScheduleQueryAsync(request)
        );

    public static readonly BridgeOp LoadedFamiliesCatalog =
        BridgeOp.Create<LoadedFamiliesCatalogRequest, LoadedFamiliesCatalogData>(
            "revit.catalog.loaded-families",
            "Get Loaded Families Catalog",
            HostOperationAgentMetadata.Create(
                "Read loaded family and type facts from the active document.",
                new[] { "loaded-families", "families", "types", "catalog" },
                requiresActiveDocument: true,
                requestExamples: [
                    Example(
                        "compact loaded-family catalog",
                        "Read a small page of loaded families with handles and counts.",
                        """
                        { "filter": { "placementScope": "PlacedOnly" }, "projection": { "view": "Summary" }, "budget": { "maxEntries": 25 } }
                        """
                    ),
                    Example(
                        "category/family filtered catalog",
                        "Constrain by user-facing plural family/category names before matrix calls.",
                        """
                        { "filter": { "categoryNames": ["Mechanical Equipment"], "familyNameContains": "VAV" }, "projection": { "view": "Handles" }, "budget": { "maxEntries": 25 } }
                        """
                    )
                ],
                callGuidance: CatalogExpansionHints
            ),
            static (request, context, ct) => context.RevitData.GetLoadedFamiliesCatalogAsync(request)
        );

    public static readonly BridgeOp LoadedFamiliesMatrix =
        BridgeOp.Create<LoadedFamiliesMatrixRequest, LoadedFamiliesMatrixData>(
            "revit.matrix.loaded-families",
            "Get Loaded Families Matrix",
            HostOperationAgentMetadata.Create(
                "Read a matrix of loaded family snapshots (canonical family records: types, parameters with per-type values/formulas/scope, schedule membership) from the active document.",
                new[] { "loaded-families", "families", "matrix", "projection", "parameter-scope", "family-snapshot" },
                requiresActiveDocument: true,
                requestExamples: [
                    Example(
                        "bounded loaded-family matrix",
                        "Escalate from catalog to matrix only with family/category filters and a budget. Response families are FamilySnapshotRecord: one parameters list where excluded entries carry excludedReason; per-type values in valuesPerType (null = no value).",
                        """
                        { "filter": { "categoryNames": ["Mechanical Equipment"], "familyNameContains": "VAV", "placementScope": "PlacedOnly" }, "budget": { "maxEntries": 10, "maxSamplesPerEntry": 20 } }
                        """
                    ),
                    Example(
                        "read-only matrix (no temp placement)",
                        "Skip the temp-placement pass when live instance values and schedule membership for unplaced types are not needed; never mutates the document.",
                        """
                        { "filter": { "categoryNames": ["Mechanical Equipment"] }, "includeTempPlacement": false, "budget": { "maxEntries": 10 } }
                        """
                    )
                ],
                callGuidance: MatrixExpansionHints
            ),
            static (request, context, ct) => context.RevitData.GetLoadedFamiliesMatrixAsync(request)
        );

    public static readonly BridgeOp ScheduleCoverage =
        BridgeOp.Create<ScheduleCoverageRequest, ScheduleCoverageData>(
            "revit.matrix.schedule-coverage",
            "Get Schedule Coverage Matrix",
            HostOperationAgentMetadata.Create(
                "Read bounded element-to-schedule coverage counts and samples from the active document, including active-view-visible or explicit-handle scopes.",
                new[] { "schedules", "coverage", "matrix", "elements", "handles", "active-view-visible", "explicit-handles", "visible-equipment", "printed-context" },
                requiresActiveDocument: true,
                requestExamples: [
                    Example(
                        "resolved printed view equipment coverage",
                        "Check whether mechanical equipment visible in resolved printed views appears in issued/working equipment schedules without a separate visible-summary call.",
                        """
                        { "scope": "ViewReferences", "viewIds": [12345, 67890], "categoryNames": ["Mechanical Equipment"], "scheduleRoleScope": "IssuedOrWorking", "scheduleFilter": { "scheduleNameContains": "Equipment", "placementScope": "PlacedOnly", "projection": { "view": "Handles", "includeSheetPlacements": true }, "budget": { "maxEntries": 25 } }, "includeMissingElementHandles": true, "includeMatchedScheduleNames": true, "budget": { "maxEntries": 250, "maxSamplesPerEntry": 0 } }
                        """
                    ),
                    Example(
                        "explicit handles from visible/detail context",
                        "Use handles returned by visible-summary, detail.elements, or a narrow script when the audit scope is exact.",
                        """
                        { "scope": "ExplicitHandles", "elementIds": [12345, 67890], "categoryNames": ["Mechanical Equipment"], "scheduleRoleScope": "IssuedOrWorking", "scheduleFilter": { "scheduleNameContains": "Equipment", "projection": { "view": "Handles", "includeSheetPlacements": true }, "budget": { "maxEntries": 25 } }, "includeMissingElementHandles": true, "includeMatchedScheduleNames": true, "budget": { "maxEntries": 250, "maxSamplesPerEntry": 0 } }
                        """
                    )
                ],
                callGuidance: [
                    "Resolve the target view/sheet phrase first with revit.context.summary or one narrowed revit.resolve.references call; use ViewReferences, ActiveViewVisible, or ExplicitHandles only when that scope is intended.",
                    "For audit summaries, request includeMissingElementHandles, includeMatchedScheduleNames, and read roleSummaries before asking for per-element samples."
                ]
            ),
            static (request, context, ct) => context.RevitData.GetScheduleCoverageAsync(request)
        );

    public static readonly BridgeOp ParameterCoverage =
        BridgeOp.Create<ParameterCoverageRequest, ParameterCoverageData>(
            "revit.matrix.parameter-coverage",
            "Get Parameter Coverage Matrix",
            HostOperationAgentMetadata.Create(
                "Read bounded parameter presence, blank/default counts, and sample handles from the active document.",
                new[] { "parameters", "coverage", "matrix", "elements", "handles" },
                requiresActiveDocument: true,
                requestExamples: [
                    Example(
                        "bounded parameter coverage",
                        "Check parameter presence/blank/default counts for a category or selection.",
                        """
                        { "categoryNames": ["Mechanical Equipment"], "scope": "ActiveViewVisible", "parameters": [{ "name": "Mark" }, { "name": "Comments" }], "defaultValues": ["0", "-"], "budget": { "maxEntries": 25, "maxSamplesPerEntry": 5 } }
                        """
                    )
                ],
                callGuidance: MatrixExpansionHints
            ),
            static (request, context, ct) => context.RevitData.GetParameterCoverageAsync(request)
        );

    public static readonly BridgeOp ConceptEvidence =
        BridgeOp.Create<ConceptEvidenceRequest, ConceptEvidenceData>(
            "revit.catalog.concept-evidence",
            "Get Concept Evidence",
            HostOperationAgentMetadata.Create(
                "Infer project-specific parameter candidates for operator concepts from factual binding and schedule evidence. Category and subject hints are weak context, not expected-shape rules; use returned reasons and facts before detail or coverage calls.",
                new[] { "concepts", "parameter-evidence", "project-standards", "bindings", "schedule-fields", "discovery" },
                requiresActiveDocument: true,
                requestExamples: [
                    Example(
                        "equipment coordination concepts",
                        "Infer project-specific fields for ordinary coordination language without exact parameter names.",
                        """
                        { "query": "equipment electrical load circuit panel location", "subjectHints": ["Mechanical Equipment", "Plumbing Equipment"], "budget": { "maxEntries": 5, "maxSamplesPerEntry": 3 } }
                        """
                    )
                ],
                callGuidance: [
                    "Use concept evidence before parameter evidence when the user asks in ordinary project language rather than known parameter identity language.",
                    "Treat subject hints as weak scoping context; do not assume a category or expected schedule shape is authoritative without supporting schedule/binding facts.",
                ]
            ),
            static (request, context, ct) => context.RevitData.GetConceptEvidenceAsync(request)
        );

    public static readonly BridgeOp ParameterEvidence =
        BridgeOp.Create<ParameterEvidenceRequest, ParameterEvidenceData>(
            "revit.catalog.parameter-evidence",
            "Get Parameter Evidence",
            HostOperationAgentMetadata.Create(
                "Return factual parameter evidence from project bindings, schedule fields/filters, and scoped element presence. Use this when project-standard parameter names are uncertain; inspect binding categories, schedule usage, counts, and samples, then pass observed parameter identities or named references into detail or matrix calls.",
                new[] { "parameters", "evidence", "project-bindings", "schedule-fields", "categories", "parameter-usage" },
                requiresActiveDocument: true,
                requestExamples: [
                    Example(
                        "bounded parameter evidence for visible equipment",
                        "Collect factual binding, schedule, and scoped-element evidence for candidate parameter references.",
                        """
                        { "categoryNames": ["Mechanical Equipment"], "scope": "ActiveViewVisible", "candidateParameters": [{ "name": "Mark" }, { "name": "Equipment Tag" }], "budget": { "maxEntries": 10, "maxSamplesPerEntry": 2 } }
                        """
                    ),
                    Example(
                        "rank schedule join fields",
                        "Use schedule field/filter evidence when the printed schedule context is known.",
                        """
                        { "rankingMode": "ScheduleJoin", "categoryNames": ["Mechanical Equipment"], "scheduleNames": ["Equipment Schedule"], "budget": { "maxEntries": 10, "maxSamplesPerEntry": 2 } }
                        """
                    )
                ],
                callGuidance: [
                    "Use parameter evidence before detail/coverage when the project-standard parameter name is uncertain.",
                    "Keep candidateParameters when you already have observed identities, shared GUIDs, or plausible names; omit them only for bounded category/schedule scopes.",
                ]
            ),
            static (request, context, ct) => context.RevitData.GetParameterEvidenceAsync(request)
        );

    public static readonly BridgeOp ProjectParameterBindings =
        BridgeOp.Create<ProjectParameterBindingsRequest, ProjectParameterBindingsData>(
            "revit.catalog.parameter-bindings",
            "Get Project Parameter Bindings",
            HostOperationAgentMetadata.Create(
                "Read project parameter bindings from the active document, using the same canonical parameter identity and shared-GUID string language returned by parameter evidence and coverage operations.",
                new[] { "parameters", "project-parameters", "bindings", "document", "catalog", "parameter-identity", "shared-guid" },
                requiresActiveDocument: true,
                requestExamples: [
                    Example(
                        "compact project parameter bindings",
                        "Read a small project-binding catalog page.",
                        """
                        { "projection": { "view": "Summary" }, "budget": { "maxEntries": 50 } }
                        """
                    ),
                    Example(
                        "filtered project parameter bindings",
                        "Constrain binding catalog by category, parameter reference, substring, and binding level.",
                        """
                        { "bindingFilter": { "categoryNames": ["Mechanical Equipment"], "parameters": [{ "sharedGuid": "11111111-2222-3333-4444-555555555555" }], "parameterNameContains": "Asset", "bindingKind": "Instance" }, "budget": { "maxEntries": 25 } }
                        """
                    )
                ],
                callGuidance: [
                    "Use catalog operations to discover stable ids/names before detail or matrix calls.",
                    "Use parameters with observed ParameterIdentity values when joining from concept/parameter evidence into binding lookup.",
                ]
            ),
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
                    Example(
                        "visible equipment electrical context",
                        "Use element ids returned by revit.context.visible-summary ViewReferences/ActiveViewVisible to inspect exact visible equipment before broad electrical catalog queries.",
                        """
                        { "query": { "kind": "ElementReferences", "elementIds": [12345, 67890], "parameterQuery": { "parameters": [{ "name": "Mark" }, { "name": "Panel" }, { "name": "Circuit Number" }, { "name": "Load Name" }] } } }
                        """
                    ),
                    Example(
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
                    Example(
                        "find a known panel",
                        "Resolve a panel name discovered from element context or circuit catalog before requesting panel schedule rows.",
                        """
                        { "filter": { "panelNames": ["C6P"] } }
                        """
                    ),
                    Example(
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
                    Example(
                        "filter by known panel/load/circuit",
                        "Use after exact element context identifies likely panel, load name, or circuit number candidates.",
                        """
                        { "filter": { "panelNames": ["C6P"], "loadNames": ["RV-13, DH-7 - Lower Level"], "circuitNumbers": ["1"] }, "options": { "parameterQuery": { "parameters": [{ "name": "Mark" }, { "name": "Panel" }, { "name": "Circuit Number" }, { "name": "Load Name" }] } } }
                        """
                    ),
                    Example(
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
                    Example(
                        "row-filtered detail by known panel/load/circuit",
                        "Inspect only candidate panel schedule rows after element/circuit context identifies panel, circuit, or load-name values.",
                        """
                        { "query": { "kind": "PanelReferences", "panelNames": ["C6P"], "projection": { "view": "RowsOnly", "circuitNumbers": ["1"], "loadNameContains": ["RV-13, DH-7"], "maxRows": 10 } } }
                        """
                    ),
                    Example(
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
                    Example(
                        "open local model",
                        "Open a local Revit project or family file by absolute path.",
                        """
                        { "path": "C:/Models/Project.rvt" }
                        """
                    ),
                    Example(
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
                    Example(
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
                    Example(
                        "active view mechanical equipment handles",
                        "Use when current/active view visible equipment is the audit scope and exact handles are needed for detail or matrix calls.",
                        """
                        { "scope": "ActiveViewVisible", "categoryNames": ["Mechanical Equipment"], "maxCategories": 5, "maxElementHandlesPerCategory": 250 }
                        """
                    ),
                    Example(
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
                    Example(
                        "active view rendering evidence",
                        "Use before diagnosing why something is hidden or why a view looks wrong; report limitations instead of claiming pixel-perfect visibility.",
                        """
                        { "scope": "ActiveView", "maxFiltersPerView": 60, "maxHiddenCategoriesPerView": 40, "maxLinksPerView": 25 }
                        """
                    ),
                    Example(
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
