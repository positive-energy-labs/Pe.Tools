using Pe.Shared.RevitData;

namespace Pe.Shared.HostContracts.Operations;

public static class GetRevitDocumentSessionContextOperationContract {
    public static readonly HostOperationDefinition Definition =
        HostOperationDefinition.Create<NoRequest, RevitDocumentSessionContextData>(
            "revit.context.document-session",
            HostHttpVerb.Get,
            "/api/revit/context/document-session",
            HostExecutionMode.Bridge,
            "Get Revit Document Session Context",
            HostOperationAgentMetadata.Create(
                "revit",
                "Read open, active, and selected document session context from connected Revit.",
                new[] { "document", "session", "active-document", "open-documents" },
                requiresBridge: true
            )
        );
}

public static class GetRevitRecentDocumentsOperationContract {
    public static readonly HostOperationDefinition Definition =
        HostOperationDefinition.Create<RevitRecentDocumentsRequest, RevitRecentDocumentsData>(
            "revit.catalog.recent-documents",
            HostHttpVerb.Post,
            "/api/revit/catalog/recent-documents",
            HostExecutionMode.Local,
            "Get Revit Recent Documents",
            HostOperationAgentMetadata.Create(
                "revit",
                "Read local Revit recent-document candidates from user Revit.ini files without requiring a connected Revit session. The current opener supports local files only; cloud recent entries are preserved in the contract for later cloud open support but omitted by default.",
                new[] { "document", "recent", "revit-ini", "local-files", "catalog" },
                requiresBridge: false,
                requiresActiveDocument: false,
                revitLayer: RevitOperationLayer.Catalog,
                domainNoun: "recent-documents",
                resultGrain: HostOperationResultGrain.Catalog,
                costTier: HostOperationCostTier.Cheap,
                requestShapeKind: HostOperationRequestShapeKind.QueryWrapper,
                requestExamples: [
                    new HostOperationRequestExample(
                        "recent local files for Revit 2025",
                        "Read local RVT/RFA/RTE candidates from the Revit 2025 Recent File List.",
                        """
                        { "revitYear": "2025", "localFilesOnly": true }
                        """
                    )
                ],
                useWhen: [
                    "A restart/open workflow needs a locally-openable document path before Revit has an active document.",
                    "A caller needs a cheap host-only list of recent local Revit models or families."
                ],
                doNotUseWhen: [
                    "The target is a cloud-only cld:// model; cloud discovery/opening is intentionally not completed yet.",
                    "The caller needs live open-document state; use revit.context.document-session instead."
                ]
            )
        );
}

public static class OpenRevitDocumentOperationContract {
    public static readonly HostOperationDefinition Definition =
        HostOperationDefinition.Create<OpenRevitDocumentRequest, OpenRevitDocumentData>(
            "revit.document.open",
            HostHttpVerb.Post,
            "/api/revit/document/open",
            HostExecutionMode.Bridge,
            "Open Revit Document",
            HostOperationAgentMetadata.Create(
                "revit",
                "Open and activate a local Revit document in the connected Revit session.",
                new[] { "document", "open", "activate", "cross-document" },
                intent: HostOperationIntent.Mutate,
                requiresBridge: true,
                requiresActiveDocument: false,
                revitLayer: RevitOperationLayer.Apply,
                domainNoun: "document",
                resultGrain: HostOperationResultGrain.Document,
                costTier: HostOperationCostTier.Mutation,
                requestShapeKind: HostOperationRequestShapeKind.Command,
                requestExamples: [
                    new HostOperationRequestExample(
                        "open local model",
                        "Open a local Revit project or family file by absolute path.",
                        """
                        { "path": "C:/Models/Project.rvt" }
                        """
                    )
                ],
                useWhen: [
                    "A connected Revit session has no active document and a workflow needs to bootstrap document context.",
                    "A workflow needs to switch to a known local model path before running document-owned queries."
                ],
                doNotUseWhen: [
                    "The target model is cloud-only and has no local user-visible path; use a future cloud-model opener instead.",
                    "The current Revit session is blocked by a modal dialog or an open transaction."
                ]
            )
        );
}
