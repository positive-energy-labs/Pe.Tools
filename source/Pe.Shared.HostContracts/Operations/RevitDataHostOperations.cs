using Pe.Shared.HostContracts.SettingsStorage;
using Pe.Shared.RevitData;
using Pe.Shared.RevitData.Schedules;

namespace Pe.Shared.HostContracts.Operations;

internal static class RevitDataHostOperationExamples {
    public static readonly IReadOnlyList<string> CatalogExpansionHints = [
        "Start with summary/handles plus maxEntries; only request full catalog facts after filters prove useful.",
        "Use catalog operations to discover stable ids/names before detail or matrix calls."
    ];

    public static readonly IReadOnlyList<string> MatrixExpansionHints = [
        "Matrix operations are expensive; constrain by category, family, schedule, parameter, visible scope, or explicit handles.",
        "Use budget.maxEntries and budget.maxSamplesPerEntry before requesting wider joins."
    ];

    public static readonly IReadOnlyList<string> ScheduleDetailExpansionHints = [
        "Resolve schedules through revit.catalog.schedules first, then pass ids, unique ids, or exact names under the query wrapper.",
        "Summary/handles omit row cell values; set projection.view=Rows or Full and includeCellValues=true only when rows are needed."
    ];

    public static HostOperationRequestExample Example(
        string name,
        string description,
        string json
    ) => new(name, description, json);
}

public static class GetLoadedFamiliesFilterSchemaOperationContract {
    public static readonly HostOperationDefinition Definition =
        HostOperationDefinition.Create<NoRequest, SchemaData>(
            "revit.catalog.loaded-families.filter-schema",
            HostHttpVerb.Get,
            "/api/revit/catalog/loaded-families/filter/schema",
            HostExecutionMode.Bridge,
            "Get Loaded Families Filter Schema",
            HostOperationAgentMetadata.Create(
                "revit",
                "Read the filter schema for loaded-family catalog and matrix queries.",
                new[] { "loaded-families", "families", "filter", "schema" },
                requiresBridge: true,
                requiresActiveDocument: true
            )
        );
}

public static class GetLoadedFamiliesFilterFieldOptionsOperationContract {
    public static readonly HostOperationDefinition Definition =
        HostOperationDefinition.Create<LoadedFamiliesFilterFieldOptionsRequest, FieldOptionsData>(
            "revit.catalog.loaded-families.filter-field-options",
            HostHttpVerb.Post,
            "/api/revit/catalog/loaded-families/filter/field-options",
            HostExecutionMode.Bridge,
            "Get Loaded Families Filter Field Options",
            HostOperationAgentMetadata.Create(
                "revit",
                "Read document-specific option values for loaded-family query filters.",
                new[] { "loaded-families", "families", "filter", "field-options" },
                requiresBridge: true,
                requiresActiveDocument: true
            )
        );
}

public static class GetScheduleCatalogOperationContract {
    public static readonly HostOperationDefinition Definition =
        HostOperationDefinition.Create<ScheduleCatalogRequest, ScheduleCatalogData>(
            "revit.catalog.schedules",
            HostHttpVerb.Post,
            "/api/revit/catalog/schedules",
            HostExecutionMode.Bridge,
            "Get Schedule Catalog",
            HostOperationAgentMetadata.Create(
                "revit",
                "Read schedule definitions and field facts from the active document. Do not use broad schedule catalog discovery for visible equipment coverage when revit.matrix.schedule-coverage can answer from view or element handles.",
                new[] { "schedules", "catalog", "fields", "document", "sheet-placement", "printed-context" },
                requiresBridge: true,
                requiresActiveDocument: true,
                requestExamples: [
                    RevitDataHostOperationExamples.Example(
                        "compact schedule catalog",
                        "Start with names, ids, sheet placement facts, and a small page.",
                        """
                        { "projection": { "view": "Summary" }, "budget": { "maxEntries": 25 } }
                        """
                    ),
                    RevitDataHostOperationExamples.Example(
                        "printed/sheet-filtered schedules",
                        "Find schedules placed on sheets matching user printed-context language.",
                        """
                        { "placementScope": "PlacedOnly", "sheetNumberContains": "M", "scheduleNameContains": "Equipment", "projection": { "view": "Handles", "includeSheetPlacements": true }, "budget": { "maxEntries": 25 } }
                        """
                    )
                ],
                boundedExpansionHints: [
                    .. RevitDataHostOperationExamples.CatalogExpansionHints,
                    "For visible/current/printed equipment coverage, prefer revit.matrix.schedule-coverage with ViewReferences or ExplicitHandles; use this catalog only when schedule candidates themselves are unknown."
                ],
                handleProvenanceNotes: "Schedule handles include ids/unique ids plus sheet-placement facts when requested."
            )
        );
}


public static class GetProjectBrowserOperationContract {
    public static readonly HostOperationDefinition Definition =
        HostOperationDefinition.Create<ProjectBrowserRequest, ProjectBrowserData>(
            "revit.catalog.project-browser",
            HostHttpVerb.Post,
            "/api/revit/catalog/project-browser",
            HostExecutionMode.Bridge,
            "Get Project Browser",
            HostOperationAgentMetadata.Create(
                "revit",
                "Read bounded Project Browser organization for views, sheets, and schedules as navigation/provenance metadata.",
                new[] { "project-browser", "browser", "views", "sheets", "schedules", "folders", "navigation", "provenance" },
                requiresBridge: true,
                requiresActiveDocument: true,
                requestExamples: [
                    RevitDataHostOperationExamples.Example(
                        "compact browser summary",
                        "Start with folder/path vocabulary for views, sheets, and schedules without item membership.",
                        """
                        { "sections": ["Views", "Sheets", "Schedules"], "view": "Folders", "budget": { "maxSamplesPerEntry": 5 } }
                        """
                    ),
                    RevitDataHostOperationExamples.Example(
                        "exact folder items",
                        "Resolve items under a known browser path after inspecting folder vocabulary.",
                        """
                        { "sections": ["Schedules"], "view": "Items", "filter": { "section": "Schedules", "path": ["Mechanical", "Archive"], "matchMode": "Exact" }, "budget": { "maxEntries": 50 } }
                        """
                    )
                ],
                boundedExpansionHints: [
                    "Use Folders mode to inspect browser vocabulary before Items mode.",
                    "Browser organization is navigation/provenance for views, sheets, and schedules; use semantic catalog/detail ops for BIM facts."
                ],
                handleProvenanceNotes: "Browser items return stable view/sheet/schedule handles plus browser path provenance; invalid paths return nearest-match diagnostics."
            )
        );
}

public static class GetSheetDetailsOperationContract {
    public static readonly HostOperationDefinition Definition =
        HostOperationDefinition.Create<SheetDetailRequest, SheetDetailData>(
            "revit.detail.sheets",
            HostHttpVerb.Post,
            "/api/revit/detail/sheets",
            HostExecutionMode.Bridge,
            "Get Sheet Details",
            HostOperationAgentMetadata.Create(
                "revit",
                "Read minimal native sheet anchors for extractor and scripting workflows: sheet identity, placed views, placed schedules, title blocks, sheet-owned text, and provenance.",
                new[] { "sheets", "sheet-anchors", "printed-context", "viewports", "schedule-placement", "title-blocks", "text-notes", "extractor-boundary" },
                requiresBridge: true,
                requiresActiveDocument: true,
                requestExamples: [
                    RevitDataHostOperationExamples.Example(
                        "active sheet anchors",
                        "Start with deterministic Revit anchors before exporting/parsing a sheet image or PDF.",
                        """
                        { "references": { "currentActiveSheet": true }, "projection": { "view": "Anchors", "includeTextNotes": true, "includeBoundingBoxes": true }, "budget": { "maxEntries": 1, "maxSamplesPerEntry": 80 } }
                        """
                    ),
                    RevitDataHostOperationExamples.Example(
                        "sheet text sources",
                        "Extract sheet-owned text with handles/provenance for script or external spellcheck workflows.",
                        """
                        { "references": { "sheetNumbers": ["M002"] }, "projection": { "view": "Text", "includeTextNotes": true }, "budget": { "maxEntries": 1, "maxSamplesPerEntry": 200 } }
                        """
                    )
                ],
                boundedExpansionHints: [
                    "Use this as a native anchor map for scripts and external extractors; do not treat it as OCR or model vision.",
                    "Start with active sheet or exact sheet numbers, then export/parse artifacts only when semantic anchors are insufficient."
                ],
                handleProvenanceNotes: "Sheet anchors preserve Revit handles for sheets, title blocks, viewports, placed schedules, and text notes so parser/vision findings can be correlated back to Revit."
            )
        );
}

public static class GetProjectIndexOperationContract {
    public static readonly HostOperationDefinition Definition =
        HostOperationDefinition.Create<ProjectIndexRequest, ProjectIndexData>(
            "revit.catalog.project-index",
            HostHttpVerb.Post,
            "/api/revit/catalog/project-index",
            HostExecutionMode.Bridge,
            "Get Project Index",
            HostOperationAgentMetadata.Create(
                "revit",
                "Read a compact semantic project index with bounded Project Browser provenance for levels, sheets, views, schedules, categories, and families.",
                new[] { "project-index", "project-browser", "browser-provenance", "levels", "sheets", "views", "schedules", "printed-context", "orientation" },
                requiresBridge: true,
                requiresActiveDocument: true,
                requestExamples: [
                    RevitDataHostOperationExamples.Example(
                        "compact project index",
                        "Start with cheap orientation across levels, sheets, views, schedules, categories, and families.",
                        """
                        { "includeBrowserProvenance": true, "includeModelContext": true, "browserSections": ["Views", "Sheets", "Schedules"], "projection": { "view": "Summary" }, "budget": { "maxEntries": 25, "maxSamplesPerEntry": 5 } }
                        """
                    ),
                    RevitDataHostOperationExamples.Example(
                        "printed Level 1 equipment context",
                        "Resolve user language around levels, sheets, schedules, and equipment before deeper coverage/detail joins.",
                        """
                        { "searchText": "Level 1 equipment", "levelNames": ["Level 1"], "categoryNames": ["Mechanical Equipment"], "sections": ["Levels", "Sheets", "Schedules", "Families"], "browserSections": ["Sheets", "Schedules"], "includeBrowserProvenance": true, "projection": { "view": "Handles" }, "budget": { "maxEntries": 25, "maxSamplesPerEntry": 8 } }
                        """
                    )
                ],
                boundedExpansionHints: RevitDataHostOperationExamples.CatalogExpansionHints,
                handleProvenanceNotes: "Project index entries return stable handles plus sheet/printed/browser provenance for planning deeper Revit calls."
            )
        );
}

public static class GetScheduleProfilesQueryOperationContract {
    public static readonly HostOperationDefinition Definition =
        HostOperationDefinition.Create<ScheduleProfilesQueryRequest, ScheduleProfilesQueryData>(
            "revit.matrix.schedule-profiles",
            HostHttpVerb.Post,
            "/api/revit/matrix/schedule-profiles",
            HostExecutionMode.Bridge,
            "Get Schedule Profiles Query",
            HostOperationAgentMetadata.Create(
                "revit",
                "Read schedule profile projections from the active document.",
                new[] { "schedules", "profiles", "query", "projection" },
                requiresBridge: true,
                requiresActiveDocument: true,
                requestExamples: [
                    RevitDataHostOperationExamples.Example(
                        "active schedule profile",
                        "Use when the active Revit view is the schedule to inspect.",
                        """
                        { "query": { "kind": "CurrentActiveView" } }
                        """
                    ),
                    RevitDataHostOperationExamples.Example(
                        "profiles by exact schedule names",
                        "Nested wrapper shape for named schedule profile queries.",
                        """
                        { "query": { "kind": "ScheduleNames", "scheduleNames": ["Mechanical Equipment Schedule"] } }
                        """
                    )
                ],
                boundedExpansionHints: RevitDataHostOperationExamples.MatrixExpansionHints,
                handleProvenanceNotes: "Use revit.catalog.schedules first when the exact schedule name or id is unknown."
            )
        );
}

public static class GetScheduleQueryOperationContract {
    public static readonly HostOperationDefinition Definition =
        HostOperationDefinition.Create<ScheduleQueryRequest, ScheduleQueryData>(
            "revit.detail.schedules",
            HostHttpVerb.Post,
            "/api/revit/detail/schedules",
            HostExecutionMode.Bridge,
            "Get Schedule Query",
            HostOperationAgentMetadata.Create(
                "revit",
                "Read schedule rows and field values from the active document.",
                new[] { "schedules", "query", "rows", "values", "detail" },
                requiresBridge: true,
                requiresActiveDocument: true,
                requestExamples: [
                    RevitDataHostOperationExamples.Example(
                        "detail by schedule id, compact rows omitted",
                        "Correct nested wrapper shape for schedule detail summary/handles.",
                        """
                        { "query": { "kind": "ScheduleReferences", "scheduleIds": [12345], "projection": { "view": "Handles" }, "budget": { "maxEntries": 1, "maxRowsPerEntry": 0 } } }
                        """
                    ),
                    RevitDataHostOperationExamples.Example(
                        "audit required schedule fields",
                        "Return only rows with required-field issues and include cell values for those rows.",
                        """
                        { "query": { "kind": "ScheduleNames", "scheduleNames": ["Mechanical Equipment Schedule"], "projection": { "view": "Rows", "includeRows": true, "includeCellValues": true, "includeOnlyRowsWithIssues": true, "requiredFieldAudit": { "fieldNames": ["Mark", "Comments"], "treatDashAsBlank": true } }, "budget": { "maxEntries": 1, "maxRowsPerEntry": 25 } } }
                        """
                    )
                ],
                boundedExpansionHints: RevitDataHostOperationExamples.ScheduleDetailExpansionHints,
                handleProvenanceNotes: "Schedule rows can include subject element handles when projection requests handles/subjects."
            )
        );
}

public static class GetLoadedFamiliesCatalogOperationContract {
    public static readonly HostOperationDefinition Definition =
        HostOperationDefinition.Create<LoadedFamiliesCatalogRequest, LoadedFamiliesCatalogData>(
            "revit.catalog.loaded-families",
            HostHttpVerb.Post,
            "/api/revit/catalog/loaded-families",
            HostExecutionMode.Bridge,
            "Get Loaded Families Catalog",
            HostOperationAgentMetadata.Create(
                "revit",
                "Read loaded family and type facts from the active document.",
                new[] { "loaded-families", "families", "types", "catalog" },
                requiresBridge: true,
                requiresActiveDocument: true,
                requestExamples: [
                    RevitDataHostOperationExamples.Example(
                        "compact loaded-family catalog",
                        "Read a small page of loaded families with handles and counts.",
                        """
                        { "filter": { "placementScope": "PlacedOnly" }, "projection": { "view": "Summary" }, "budget": { "maxEntries": 25 } }
                        """
                    ),
                    RevitDataHostOperationExamples.Example(
                        "category/family filtered catalog",
                        "Constrain by user-facing plural family/category names before matrix calls.",
                        """
                        { "filter": { "categoryNames": ["Mechanical Equipment"], "familyNameContains": "VAV" }, "projection": { "view": "Handles" }, "budget": { "maxEntries": 25 } }
                        """
                    )
                ],
                boundedExpansionHints: RevitDataHostOperationExamples.CatalogExpansionHints,
                handleProvenanceNotes: "Loaded-family catalog rows include family ids, unique ids, category, type counts, and placement counts."
            )
        );
}

public static class GetLoadedFamiliesMatrixOperationContract {
    public static readonly HostOperationDefinition Definition =
        HostOperationDefinition.Create<LoadedFamiliesMatrixRequest, LoadedFamiliesMatrixData>(
            "revit.matrix.loaded-families",
            HostHttpVerb.Post,
            "/api/revit/matrix/loaded-families",
            HostExecutionMode.Bridge,
            "Get Loaded Families Matrix",
            HostOperationAgentMetadata.Create(
                "revit",
                "Read a matrix projection of loaded family/type facts from the active document.",
                new[] { "loaded-families", "families", "matrix", "projection", "parameter-presence" },
                requiresBridge: true,
                requiresActiveDocument: true,
                requestExamples: [
                    RevitDataHostOperationExamples.Example(
                        "bounded loaded-family matrix",
                        "Escalate from catalog to matrix only with family/category filters and a budget.",
                        """
                        { "filter": { "categoryNames": ["Mechanical Equipment"], "familyNameContains": "VAV", "placementScope": "PlacedOnly" }, "budget": { "maxEntries": 10, "maxSamplesPerEntry": 20 } }
                        """
                    )
                ],
                boundedExpansionHints: RevitDataHostOperationExamples.MatrixExpansionHints,
                handleProvenanceNotes: "Matrix rows use parameter presence terminology and canonical parameter identities."
            )
        );
}


public static class GetScheduleCoverageOperationContract {
    public static readonly HostOperationDefinition Definition =
        HostOperationDefinition.Create<ScheduleCoverageRequest, ScheduleCoverageData>(
            "revit.matrix.schedule-coverage",
            HostHttpVerb.Post,
            "/api/revit/matrix/schedule-coverage",
            HostExecutionMode.Bridge,
            "Get Schedule Coverage Matrix",
            HostOperationAgentMetadata.Create(
                "revit",
                "Read bounded element-to-schedule coverage counts and samples from the active document, including active-view-visible or explicit-handle scopes.",
                new[] { "schedules", "coverage", "matrix", "elements", "handles", "active-view-visible", "explicit-handles", "visible-equipment", "printed-context" },
                requiresBridge: true,
                requiresActiveDocument: true,
                requestExamples: [
                    RevitDataHostOperationExamples.Example(
                        "resolved printed view equipment coverage",
                        "Check whether mechanical equipment visible in resolved printed views appears in issued/working equipment schedules without a separate visible-summary call.",
                        """
                        { "scope": "ViewReferences", "viewIds": [12345, 67890], "categoryNames": ["Mechanical Equipment"], "scheduleRoleScope": "IssuedOrWorking", "scheduleFilter": { "scheduleNameContains": "Equipment", "placementScope": "PlacedOnly", "projection": { "view": "Handles", "includeSheetPlacements": true }, "budget": { "maxEntries": 25 } }, "includeMissingElementHandles": true, "includeMatchedScheduleNames": true, "budget": { "maxEntries": 250, "maxSamplesPerEntry": 0 } }
                        """
                    ),
                    RevitDataHostOperationExamples.Example(
                        "explicit handles from visible/detail context",
                        "Use handles returned by visible-summary, detail.elements, or a narrow script when the audit scope is exact.",
                        """
                        { "scope": "ExplicitHandles", "elementIds": [12345, 67890], "categoryNames": ["Mechanical Equipment"], "scheduleRoleScope": "IssuedOrWorking", "scheduleFilter": { "scheduleNameContains": "Equipment", "projection": { "view": "Handles", "includeSheetPlacements": true }, "budget": { "maxEntries": 25 } }, "includeMissingElementHandles": true, "includeMatchedScheduleNames": true, "budget": { "maxEntries": 250, "maxSamplesPerEntry": 0 } }
                        """
                    )
                ],
                boundedExpansionHints: [
                    .. RevitDataHostOperationExamples.MatrixExpansionHints,
                    "Resolve the target view/sheet phrase first with revit.context.summary or one narrowed revit.resolve.references call; use ViewReferences or ActiveViewVisible only when that view scope is intended.",
                    "Use ExplicitHandles for handles returned by revit.context.visible-summary, revit.detail.elements, or a script instead of broad model-wide coverage.",
                    "For audit summaries, request includeMissingElementHandles, includeMatchedScheduleNames, and read roleSummaries before asking for per-element samples.",
                    "Do not treat Working or audit-schedule coverage as proof of intended issued/mechanical schedule representation; report the role summary explicitly."
                ],
                handleProvenanceNotes: "Coverage samples return stable element handles plus matching schedule handles. Treat coverage as definitive only when schedule subject binding succeeds; issues explain row-binding limitations."
            )
        );
}

public static class GetParameterCoverageOperationContract {
    public static readonly HostOperationDefinition Definition =
        HostOperationDefinition.Create<ParameterCoverageRequest, ParameterCoverageData>(
            "revit.matrix.parameter-coverage",
            HostHttpVerb.Post,
            "/api/revit/matrix/parameter-coverage",
            HostExecutionMode.Bridge,
            "Get Parameter Coverage Matrix",
            HostOperationAgentMetadata.Create(
                "revit",
                "Read bounded parameter presence, blank/default counts, and sample handles from the active document.",
                new[] { "parameters", "coverage", "matrix", "elements", "handles" },
                requiresBridge: true,
                requiresActiveDocument: true,
                requestExamples: [
                    RevitDataHostOperationExamples.Example(
                        "bounded parameter coverage",
                        "Check parameter presence/blank/default counts for a category or selection.",
                        """
                        { "categoryNames": ["Mechanical Equipment"], "scope": "ActiveViewVisible", "parameterNames": ["Mark", "Comments"], "defaultValues": ["0", "-"], "budget": { "maxEntries": 25, "maxSamplesPerEntry": 5 } }
                        """
                    )
                ],
                boundedExpansionHints: RevitDataHostOperationExamples.MatrixExpansionHints,
                handleProvenanceNotes: "Parameter coverage returns canonical parameter identities and bounded sample element handles."
            )
        );
}

public static class GetProjectParameterBindingsOperationContract {
    public static readonly HostOperationDefinition Definition =
        HostOperationDefinition.Create<ProjectParameterBindingsRequest, ProjectParameterBindingsData>(
            "revit.catalog.parameter-bindings",
            HostHttpVerb.Post,
            "/api/revit/catalog/parameter-bindings",
            HostExecutionMode.Bridge,
            "Get Project Parameter Bindings",
            HostOperationAgentMetadata.Create(
                "revit",
                "Read project parameter bindings from the active document.",
                new[] { "parameters", "project-parameters", "bindings", "document", "catalog" },
                requiresBridge: true,
                requiresActiveDocument: true,
                requestExamples: [
                    RevitDataHostOperationExamples.Example(
                        "compact project parameter bindings",
                        "Read a small project-binding catalog page.",
                        """
                        { "projection": { "view": "Summary" }, "budget": { "maxEntries": 50 } }
                        """
                    ),
                    RevitDataHostOperationExamples.Example(
                        "filtered project parameter bindings",
                        "Constrain binding catalog by category, parameter name, and binding level.",
                        """
                        { "bindingFilter": { "categoryNames": ["Mechanical Equipment"], "parameterNameContains": "Asset", "bindingKind": "Instance" }, "budget": { "maxEntries": 25 } }
                        """
                    )
                ],
                boundedExpansionHints: RevitDataHostOperationExamples.CatalogExpansionHints,
                handleProvenanceNotes: "Binding entries include canonical parameter identities, binding level, and category names."
            )
        );
}
