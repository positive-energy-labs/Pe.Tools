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
    string? DisplayName = null
) {
    public HostHttpVerb Verb =>
        this.Http?.Verb
        ?? throw new InvalidOperationException($"Host operation '{this.Key}' is not publicly routable.");

    public string Route =>
        this.Http?.Route
        ?? throw new InvalidOperationException($"Host operation '{this.Key}' is not publicly routable.");

    public bool IsPublicHttp => this.Exposure == HostOperationExposure.PublicHttp;

    public static HostOperationDefinition Create<TRequest, TResponse>(
        string key,
        HostHttpVerb verb,
        string route,
        HostExecutionMode executionMode,
        string? displayName = null
    ) => new(
        key,
        executionMode,
        HostOperationExposure.PublicHttp,
        typeof(TRequest),
        typeof(TResponse),
        new HostHttpOperationDescriptor(verb, route),
        displayName
    );

    public static HostOperationDefinition CreateInternal<TRequest, TResponse>(
        string key,
        HostExecutionMode executionMode,
        string? displayName = null
    ) => new(
        key,
        executionMode,
        HostOperationExposure.InternalHostOnly,
        typeof(TRequest),
        typeof(TResponse),
        null,
        displayName
    );
}

public sealed record NoRequest;
