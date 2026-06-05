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
                costTier: HostOperationCostTier.Cheap,
                requestExamples: [
                    new HostOperationRequestExample(
                        "recent local files for Revit 2025",
                        "Read local RVT/RFA/RTE candidates from the Revit 2025 Recent File List.",
                        """
                        { "revitYear": "2025", "localFilesOnly": true }
                        """
                    )
                ],
                callGuidance: [
                    "Use before Revit has an active document to find locally-openable document paths.",
                    "Use revit.context.document-session instead for live open-document state."
                ]
            )
        );
}

public static class OpenRevitDocumentOperationContract {
    public static readonly HostOperationDefinition Definition =
        HostOperationDefinition.Create<OpenRevitDocumentRequest, OpenRevitDocumentData>(
            "revit.apply.document.open",
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
                costTier: HostOperationCostTier.Mutation,
                requestExamples: [
                    new HostOperationRequestExample(
                        "open local model",
                        "Open a local Revit project or family file by absolute path.",
                        """
                        { "path": "C:/Models/Project.rvt" }
                        """
                    )
                ],
                callGuidance: [
                    "Use a local RVT/RFA/RTE path to bootstrap or switch active document context.",
                    "Do not use for cloud-only cld:// targets or while Revit is blocked by a modal dialog."
                ]
            )
        );
}
