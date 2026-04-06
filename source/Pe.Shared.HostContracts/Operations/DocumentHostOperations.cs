using Pe.Shared.Host.Contracts.SettingsStorage;

namespace Pe.Shared.Host.Contracts.Operations;

public static class OpenSettingsDocumentOperationContract {
    public static readonly HostOperationDefinition Definition =
        HostOperationDefinition.Create<OpenSettingsDocumentRequest, SettingsDocumentSnapshot>(
            "settings.document.open",
            HostHttpVerb.Post,
            "/api/settings/document/open",
            HostExecutionMode.Local,
            "Open Settings Document"
        );
}

public static class ValidateSettingsDocumentOperationContract {
    public static readonly HostOperationDefinition Definition =
        HostOperationDefinition.Create<ValidateSettingsDocumentRequest, SettingsValidationResult>(
            "settings.document.validate",
            HostHttpVerb.Post,
            "/api/settings/document/validate",
            HostExecutionMode.Local,
            "Validate Settings Document"
        );
}

public static class SaveSettingsDocumentOperationContract {
    public static readonly HostOperationDefinition Definition =
        HostOperationDefinition.Create<SaveSettingsDocumentRequest, SaveSettingsDocumentResult>(
            "settings.document.save",
            HostHttpVerb.Post,
            "/api/settings/document/save",
            HostExecutionMode.Local,
            "Save Settings Document"
        );
}