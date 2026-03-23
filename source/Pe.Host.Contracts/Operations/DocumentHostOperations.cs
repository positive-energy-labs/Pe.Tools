namespace Pe.Host.Contracts;

public static class OpenSettingsDocumentOperationContract {
    public static readonly HostOperationDefinition Definition =
        HostOperationDefinition.Create<OpenSettingsDocumentRequest, SettingsDocumentSnapshot>(
            key: "settings.document.open",
            verb: HostHttpVerb.Post,
            route: "/api/settings/document/open",
            executionMode: HostExecutionMode.Local,
            displayName: "Open Settings Document"
        );
}

public static class ComposeSettingsDocumentOperationContract {
    public static readonly HostOperationDefinition Definition =
        HostOperationDefinition.Create<OpenSettingsDocumentRequest, SettingsDocumentSnapshot>(
            key: "settings.document.compose",
            verb: HostHttpVerb.Post,
            route: "/api/settings/document/compose",
            executionMode: HostExecutionMode.Local,
            displayName: "Compose Settings Document"
        );
}

public static class ValidateSettingsDocumentOperationContract {
    public static readonly HostOperationDefinition Definition =
        HostOperationDefinition.Create<ValidateSettingsDocumentRequest, SettingsValidationResult>(
            key: "settings.document.validate",
            verb: HostHttpVerb.Post,
            route: "/api/settings/document/validate",
            executionMode: HostExecutionMode.Local,
            displayName: "Validate Settings Document"
        );
}

public static class SaveSettingsDocumentOperationContract {
    public static readonly HostOperationDefinition Definition =
        HostOperationDefinition.Create<SaveSettingsDocumentRequest, SaveSettingsDocumentResult>(
            key: "settings.document.save",
            verb: HostHttpVerb.Post,
            route: "/api/settings/document/save",
            executionMode: HostExecutionMode.Local,
            displayName: "Save Settings Document"
        );
}
