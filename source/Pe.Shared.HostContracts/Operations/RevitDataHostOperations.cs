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
            "Get Loaded Families Filter Schema",
            HostOperationAgentMetadata.Create(
                                "Read the filter schema for loaded-family catalog and matrix queries.",
                new[] { "loaded-families", "families", "filter", "schema" },
                requiresActiveDocument: true
            )
        );
}

public static class GetLoadedFamiliesFilterFieldOptionsOperationContract {
    public static readonly HostOperationDefinition Definition =
        HostOperationDefinition.Create<LoadedFamiliesFilterFieldOptionsRequest, FieldOptionsData>(
            "revit.catalog.loaded-families.filter-field-options",
            "Get Loaded Families Filter Field Options",
            HostOperationAgentMetadata.Create(
                                "Read document-specific option values for loaded-family query filters.",
                new[] { "loaded-families", "families", "filter", "field-options" },
                requiresActiveDocument: true
            )
        );
}

public static class GetScheduleCatalogOperationContract {
    public static readonly HostOperationDefinition Definition =
        HostOperationDefinition.Create<ScheduleCatalogRequest, ScheduleCatalogData>(
            "revit.catalog.schedules",
            "Get Schedule Catalog",
            HostOperationAgentMetadata.Create(
                                "Read compact schedule handles, names, sheet placement, optional field metadata, and factual schedule evidence summaries from the active document. Revit-generated duplicate suffixes like '(2)' and 'Copy 1' are normalized out of name summary weighting. Do not use broad schedule catalog discovery for visible equipment coverage when revit.matrix.schedule-coverage can answer from view or element handles.",
                new[] { "schedules", "catalog", "fields", "columns", "parameters", "document", "sheet-placement", "printed-context" },
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
                callGuidance: [
                    "Start with summary/handles plus maxEntries; only request full catalog facts after filters prove useful.",
                    "For visible/current/printed equipment coverage, prefer revit.matrix.schedule-coverage with ViewReferences or ExplicitHandles; use this catalog only when schedule candidates themselves are unknown.",
                ]
            )
        );
}


public static class GetProjectBrowserOperationContract {
    public static readonly HostOperationDefinition Definition =
        HostOperationDefinition.Create<ProjectBrowserRequest, ProjectBrowserData>(
            "revit.catalog.project-browser",
            "Get Project Browser",
            HostOperationAgentMetadata.Create(
                                "Read bounded Project Browser organization for views, sheets, and schedules as navigation/provenance metadata.",
                new[] { "project-browser", "browser", "views", "sheets", "schedules", "folders", "navigation", "provenance" },
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
                callGuidance: [
                    "Use Folders mode to inspect browser vocabulary before Items mode.",
                    "Browser organization is navigation/provenance for views, sheets, and schedules; use semantic catalog/detail ops for BIM facts."
                ]
            )
        );
}

public static class GetSheetDetailsOperationContract {
    public static readonly HostOperationDefinition Definition =
        HostOperationDefinition.Create<SheetDetailRequest, SheetDetailData>(
            "revit.detail.sheets",
            "Get Sheet Details",
            HostOperationAgentMetadata.Create(
                                "Read minimal native sheet anchors for extractor and scripting workflows: sheet identity, placed views, placed schedules, title blocks, sheet-owned text, and provenance.",
                new[] { "sheets", "sheet-anchors", "printed-context", "viewports", "schedule-placement", "title-blocks", "text-notes", "extractor-boundary" },
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
                callGuidance: [
                    "Use this as a native anchor map for scripts and external extractors; do not treat it as OCR or model vision.",
                    "Start with active sheet or exact sheet numbers, then export/parse artifacts only when semantic anchors are insufficient."
                ]
            )
        );
}

public static class GetProjectIndexOperationContract {
    public static readonly HostOperationDefinition Definition =
        HostOperationDefinition.Create<ProjectIndexRequest, ProjectIndexData>(
            "revit.catalog.project-index",
            "Get Project Index",
            HostOperationAgentMetadata.Create(
                                "Read a compact semantic project index with bounded Project Browser provenance for levels, sheets, views, schedules, categories, and families.",
                new[] { "project-index", "project-browser", "browser-provenance", "levels", "sheets", "views", "schedules", "printed-context", "orientation" },
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
                callGuidance: RevitDataHostOperationExamples.CatalogExpansionHints
            )
        );
}

public static class GetScheduleProfilesQueryOperationContract {
    public static readonly HostOperationDefinition Definition =
        HostOperationDefinition.Create<ScheduleProfilesQueryRequest, ScheduleProfilesQueryData>(
            "revit.matrix.schedule-profiles",
            "Get Schedule Profiles Query",
            HostOperationAgentMetadata.Create(
                                "Read schedule profile projections from the active document.",
                new[] { "schedules", "profiles", "query", "projection", "authored-schedule-shape" },
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
                callGuidance: RevitDataHostOperationExamples.MatrixExpansionHints
            )
        );
}

public static class GetScheduleQueryOperationContract {
    public static readonly HostOperationDefinition Definition =
        HostOperationDefinition.Create<ScheduleQueryRequest, ScheduleQueryData>(
            "revit.detail.schedules",
            "Get Schedule Query",
            HostOperationAgentMetadata.Create(
                                "Read schedule rows and field values from the active document.",
                new[] { "schedules", "query", "rows", "values", "detail" },
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
                callGuidance: RevitDataHostOperationExamples.ScheduleDetailExpansionHints
            )
        );
}

public static class GetLoadedFamiliesCatalogOperationContract {
    public static readonly HostOperationDefinition Definition =
        HostOperationDefinition.Create<LoadedFamiliesCatalogRequest, LoadedFamiliesCatalogData>(
            "revit.catalog.loaded-families",
            "Get Loaded Families Catalog",
            HostOperationAgentMetadata.Create(
                                "Read loaded family and type facts from the active document.",
                new[] { "loaded-families", "families", "types", "catalog" },
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
                callGuidance: RevitDataHostOperationExamples.CatalogExpansionHints
            )
        );
}

public static class GetLoadedFamiliesMatrixOperationContract {
    public static readonly HostOperationDefinition Definition =
        HostOperationDefinition.Create<LoadedFamiliesMatrixRequest, LoadedFamiliesMatrixData>(
            "revit.matrix.loaded-families",
            "Get Loaded Families Matrix",
            HostOperationAgentMetadata.Create(
                                "Read a matrix projection of loaded family/type facts from the active document.",
                new[] { "loaded-families", "families", "matrix", "projection", "parameter-presence" },
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
                callGuidance: RevitDataHostOperationExamples.MatrixExpansionHints
            )
        );
}


public static class GetScheduleCoverageOperationContract {
    public static readonly HostOperationDefinition Definition =
        HostOperationDefinition.Create<ScheduleCoverageRequest, ScheduleCoverageData>(
            "revit.matrix.schedule-coverage",
            "Get Schedule Coverage Matrix",
            HostOperationAgentMetadata.Create(
                                "Read bounded element-to-schedule coverage counts and samples from the active document, including active-view-visible or explicit-handle scopes.",
                new[] { "schedules", "coverage", "matrix", "elements", "handles", "active-view-visible", "explicit-handles", "visible-equipment", "printed-context" },
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
                callGuidance: [
                    "Resolve the target view/sheet phrase first with revit.context.summary or one narrowed revit.resolve.references call; use ViewReferences, ActiveViewVisible, or ExplicitHandles only when that scope is intended.",
                    "For audit summaries, request includeMissingElementHandles, includeMatchedScheduleNames, and read roleSummaries before asking for per-element samples."
                ]
            )
        );
}

public static class GetParameterCoverageOperationContract {
    public static readonly HostOperationDefinition Definition =
        HostOperationDefinition.Create<ParameterCoverageRequest, ParameterCoverageData>(
            "revit.matrix.parameter-coverage",
            "Get Parameter Coverage Matrix",
            HostOperationAgentMetadata.Create(
                                "Read bounded parameter presence, blank/default counts, and sample handles from the active document.",
                new[] { "parameters", "coverage", "matrix", "elements", "handles" },
                requiresActiveDocument: true,
                requestExamples: [
                    RevitDataHostOperationExamples.Example(
                        "bounded parameter coverage",
                        "Check parameter presence/blank/default counts for a category or selection.",
                        """
                        { "categoryNames": ["Mechanical Equipment"], "scope": "ActiveViewVisible", "parameters": [{ "name": "Mark" }, { "name": "Comments" }], "defaultValues": ["0", "-"], "budget": { "maxEntries": 25, "maxSamplesPerEntry": 5 } }
                        """
                    )
                ],
                callGuidance: RevitDataHostOperationExamples.MatrixExpansionHints
            )
        );
}

public static class GetConceptEvidenceOperationContract {
    public static readonly HostOperationDefinition Definition =
        HostOperationDefinition.Create<ConceptEvidenceRequest, ConceptEvidenceData>(
            "revit.catalog.concept-evidence",
            "Get Concept Evidence",
            HostOperationAgentMetadata.Create(
                                "Infer project-specific parameter candidates for operator concepts from factual binding and schedule evidence. Category and subject hints are weak context, not expected-shape rules; use returned reasons and facts before detail or coverage calls.",
                new[] { "concepts", "parameter-evidence", "project-standards", "bindings", "schedule-fields", "discovery" },
                requiresActiveDocument: true,
                requestExamples: [
                    RevitDataHostOperationExamples.Example(
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
            )
        );
}

public static class GetParameterEvidenceOperationContract {
    public static readonly HostOperationDefinition Definition =
        HostOperationDefinition.Create<ParameterEvidenceRequest, ParameterEvidenceData>(
            "revit.catalog.parameter-evidence",
            "Get Parameter Evidence",
            HostOperationAgentMetadata.Create(
                                "Return factual parameter evidence from project bindings, schedule fields/filters, and scoped element presence. Use this when project-standard parameter names are uncertain; inspect binding categories, schedule usage, counts, and samples, then pass observed parameter identities or named references into detail or matrix calls.",
                new[] { "parameters", "evidence", "project-bindings", "schedule-fields", "categories", "parameter-usage" },
                requiresActiveDocument: true,
                requestExamples: [
                    RevitDataHostOperationExamples.Example(
                        "bounded parameter evidence for visible equipment",
                        "Collect factual binding, schedule, and scoped-element evidence for candidate parameter references.",
                        """
                        { "categoryNames": ["Mechanical Equipment"], "scope": "ActiveViewVisible", "candidateParameters": [{ "name": "Mark" }, { "name": "Equipment Tag" }], "budget": { "maxEntries": 10, "maxSamplesPerEntry": 2 } }
                        """
                    ),
                    RevitDataHostOperationExamples.Example(
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
            )
        );
}

public static class GetProjectParameterBindingsOperationContract {
    public static readonly HostOperationDefinition Definition =
        HostOperationDefinition.Create<ProjectParameterBindingsRequest, ProjectParameterBindingsData>(
            "revit.catalog.parameter-bindings",
            "Get Project Parameter Bindings",
            HostOperationAgentMetadata.Create(
                                "Read project parameter bindings from the active document, using the same canonical parameter identity and shared-GUID string language returned by parameter evidence and coverage operations.",
                new[] { "parameters", "project-parameters", "bindings", "document", "catalog", "parameter-identity", "shared-guid" },
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
            )
        );
}
