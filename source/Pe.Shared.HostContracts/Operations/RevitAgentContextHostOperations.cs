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
                requiresBridge: true
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
                "Resolve natural references like this view, selected equipment, or printed mech Level 1 plan into stable Revit handles with provenance.",
                new[] { "agent-context", "resolve", "natural-reference", "handles", "provenance" },
                requiresBridge: true,
                requiresActiveDocument: true
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
                "Read a compact category-count summary of model state visible in the active Revit view without dumping elements.",
                new[] { "agent-context", "visible", "active-view", "categories", "summary" },
                requiresBridge: true,
                requiresActiveDocument: true
            )
        );
}
