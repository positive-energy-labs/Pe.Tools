namespace Pe.Shared.HostContracts.Operations;

public enum HostExecutionMode {
    Local,
    Bridge
}

public enum HostOperationExposure {
    PublicHttp,
    InternalHostOnly
}

public enum HostHttpVerb {
    Get,
    Post
}

public enum HostOperationIntent {
    Read,
    Mutate
}

public enum HostOperationFamily {
    Host,
    Settings,
    Script,
    Revit,
    Aps
}

public enum RevitOperationLayer {
    Context,
    Catalog,
    Matrix,
    Detail,
    Resolve,
    Apply
}

public enum RevitActiveDocumentKind {
    Project,
    Family
}

public enum HostOperationCostTier {
    Cheap,
    Bounded,
    Expensive,
    Mutation
}

public enum HostOperationVisibility {
    DefaultVisible,
    EscalationVisible,
    ExpertOnly
}

public enum HostOperationRelationKind {
    Preflight,
    DrillDown,
    Fallback,
    Alternative
}

public sealed record HostOperationRequestExample(
    string Name,
    string Description,
    string Json
);

public sealed record HostOperationRelatedOperation(
    string Key,
    HostOperationRelationKind Kind,
    string? Note = null
);

public sealed record HostOperationAgentMetadata(
    string Domain,
    string Description,
    IReadOnlyList<string> SearchTerms,
    HostOperationIntent Intent,
    bool RequiresBridge,
    bool RequiresActiveDocument,
    IReadOnlyList<RevitActiveDocumentKind> SupportedActiveDocumentKinds,
    HostOperationFamily Family,
    RevitOperationLayer? RevitLayer,
    string DomainNoun,
    HostOperationCostTier CostTier,
    HostOperationVisibility Visibility,
    string? SingleFlightGroup,
    IReadOnlyList<HostOperationRequestExample> RequestExamples,
    string? SafeDefaultRequestJson,
    IReadOnlyList<string> CallGuidance,
    IReadOnlyList<HostOperationRelatedOperation> RelatedOperations,
    bool StrictRequestValidation
) {
    public static HostOperationAgentMetadata Create(
        string domain,
        string description,
        IReadOnlyList<string>? searchTerms = null,
        HostOperationIntent intent = HostOperationIntent.Read,
        bool requiresBridge = false,
        bool requiresActiveDocument = false,
        IReadOnlyList<RevitActiveDocumentKind>? supportedActiveDocumentKinds = null,
        HostOperationFamily? family = null,
        RevitOperationLayer? revitLayer = null,
        string? domainNoun = null,
        HostOperationCostTier? costTier = null,
        HostOperationVisibility? visibility = null,
        string? singleFlightGroup = null,
        IReadOnlyList<HostOperationRequestExample>? requestExamples = null,
        string? safeDefaultRequestJson = null,
        IReadOnlyList<string>? callGuidance = null,
        IReadOnlyList<HostOperationRelatedOperation>? relatedOperations = null,
        bool strictRequestValidation = true
    ) => new(
        domain,
        description,
        searchTerms ?? Array.Empty<string>(),
        intent,
        requiresBridge,
        requiresActiveDocument,
        supportedActiveDocumentKinds ?? Array.Empty<RevitActiveDocumentKind>(),
        family ?? InferFamily(domain),
        revitLayer,
        domainNoun ?? domain,
        costTier ?? InferCostTier(intent, requiresBridge),
        visibility ?? HostOperationVisibility.EscalationVisible,
        singleFlightGroup ?? (requiresBridge ? "revit" : null),
        requestExamples ?? Array.Empty<HostOperationRequestExample>(),
        safeDefaultRequestJson,
        callGuidance ?? Array.Empty<string>(),
        relatedOperations ?? Array.Empty<HostOperationRelatedOperation>(),
        strictRequestValidation
    );

    private static HostOperationFamily InferFamily(string domain) => domain switch {
        "host" => HostOperationFamily.Host,
        "settings" => HostOperationFamily.Settings,
        "script" or "scripting" => HostOperationFamily.Script,
        "revit" or "revit-data" or "electrical" => HostOperationFamily.Revit,
        "aps" => HostOperationFamily.Aps,
        _ => HostOperationFamily.Host
    };

    private static HostOperationCostTier InferCostTier(
        HostOperationIntent intent,
        bool requiresBridge
    ) {
        if (intent == HostOperationIntent.Mutate)
            return HostOperationCostTier.Mutation;

        return requiresBridge ? HostOperationCostTier.Bounded : HostOperationCostTier.Cheap;
    }
}

public sealed record HostHttpOperationDescriptor(
    HostHttpVerb Verb,
    string Route
);

public sealed record HostOperationDefinition(
    string Key,
    HostExecutionMode ExecutionMode,
    HostOperationExposure Exposure,
    Type RequestType,
    Type ResponseType,
    HostHttpOperationDescriptor? Http = null,
    string? DisplayName = null,
    HostOperationAgentMetadata? Metadata = null
) {
    public HostHttpVerb Verb =>
        this.Http?.Verb
        ?? throw new InvalidOperationException($"Host operation '{this.Key}' is not publicly routable.");

    public string Route =>
        this.Http?.Route
        ?? throw new InvalidOperationException($"Host operation '{this.Key}' is not publicly routable.");

    public bool IsPublicHttp => this.Exposure == HostOperationExposure.PublicHttp;

    public HostOperationAgentMetadata AgentMetadata => EnrichMetadata(
        this.Key,
        this.RequestType,
        this.Metadata ?? HostOperationAgentMetadata.Create(
            GetDefaultDomain(this.Key),
            this.DisplayName ?? this.Key,
            requiresBridge: this.ExecutionMode == HostExecutionMode.Bridge
        )
    );

    public static HostOperationDefinition Create<TRequest, TResponse>(
        string key,
        HostHttpVerb verb,
        string route,
        HostExecutionMode executionMode,
        string? displayName = null,
        HostOperationAgentMetadata? metadata = null
    ) => new(
        key,
        executionMode,
        HostOperationExposure.PublicHttp,
        typeof(TRequest),
        typeof(TResponse),
        new HostHttpOperationDescriptor(verb, route),
        displayName,
        metadata
    );

    public static HostOperationDefinition CreateInternal<TRequest, TResponse>(
        string key,
        HostExecutionMode executionMode,
        string? displayName = null,
        HostOperationAgentMetadata? metadata = null
    ) => new(
        key,
        executionMode,
        HostOperationExposure.InternalHostOnly,
        typeof(TRequest),
        typeof(TResponse),
        null,
        displayName,
        metadata
    );

    private static HostOperationAgentMetadata EnrichMetadata(
        string key,
        Type requestType,
        HostOperationAgentMetadata metadata
    ) {
        var family = InferFamilyFromKey(key, metadata.Family);
        return metadata with {
            Family = family,
            SupportedActiveDocumentKinds = DefaultIfEmpty(metadata.SupportedActiveDocumentKinds, InferSupportedActiveDocumentKinds(key, family, metadata.RequiresActiveDocument)),
            RevitLayer = metadata.RevitLayer ?? InferRevitLayerFromKey(key),
            DomainNoun = InferDomainNounFromKey(key, metadata.DomainNoun, metadata.Domain),
            CostTier = InferCostTierFromKey(key, metadata.CostTier, metadata.Intent),
            SingleFlightGroup = metadata.SingleFlightGroup ?? (metadata.RequiresBridge ? "revit" : null),
            Visibility = InferVisibilityFromKey(key, metadata.Visibility),
            SearchTerms = DefaultIfEmpty(metadata.SearchTerms, InferSearchTermsFromKey(key, metadata.Description, metadata.Domain)),
            SafeDefaultRequestJson = metadata.SafeDefaultRequestJson ?? InferSafeDefaultRequestJson(key, requestType)
        };
    }

    private static IReadOnlyList<string> DefaultIfEmpty(IReadOnlyList<string> current, IReadOnlyList<string> fallback) =>
        current.Count == 0 ? fallback : current;

    private static IReadOnlyList<RevitActiveDocumentKind> DefaultIfEmpty(
        IReadOnlyList<RevitActiveDocumentKind> current,
        IReadOnlyList<RevitActiveDocumentKind> fallback
    ) => current.Count == 0 ? fallback : current;

    private static IReadOnlyList<RevitActiveDocumentKind> InferSupportedActiveDocumentKinds(
        string key,
        HostOperationFamily family,
        bool requiresActiveDocument
    ) {
        if (family != HostOperationFamily.Revit || !requiresActiveDocument)
            return [];

        return key switch {
            "revit.context.summary" => [RevitActiveDocumentKind.Project, RevitActiveDocumentKind.Family],
            "revit.catalog.loaded-families.filter-schema" => [RevitActiveDocumentKind.Project],
            "revit.catalog.loaded-families.filter-field-options" => [RevitActiveDocumentKind.Project],
            "revit.catalog.schedules" => [RevitActiveDocumentKind.Project],
            "revit.catalog.project-browser" => [RevitActiveDocumentKind.Project],
            "revit.detail.sheets" => [RevitActiveDocumentKind.Project],
            "revit.catalog.project-index" => [RevitActiveDocumentKind.Project],
            "revit.matrix.schedule-profiles" => [RevitActiveDocumentKind.Project],
            "revit.detail.schedules" => [RevitActiveDocumentKind.Project],
            "revit.catalog.loaded-families" => [RevitActiveDocumentKind.Project],
            "revit.matrix.loaded-families" => [RevitActiveDocumentKind.Project],
            "revit.matrix.schedule-coverage" => [RevitActiveDocumentKind.Project],
            "revit.matrix.parameter-coverage" => [RevitActiveDocumentKind.Project],
            "revit.catalog.concept-evidence" => [RevitActiveDocumentKind.Project],
            "revit.catalog.parameter-evidence" => [RevitActiveDocumentKind.Project],
            "revit.catalog.parameter-bindings" => [RevitActiveDocumentKind.Project],
            "revit.resolve.references" => [RevitActiveDocumentKind.Project],
            "revit.context.visible-summary" => [RevitActiveDocumentKind.Project],
            "revit.detail.elements" => [RevitActiveDocumentKind.Project],
            "revit.catalog.electrical-panels" => [RevitActiveDocumentKind.Project],
            "revit.catalog.electrical-circuits" => [RevitActiveDocumentKind.Project],
            "revit.catalog.electrical-load-classifications" => [RevitActiveDocumentKind.Project],
            "revit.detail.electrical-panel-schedules" => [RevitActiveDocumentKind.Project],
            _ => [RevitActiveDocumentKind.Project]
        };
    }

    private static IReadOnlyList<string> InferSearchTermsFromKey(
        string key,
        string description,
        string domain
    ) {
        var terms = new List<string>();
        AddSplitTerms(terms, key);
        AddSplitTerms(terms, description);
        AddSplitTerms(terms, domain);
        return terms
            .Where(term => term.Length > 1)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToArray();
    }

    private static void AddSplitTerms(
        List<string> terms,
        string value
    ) {
        foreach (var term in value.Split(['.', '-', '_', '/', ' ', ',', ':', ';', '(', ')', '[', ']'], StringSplitOptions.RemoveEmptyEntries))
            terms.Add(term.Trim().ToLowerInvariant());
    }

    private static string? InferSafeDefaultRequestJson(string key, Type requestType) {
        if (requestType == typeof(NoRequest))
            return null;
        return key switch {
            "revit.catalog.project-index" => """{ "projection": { "view": "Summary" }, "budget": { "maxEntries": 10, "maxSamplesPerEntry": 3 } }""",
            "revit.catalog.project-browser" => """{ "view": "Folders", "budget": { "maxSamplesPerEntry": 5 } }""",
            "revit.catalog.schedules" => """{ "projection": { "view": "Summary" }, "budget": { "maxEntries": 25 } }""",
            "revit.detail.schedules" => """{ "query": { "kind": "CurrentActiveView", "projection": { "view": "Summary", "includeColumns": true }, "budget": { "maxEntries": 1, "maxRowsPerEntry": 0 } } }""",
            "revit.matrix.schedule-profiles" => """{ "query": { "kind": "CurrentActiveView", "includeTemplates": true } }""",
            "revit.matrix.schedule-coverage" => """{ "scope": "ActiveViewVisible", "scheduleFilter": { "projection": { "view": "Summary" }, "budget": { "maxEntries": 25 } }, "budget": { "maxEntries": 25, "maxSamplesPerEntry": 5 }, "includeElementSamples": true, "includeMatchedScheduleNames": true }""",
            "revit.catalog.loaded-families" => """{ "filter": { "placementScope": "PlacedOnly" }, "projection": { "view": "Summary" }, "budget": { "maxEntries": 25 } }""",
            "revit.detail.elements" => """{ "query": { "kind": "CurrentSelection" } }""",
            "revit.catalog.concept-evidence" => """{ "query": "", "conceptHints": [], "subjectHints": [], "budget": { "maxEntries": 10, "maxSamplesPerEntry": 3 } }""",
            "revit.catalog.parameter-bindings" => """{ "projection": { "view": "Summary" }, "budget": { "maxEntries": 50 } }""",
            "revit.catalog.parameter-evidence" => """{ "scope": "ActiveViewVisible", "candidateParameters": [], "budget": { "maxEntries": 25, "maxSamplesPerEntry": 5 } }""",
            "revit.matrix.parameter-coverage" => """{ "parameters": [], "scope": "ActiveViewVisible", "budget": { "maxEntries": 25, "maxSamplesPerEntry": 5 } }""",
            "settings.schema" => """{ "moduleKey": "CmdScheduleManager", "rootKey": "schedules" }""",
            "settings.field-options" => """{ "moduleKey": "CmdScheduleManager", "rootKey": "schedules", "propertyPath": "fields[].parameter.name", "sourceKey": "schedule-field-names", "contextValues": {} }""",
            "settings.parameter-catalog" => """{ "moduleKey": "CmdFFManager", "contextValues": {} }""",
            _ => "{}"
        };
    }

    private static HostOperationFamily InferFamilyFromKey(
        string key,
        HostOperationFamily fallback
    ) {
        if (key.StartsWith("revit.", StringComparison.Ordinal))
            return HostOperationFamily.Revit;
        if (key.StartsWith("settings.", StringComparison.Ordinal))
            return HostOperationFamily.Settings;
        if (key.StartsWith("script.", StringComparison.Ordinal))
            return HostOperationFamily.Script;
        if (key.StartsWith("host.", StringComparison.Ordinal))
            return HostOperationFamily.Host;
        if (key.StartsWith("aps.", StringComparison.Ordinal))
            return HostOperationFamily.Aps;

        return fallback;
    }

    private static RevitOperationLayer? InferRevitLayerFromKey(string key) {
        var parts = key.Split('.');
        if (parts.Length < 3 || !string.Equals(parts[0], "revit", StringComparison.Ordinal))
            return null;

        return parts[1] switch {
            "context" => RevitOperationLayer.Context,
            "catalog" => RevitOperationLayer.Catalog,
            "matrix" => RevitOperationLayer.Matrix,
            "detail" => RevitOperationLayer.Detail,
            "resolve" => RevitOperationLayer.Resolve,
            "apply" => RevitOperationLayer.Apply,
            _ => null
        };
    }

    private static string InferDomainNounFromKey(
        string key,
        string fallback,
        string legacyDomain
    ) {
        var parts = key.Split('.');
        if (parts.Length >= 3 && string.Equals(parts[0], "revit", StringComparison.Ordinal))
            return parts[2];

        return string.Equals(fallback, legacyDomain, StringComparison.Ordinal)
            ? GetDefaultDomain(key)
            : fallback;
    }

    private static HostOperationVisibility InferVisibilityFromKey(
        string key,
        HostOperationVisibility fallback
    ) {
        if (key is "revit.context.summary" or "revit.catalog.project-index" or "revit.resolve.references")
            return HostOperationVisibility.DefaultVisible;
        if (key is "revit.matrix.schedule-profiles" or "revit.catalog.electrical-load-classifications")
            return HostOperationVisibility.ExpertOnly;
        if (key.StartsWith("script.", StringComparison.Ordinal))
            return HostOperationVisibility.ExpertOnly;
        if (key.StartsWith("revit.matrix.", StringComparison.Ordinal)
            || key.StartsWith("revit.detail.", StringComparison.Ordinal)
            || key.StartsWith("revit.catalog.", StringComparison.Ordinal)
            || key.StartsWith("revit.context.visible", StringComparison.Ordinal))
            return HostOperationVisibility.EscalationVisible;

        return fallback;
    }

    private static HostOperationCostTier InferCostTierFromKey(
        string key,
        HostOperationCostTier fallback,
        HostOperationIntent intent
    ) {
        if (intent == HostOperationIntent.Mutate)
            return HostOperationCostTier.Mutation;
        if (key.StartsWith("revit.matrix.", StringComparison.Ordinal)
            || key.Contains("matrix", StringComparison.Ordinal))
            return HostOperationCostTier.Expensive;
        if (key.StartsWith("revit.detail.", StringComparison.Ordinal)
            || key.StartsWith("revit.resolve.", StringComparison.Ordinal))
            return HostOperationCostTier.Bounded;
        if (key.StartsWith("revit.catalog.", StringComparison.Ordinal)
            || key.StartsWith("revit.context.", StringComparison.Ordinal))
            return HostOperationCostTier.Cheap;

        return fallback;
    }

    private static string GetDefaultDomain(string key) {
        var dotIndex = key.IndexOf(".", StringComparison.Ordinal);
        return dotIndex > 0 ? key[..dotIndex] : key;
    }
}

public sealed record NoRequest;
