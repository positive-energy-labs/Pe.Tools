using Pe.Shared.HostContracts.SettingsStorage;

namespace Pe.Shared.HostContracts.Operations;

public static class OpenSettingsDocumentOperationContract {
    public static readonly HostOperationDefinition Definition =
        HostOperationDefinition.Create<OpenSettingsDocumentRequest, SettingsDocumentSnapshot>(
            "settings.document.open",
            HostHttpVerb.Post,
            "/api/settings/document/open",
            HostExecutionMode.Local,
            "Open Settings Document",
            HostOperationAgentMetadata.Create(
                "settings",
                "Read a settings document snapshot from the local settings workspace.",
                new[] { "settings", "document", "open", "snapshot", "profile", "profiles", "family-foundry" }
            )
        );
}

public static class ValidateSettingsDocumentOperationContract {
    public static readonly HostOperationDefinition Definition =
        HostOperationDefinition.Create<ValidateSettingsDocumentRequest, SettingsValidationResult>(
            "settings.document.validate",
            HostHttpVerb.Post,
            "/api/settings/document/validate",
            HostExecutionMode.Local,
            "Validate Settings Document",
            HostOperationAgentMetadata.Create(
                "settings",
                "Validate a settings document and return diagnostics without saving it.",
                new[] { "settings", "document", "validate", "validation", "diagnostics", "profile", "profiles", "family-foundry" }
            )
        );
}

public static class SaveSettingsDocumentOperationContract {
    public static readonly HostOperationDefinition Definition =
        HostOperationDefinition.Create<SaveSettingsDocumentRequest, SaveSettingsDocumentResult>(
            "settings.document.save",
            HostHttpVerb.Post,
            "/api/settings/document/save",
            HostExecutionMode.Local,
            "Save Settings Document",
            HostOperationAgentMetadata.Create(
                "settings",
                "Write a settings document to the local settings workspace.",
                new[] { "settings", "document", "save", "write", "profile", "profiles", "family-foundry" },
                HostOperationIntent.Mutate
            )
        );
}
