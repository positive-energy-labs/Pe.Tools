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

public enum HostOperationResultGrain {
    Status,
    Summary,
    Schema,
    Catalog,
    Matrix,
    Rows,
    Handles,
    Detail,
    Workspace,
    Document,
    Logs,
    Token,
    Mutation
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

public enum HostOperationIntentVerb {
    Orient,
    Find,
    Inventory,
    Inspect,
    Audit,
    Script,
    Configure,
    Authenticate,
    Diagnose,
    Mutate
}

public enum HostOperationRequestShapeKind {
    NoRequest,
    CommonEnvelope,
    QueryWrapper,
    Flat,
    Command,
    LegacyException
}

public sealed record HostOperationRequestExample(
    string Name,
    string Description,
    string Json
);

public sealed record HostOperationAgentMetadata(
    string Domain,
    string Summary,
    IReadOnlyList<string> Tags,
    HostOperationIntent Intent,
    bool RequiresBridge,
    bool RequiresActiveDocument,
    IReadOnlyList<RevitActiveDocumentKind> SupportedActiveDocumentKinds,
    HostOperationFamily Family,
    RevitOperationLayer? RevitLayer,
    string DomainNoun,
    HostOperationResultGrain ResultGrain,
    HostOperationCostTier CostTier,
    string? SingleFlightGroup,
    IReadOnlyList<HostOperationRequestExample> RequestExamples,
    IReadOnlyList<string> BoundedExpansionHints,
    string? HandleProvenanceNotes,
    bool StrictRequestValidation,
    HostOperationVisibility Visibility,
    string CanonicalUse,
    HostOperationIntentVerb IntentVerb,
    HostOperationRequestShapeKind RequestShapeKind,
    IReadOnlyList<string> UseWhen,
    IReadOnlyList<string> DoNotUseWhen,
    IReadOnlyList<string> UsuallyBefore,
    IReadOnlyList<string> UsuallyAfter,
    IReadOnlyList<string> NextOperations,
    IReadOnlyList<string> AnswersQuestionTypes,
    IReadOnlyList<string> DoesNotAnswer,
    IReadOnlyList<string> PrimaryNouns,
    IReadOnlyList<string> SupportedScopes,
    IReadOnlyList<string> Capabilities,
    string? SafeDefaultRequestJson,
    string? AmbiguityBehavior
) {
    public static HostOperationAgentMetadata Create(
        string domain,
        string summary,
        IReadOnlyList<string>? tags = null,
        HostOperationIntent intent = HostOperationIntent.Read,
        bool requiresBridge = false,
        bool requiresActiveDocument = false,
        IReadOnlyList<RevitActiveDocumentKind>? supportedActiveDocumentKinds = null,
        HostOperationFamily? family = null,
        RevitOperationLayer? revitLayer = null,
        string? domainNoun = null,
        HostOperationResultGrain? resultGrain = null,
        HostOperationCostTier? costTier = null,
        string? singleFlightGroup = null,
        IReadOnlyList<HostOperationRequestExample>? requestExamples = null,
        IReadOnlyList<string>? boundedExpansionHints = null,
        string? handleProvenanceNotes = null,
        bool strictRequestValidation = true,
        HostOperationVisibility? visibility = null,
        string? canonicalUse = null,
        HostOperationIntentVerb? intentVerb = null,
        HostOperationRequestShapeKind? requestShapeKind = null,
        IReadOnlyList<string>? useWhen = null,
        IReadOnlyList<string>? doNotUseWhen = null,
        IReadOnlyList<string>? usuallyBefore = null,
        IReadOnlyList<string>? usuallyAfter = null,
        IReadOnlyList<string>? nextOperations = null,
        IReadOnlyList<string>? answersQuestionTypes = null,
        IReadOnlyList<string>? doesNotAnswer = null,
        IReadOnlyList<string>? primaryNouns = null,
        IReadOnlyList<string>? supportedScopes = null,
        IReadOnlyList<string>? capabilities = null,
        string? safeDefaultRequestJson = null,
        string? ambiguityBehavior = null
    ) => new(
        domain,
        summary,
        tags ?? Array.Empty<string>(),
        intent,
        requiresBridge,
        requiresActiveDocument,
        supportedActiveDocumentKinds ?? Array.Empty<RevitActiveDocumentKind>(),
        family ?? InferFamily(domain),
        revitLayer,
        domainNoun ?? domain,
        resultGrain ?? InferResultGrain(intent),
        costTier ?? InferCostTier(intent, requiresBridge),
        singleFlightGroup ?? (requiresBridge ? "revit" : null),
        requestExamples ?? Array.Empty<HostOperationRequestExample>(),
        boundedExpansionHints ?? Array.Empty<string>(),
        handleProvenanceNotes,
        strictRequestValidation,
        visibility ?? HostOperationVisibility.EscalationVisible,
        canonicalUse ?? summary,
        intentVerb ?? InferIntentVerb(intent),
        requestShapeKind ?? HostOperationRequestShapeKind.Flat,
        useWhen ?? Array.Empty<string>(),
        doNotUseWhen ?? Array.Empty<string>(),
        usuallyBefore ?? Array.Empty<string>(),
        usuallyAfter ?? Array.Empty<string>(),
        nextOperations ?? Array.Empty<string>(),
        answersQuestionTypes ?? Array.Empty<string>(),
        doesNotAnswer ?? Array.Empty<string>(),
        primaryNouns ?? Array.Empty<string>(),
        supportedScopes ?? Array.Empty<string>(),
        capabilities ?? Array.Empty<string>(),
        safeDefaultRequestJson,
        ambiguityBehavior
    );

    private static HostOperationFamily InferFamily(string domain) => domain switch {
        "host" => HostOperationFamily.Host,
        "settings" => HostOperationFamily.Settings,
        "script" or "scripting" => HostOperationFamily.Script,
        "revit" or "revit-data" or "electrical" => HostOperationFamily.Revit,
        "aps" => HostOperationFamily.Aps,
        _ => HostOperationFamily.Host
    };

    private static HostOperationResultGrain InferResultGrain(HostOperationIntent intent) =>
        intent == HostOperationIntent.Mutate
            ? HostOperationResultGrain.Mutation
            : HostOperationResultGrain.Summary;

    private static HostOperationIntentVerb InferIntentVerb(HostOperationIntent intent) =>
        intent == HostOperationIntent.Mutate
            ? HostOperationIntentVerb.Mutate
            : HostOperationIntentVerb.Inspect;

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
            ResultGrain = InferResultGrainFromKey(key, metadata.ResultGrain),
            CostTier = InferCostTierFromKey(key, metadata.CostTier),
            SingleFlightGroup = metadata.SingleFlightGroup ?? (metadata.RequiresBridge ? "revit" : null),
            Visibility = InferVisibilityFromKey(key, metadata.Visibility),
            IntentVerb = InferIntentVerbFromKey(key, metadata.IntentVerb),
            RequestShapeKind = InferRequestShapeKind(metadata.RequestShapeKind, requestType),
            CanonicalUse = metadata.CanonicalUse == metadata.Summary ? InferCanonicalUseFromKey(key, metadata.CanonicalUse) : metadata.CanonicalUse,
            UseWhen = DefaultIfEmpty(metadata.UseWhen, InferUseWhenFromKey(key)),
            DoNotUseWhen = DefaultIfEmpty(metadata.DoNotUseWhen, InferDoNotUseWhenFromKey(key)),
            UsuallyBefore = DefaultIfEmpty(metadata.UsuallyBefore, InferUsuallyBeforeFromKey(key)),
            UsuallyAfter = DefaultIfEmpty(metadata.UsuallyAfter, InferUsuallyAfterFromKey(key)),
            NextOperations = DefaultIfEmpty(metadata.NextOperations, InferNextOperationsFromKey(key)),
            PrimaryNouns = DefaultIfEmpty(metadata.PrimaryNouns, InferPrimaryNounsFromKey(key)),
            Capabilities = DefaultIfEmpty(metadata.Capabilities, InferCapabilitiesFromKey(key)),
            SafeDefaultRequestJson = metadata.SafeDefaultRequestJson ?? InferSafeDefaultRequestJson(key, requestType),
            AmbiguityBehavior = metadata.AmbiguityBehavior ?? InferAmbiguityBehaviorFromKey(key)
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

    private static string InferCanonicalUseFromKey(string key, string fallback) => key switch {
        "revit.context.summary" => "Orient to the current Revit document, active view/sheet, selection, and session state.",
        "revit.context.visible-summary" => "Inspect visible active-view contents after context.summary shows the active view matters.",
        "revit.catalog.project-index" => "Build broad semantic model inventory across levels, sheets, views, schedules, categories, and families.",
        "revit.catalog.project-browser" => "Read Project Browser folder/path organization for human navigation and provenance.",
        "revit.resolve.references" => "Resolve fuzzy human references to stable Revit handles before detail or matrix calls.",
        "revit.catalog.schedules" => "Inventory schedules, fields, filters, placements, and sheet role before detail/matrix calls.",
        "revit.detail.schedules" => "Inspect known schedule rows, cells, values, and row-to-element handles.",
        "revit.matrix.schedule-coverage" => "Audit element-to-schedule coverage, omissions, duplicates, and reverse membership.",
        "revit.catalog.loaded-families" => "Inventory loaded families, types, categories, and placed counts.",
        "revit.matrix.loaded-families" => "Audit family/type placement and parameter-presence matrices after catalog narrowing.",
        "revit.catalog.parameter-bindings" => "Inventory project/shared parameter bindings and category availability.",
        "revit.matrix.parameter-coverage" => "Audit missing, blank, default, or present parameter values across scoped elements.",
        _ => fallback
    };

    private static IReadOnlyList<string> InferUseWhenFromKey(string key) => key switch {
        "revit.context.summary" => ["Use first for broad Revit questions, current model context, active view/sheet, selection, or open document state."],
        "revit.context.visible-summary" => ["Use when the question says visible, current view contents, on screen, in this view, category counts, or samples."],
        "revit.catalog.project-index" => ["Use for broad semantic inventory: levels, sheets, views, schedules, families, categories, and quick project sense."],
        "revit.catalog.project-browser" => ["Use when the question asks about Project Browser organization, folders, paths, issued/working/archive navigation, or where a user would find something."],
        "revit.resolve.references" => ["Use for fuzzy phrases like this view, selected equipment, that schedule, printed mech Level 1, or the equipment schedule."],
        "revit.catalog.schedules" => ["Use for schedule inventory, definitions, placements, fields, filters, browser paths, and sheet placement."],
        "revit.detail.schedules" => ["Use for rows, cells, field values, or row data in a known or resolved schedule."],
        "revit.matrix.schedule-coverage" => ["Use for missing from schedule, scheduled vs unscheduled, covered, duplicated, omitted, or are all elements scheduled questions."],
        "revit.catalog.loaded-families" => ["Use for families, types, loaded content, placed or unused family inventory."],
        "revit.matrix.loaded-families" => ["Use for placed vs loaded, unused types, duplicate-looking families/types, or family/type parameter comparisons."],
        "revit.catalog.parameter-bindings" => ["Use for project/shared parameter binding, category binding, or whether a parameter is available on a category."],
        "revit.matrix.parameter-coverage" => ["Use for missing, blank, default, or completeness audits for parameters on scoped elements."],
        _ => []
    };

    private static IReadOnlyList<string> InferDoNotUseWhenFromKey(string key) => key switch {
        "revit.context.visible-summary" => ["Do not use for whole-model inventory or when the active sheet is only a printed container."],
        "revit.catalog.project-browser" => ["Do not infer BIM facts from folder names alone; use semantic catalog/detail/matrix operations for facts."],
        "revit.detail.schedules" => ["Do not use to discover candidate schedules; use revit.catalog.schedules first."],
        "revit.matrix.schedule-coverage" => ["Do not use for simple schedule inventory; use revit.catalog.schedules first."],
        "revit.matrix.loaded-families" => ["Do not use for simple family inventory; use revit.catalog.loaded-families first."],
        "revit.matrix.parameter-coverage" => ["Do not use to discover whether a parameter is bound; use revit.catalog.parameter-bindings first."],
        _ => []
    };

    private static IReadOnlyList<string> InferUsuallyBeforeFromKey(string key) => key switch {
        "revit.context.summary" => ["revit.context.visible-summary", "revit.catalog.project-index", "revit.resolve.references"],
        "revit.catalog.project-index" => ["revit.catalog.schedules", "revit.catalog.loaded-families", "revit.catalog.project-browser"],
        "revit.catalog.schedules" => ["revit.detail.schedules", "revit.matrix.schedule-coverage", "revit.matrix.schedule-profiles"],
        "revit.catalog.loaded-families" => ["revit.matrix.loaded-families", "revit.detail.elements"],
        "revit.catalog.parameter-bindings" => ["revit.matrix.parameter-coverage"],
        _ => []
    };

    private static IReadOnlyList<string> InferUsuallyAfterFromKey(string key) => key switch {
        "revit.context.visible-summary" => ["revit.context.summary"],
        "revit.catalog.project-browser" => ["revit.context.summary", "revit.catalog.project-index"],
        "revit.detail.schedules" => ["revit.catalog.schedules", "revit.resolve.references"],
        "revit.matrix.schedule-coverage" => ["revit.catalog.schedules"],
        "revit.matrix.loaded-families" => ["revit.catalog.loaded-families"],
        "revit.matrix.parameter-coverage" => ["revit.catalog.parameter-bindings", "revit.detail.elements"],
        _ => []
    };

    private static IReadOnlyList<string> InferNextOperationsFromKey(string key) => InferUsuallyBeforeFromKey(key);

    private static IReadOnlyList<string> InferPrimaryNounsFromKey(string key) {
        var parts = key.Split('.');
        return parts.Length >= 3 && parts[0] == "revit" ? [parts[2]] : [];
    }

    private static IReadOnlyList<string> InferCapabilitiesFromKey(string key) => key switch {
        "revit.catalog.project-index" => ["semantic-inventory", "levels", "sheets", "views", "schedules", "families", "categories"],
        "revit.catalog.project-browser" => ["browser-paths", "folder-vocabulary", "navigation-provenance", "nearest-matches"],
        "revit.catalog.schedules" => ["schedule-fields", "filters", "sheet-placement", "browser-provenance", "row-counts"],
        "revit.detail.schedules" => ["schedule-rows", "cell-values", "row-element-handles"],
        "revit.matrix.schedule-coverage" => ["coverage", "reverse-membership", "missing-samples"],
        "revit.matrix.parameter-coverage" => ["parameter-presence", "blank-values", "default-values", "sample-handles"],
        _ => []
    };

    private static string? InferSafeDefaultRequestJson(string key, Type requestType) {
        if (requestType == typeof(NoRequest))
            return null;
        return key switch {
            "revit.catalog.project-index" => """{ "projection": { "view": "Summary" }, "budget": { "maxEntries": 10, "maxSamplesPerEntry": 3 } }""",
            "revit.catalog.project-browser" => """{ "view": "Folders", "budget": { "maxSamplesPerEntry": 5 } }""",
            "revit.catalog.schedules" => """{ "projection": { "view": "Summary" }, "budget": { "maxEntries": 25 } }""",
            "revit.catalog.loaded-families" => """{ "filter": { "placementScope": "PlacedOnly" }, "projection": { "view": "Summary" }, "budget": { "maxEntries": 25 } }""",
            "revit.catalog.parameter-bindings" => """{ "projection": { "view": "Summary" }, "budget": { "maxEntries": 50 } }""",
            _ => "{}"
        };
    }

    private static string? InferAmbiguityBehaviorFromKey(string key) => key.StartsWith("revit.resolve.", StringComparison.Ordinal)
        ? "Return grouped candidates with confidence and provenance; do not guess silently."
        : key.StartsWith("revit.catalog.project-browser", StringComparison.Ordinal)
            ? "Return nearest folder/path matches when exact browser filters miss."
            : null;

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

    private static HostOperationResultGrain InferResultGrainFromKey(
        string key,
        HostOperationResultGrain fallback
    ) {
        if (key.Contains(".catalog.", StringComparison.Ordinal)
            || key.StartsWith("revit.catalog.", StringComparison.Ordinal))
            return HostOperationResultGrain.Catalog;
        if (key.Contains(".matrix.", StringComparison.Ordinal)
            || key.StartsWith("revit.matrix.", StringComparison.Ordinal))
            return HostOperationResultGrain.Matrix;
        if (key.Contains(".detail.", StringComparison.Ordinal)
            || key.StartsWith("revit.detail.", StringComparison.Ordinal))
            return HostOperationResultGrain.Detail;
        if (key.Contains(".resolve.", StringComparison.Ordinal)
            || key.StartsWith("revit.resolve.", StringComparison.Ordinal))
            return HostOperationResultGrain.Handles;
        if (key.Contains("summary", StringComparison.Ordinal)
            || key.StartsWith("revit.context.", StringComparison.Ordinal))
            return HostOperationResultGrain.Summary;
        if (key.Contains("schema", StringComparison.Ordinal))
            return HostOperationResultGrain.Schema;
        if (key.Contains("logs", StringComparison.Ordinal))
            return HostOperationResultGrain.Logs;
        if (key.Contains("token", StringComparison.Ordinal))
            return HostOperationResultGrain.Token;

        return fallback;
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

    private static HostOperationIntentVerb InferIntentVerbFromKey(
        string key,
        HostOperationIntentVerb fallback
    ) {
        if (key.StartsWith("revit.context.", StringComparison.Ordinal))
            return HostOperationIntentVerb.Orient;
        if (key.StartsWith("revit.resolve.", StringComparison.Ordinal))
            return HostOperationIntentVerb.Find;
        if (key.StartsWith("revit.catalog.", StringComparison.Ordinal))
            return HostOperationIntentVerb.Inventory;
        if (key.StartsWith("revit.detail.", StringComparison.Ordinal))
            return HostOperationIntentVerb.Inspect;
        if (key.StartsWith("revit.matrix.", StringComparison.Ordinal))
            return HostOperationIntentVerb.Audit;
        if (key.StartsWith("script.", StringComparison.Ordinal))
            return HostOperationIntentVerb.Script;
        if (key.StartsWith("settings.", StringComparison.Ordinal))
            return HostOperationIntentVerb.Configure;
        if (key.StartsWith("aps.auth.", StringComparison.Ordinal))
            return HostOperationIntentVerb.Authenticate;
        if (key.Contains("logs", StringComparison.Ordinal) || key.StartsWith("host.", StringComparison.Ordinal))
            return HostOperationIntentVerb.Diagnose;

        return fallback;
    }

    private static HostOperationRequestShapeKind InferRequestShapeKind(
        HostOperationRequestShapeKind fallback,
        Type requestType
    ) {
        if (requestType == typeof(NoRequest))
            return HostOperationRequestShapeKind.NoRequest;
        var names = new HashSet<string>(requestType.GetProperties().Select(property => property.Name), StringComparer.OrdinalIgnoreCase);
        if (names.Contains("Projection") || names.Contains("Budget"))
            return HostOperationRequestShapeKind.CommonEnvelope;
        if (names.Contains("Query") || names.Contains("Request") || names.Contains("Filter"))
            return HostOperationRequestShapeKind.QueryWrapper;
        return fallback;
    }

    private static HostOperationCostTier InferCostTierFromKey(
        string key,
        HostOperationCostTier fallback
    ) {
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
