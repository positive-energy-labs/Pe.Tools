namespace Pe.Shared.HostContracts.Operations;

public enum HostExecutionMode {
    Local,
    Bridge
}

public enum HostHttpVerb {
    Get,
    Post
}

public sealed record HostOperationDefinition(
    string Key,
    HostHttpVerb Verb,
    string Route,
    HostExecutionMode ExecutionMode,
    Type RequestType,
    Type ResponseType,
    string? DisplayName = null
) {
    public static HostOperationDefinition Create<TRequest, TResponse>(
        string key,
        HostHttpVerb verb,
        string route,
        HostExecutionMode executionMode,
        string? displayName = null
    ) => new(
        key,
        verb,
        route,
        executionMode,
        typeof(TRequest),
        typeof(TResponse),
        displayName
    );
}

public sealed record NoRequest;
