namespace Pe.Shared.HostContracts.Operations;

public enum HostOperationIntent {
    Read,
    Mutate
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

// Which active document kind a bridge-backed operation supports (see AGENTS.md
// "supported active document kind"). Metadata/gating signal only — request scopes
// (selection, active view, handles) stay separate.
public enum OpNeeds {
    Nothing,
    Document,
    ProjectDocument,
    FamilyDocument
}

// Machine-readable failure classification the host emits in problem.extensions.kind,
// so callers classify errors from a C#-owned taxonomy instead of regexing messages.
public enum HostErrorKind {
    Disconnected,
    BridgeBusy,
    InvalidRequest,
    Conflict,
    HostFailure
}

public sealed record HostOperationRequestExample(
    string Name,
    string Description,
    string Json
);

public sealed record HostOperationAgentMetadata(
    string Description,
    IReadOnlyList<string> SearchTerms,
    HostOperationIntent Intent,
    HostOperationCostTier CostTier,
    HostOperationVisibility Visibility,
    IReadOnlyList<HostOperationRequestExample> RequestExamples,
    string? SafeDefaultRequestJson,
    IReadOnlyList<string> CallGuidance
) {
    public static HostOperationAgentMetadata Create(
        string description,
        IReadOnlyList<string>? searchTerms = null,
        HostOperationIntent intent = HostOperationIntent.Read,
        HostOperationCostTier? costTier = null,
        HostOperationVisibility? visibility = null,
        IReadOnlyList<HostOperationRequestExample>? requestExamples = null,
        string? safeDefaultRequestJson = null,
        IReadOnlyList<string>? callGuidance = null
    ) => new(
        description,
        searchTerms ?? Array.Empty<string>(),
        intent,
        costTier ?? InferCostTier(intent),
        visibility ?? HostOperationVisibility.EscalationVisible,
        requestExamples ?? Array.Empty<HostOperationRequestExample>(),
        safeDefaultRequestJson,
        callGuidance ?? Array.Empty<string>()
    );

    private static HostOperationCostTier InferCostTier(HostOperationIntent intent) {
        if (intent == HostOperationIntent.Mutate)
            return HostOperationCostTier.Mutation;

        return HostOperationCostTier.Cheap;
    }
}

public sealed record HostOperationDefinition(
    string Key,
    Type RequestType,
    Type ResponseType,
    bool IsPublic = true,
    string? DisplayName = null,
    HostOperationAgentMetadata? Metadata = null,
    OpNeeds Needs = OpNeeds.Nothing,
    OpActor Actor = OpActor.Any
) {
    public HostOperationAgentMetadata AgentMetadata => EnrichMetadata(
        this.Key,
        this.RequestType,
        this.Metadata ?? HostOperationAgentMetadata.Create(
            this.DisplayName ?? this.Key
        )
    );

    public static HostOperationDefinition Create<TRequest, TResponse>(
        string key,
        string? displayName = null,
        HostOperationAgentMetadata? metadata = null
    ) => new(
        key,
        typeof(TRequest),
        typeof(TResponse),
        true,
        displayName,
        metadata
    );

    public static HostOperationDefinition CreateInternal<TRequest, TResponse>(
        string key,
        string? displayName = null,
        HostOperationAgentMetadata? metadata = null
    ) => new(
        key,
        typeof(TRequest),
        typeof(TResponse),
        false,
        displayName,
        metadata
    );

    private static HostOperationAgentMetadata EnrichMetadata(
        string key,
        Type requestType,
        HostOperationAgentMetadata metadata
    ) {
        return metadata with {
            CostTier = InferCostTierFromKey(key, metadata.CostTier, metadata.Intent),
            Visibility = InferVisibilityFromKey(key, metadata.Visibility),
            SearchTerms = DefaultIfEmpty(metadata.SearchTerms, InferSearchTermsFromKey(key, metadata.Description)),
            SafeDefaultRequestJson = metadata.SafeDefaultRequestJson ?? InferSafeDefaultRequestJson(key, requestType)
        };
    }

    private static IReadOnlyList<string> DefaultIfEmpty(IReadOnlyList<string> current, IReadOnlyList<string> fallback) =>
        current.Count == 0 ? fallback : current;

    private static IReadOnlyList<string> InferSearchTermsFromKey(
        string key,
        string description
    ) {
        var terms = new List<string>();
        AddSplitTerms(terms, key);
        AddSplitTerms(terms, description);
        AddSplitTerms(terms, GetDefaultDomain(key));
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
            "revit.catalog.field-options" => """{ "key": "category-names" }""",
            "settings.schema" => """{ "schemaUrl": "/schemas/settings/CmdScheduleManager/schedules.json" }""",
            _ => "{}"
        };
    }

    private static HostOperationVisibility InferVisibilityFromKey(
        string key,
        HostOperationVisibility fallback
    ) {
        // Demotion rule (ADR 0003): a composed glance op that embeds a constituent's
        // handles hides that constituent from the default surface. revit.glance.model
        // carries project-index's totals, so project-index dropped to EscalationVisible.
        if (key is "revit.context.summary" or "revit.resolve.references"
            || key.StartsWith("revit.glance.", StringComparison.Ordinal))
            return HostOperationVisibility.DefaultVisible;
        // ExpertOnly = admin/plumbing surfaces (schema/field-option feeds for UIs,
        // cache admin) and heavy diagnostics; reachable only by explicit tier filter.
        // Rationale per key: ADR 0003 (read envelope and glance tier); open review items in docs/features/host/LEDGER.md.
        if (key is "revit.matrix.schedule-profiles"
            or "revit.catalog.electrical-load-classifications"
            or "revit.catalog.field-options"
            or "revit.apply.parameters-service-cache.refresh")
            return HostOperationVisibility.ExpertOnly;
        if (key.StartsWith("scripting.", StringComparison.Ordinal))
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
            || key.IndexOf("matrix", StringComparison.Ordinal) >= 0)
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
