using Pe.Shared.RevitData;

namespace Pe.Shared.HostContracts.Operations;

public static class GetRevitAgentContextSummaryOperationContract {
    public static readonly HostOperationDefinition Definition =
        HostOperationDefinition.Create<NoRequest, RevitAgentContextSummaryData>(
            "revit.context.summary",
            HostHttpVerb.Get,
            "/api/revit/context/summary",
            HostExecutionMode.Bridge,
            "Get Revit Agent Context Summary",
            HostOperationAgentMetadata.Create(
                "revit",
                "Read compact current document, active view or sheet, selection, browser counts, and visible-category context for Pea orientation.",
                new[] { "agent-context", "summary", "active-view", "selection", "visible", "browser" },
                requiresBridge: true,
                requiresActiveDocument: true,
                supportedActiveDocumentKinds: [RevitActiveDocumentKind.Project, RevitActiveDocumentKind.Family]
            )
        );
}

public static class ResolveRevitAgentContextOperationContract {
    public static readonly HostOperationDefinition Definition =
        HostOperationDefinition.Create<RevitAgentContextResolveRequest, RevitAgentContextResolveData>(
            "revit.resolve.references",
            HostHttpVerb.Post,
            "/api/revit/resolve/references",
            HostExecutionMode.Bridge,
            "Resolve Revit Agent Context Reference",
            HostOperationAgentMetadata.Create(
                "revit",
                "Resolve natural references like this view, selected equipment, or printed mech Level 1 plan into stable Revit handles with provenance; narrow by handle kind and printed context when the user already described the scope.",
                new[] { "agent-context", "resolve", "natural-reference", "handles", "provenance", "printed-context", "view-handles" },
                requiresBridge: true,
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
            )
        );
}

public static class GetRevitAgentVisibleContextOperationContract {
    public static readonly HostOperationDefinition Definition =
        HostOperationDefinition.Create<RevitAgentVisibleContextRequest, RevitAgentVisibleContextData>(
            "revit.context.visible-summary",
            HostHttpVerb.Post,
            "/api/revit/context/visible-summary",
            HostExecutionMode.Bridge,
            "Get Revit Agent Visible Context Summary",
            HostOperationAgentMetadata.Create(
                "revit",
                "Read compact category counts and bounded visible element handles for the active view or explicit view references.",
                new[] { "agent-context", "visible", "active-view", "view-references", "categories", "handles", "printed-views", "visible-equipment" },
                requiresBridge: true,
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
            )
        );
}


public static class GetRevitAgentViewRenderingStateOperationContract {
    public static readonly HostOperationDefinition Definition =
        HostOperationDefinition.Create<RevitAgentViewRenderingStateRequest, RevitAgentViewRenderingStateData>(
            "revit.context.view-rendering-state",
            HostHttpVerb.Post,
            "/api/revit/context/view-rendering-state",
            HostExecutionMode.Bridge,
            "Get Revit Agent View Rendering State",
            HostOperationAgentMetadata.Create(
                "revit",
                "Read a bounded evidence packet for visibility/rendering-affecting state in the active view or explicit views, including explicit limitations and uninspected causes.",
                new[] { "agent-context", "view-rendering", "visibility", "active-view", "view-references", "filters", "links", "worksets", "view-range", "crop", "template" },
                requiresBridge: true,
                requiresActiveDocument: true,
                supportedActiveDocumentKinds: [RevitActiveDocumentKind.Project],
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
                ],
                relatedOperations: [
                    new HostOperationRelatedOperation(GetRevitAgentVisibleContextOperationContract.Definition.Key, HostOperationRelationKind.DrillDown, "Use for candidate visible element handles by category."),
                    new HostOperationRelatedOperation(ResolveRevitAgentContextOperationContract.Definition.Key, HostOperationRelationKind.Preflight, "Resolve named views or sheets before passing explicit view references.")
                ]
            )
        );
}
