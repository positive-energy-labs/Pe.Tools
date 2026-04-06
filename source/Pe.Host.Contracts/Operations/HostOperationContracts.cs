namespace Pe.Host.Contracts.Operations;

public enum HostExecutionMode {
    Local,
    Bridge
}

public enum HostHttpVerb {
    Get,
    Post
}

public sealed record HostCachePolicy(
    string Name,
    int? TtlSeconds = null
);

public sealed record HostOperationDefinition(
    string Key,
    HostHttpVerb Verb,
    string Route,
    HostExecutionMode ExecutionMode,
    Type RequestType,
    Type ResponseType,
    string? DisplayName = null,
    HostCachePolicy? CachePolicy = null
) {
    public static HostOperationDefinition Create<TRequest, TResponse>(
        string key,
        HostHttpVerb verb,
        string route,
        HostExecutionMode executionMode,
        string? displayName = null,
        HostCachePolicy? cachePolicy = null
    ) => new(
        key,
        verb,
        route,
        executionMode,
        typeof(TRequest),
        typeof(TResponse),
        displayName,
        cachePolicy
    );
}

public interface IHostDataEnvelope {
    bool Ok { get; }
    string Message { get; }

    object? GetData();
}

public interface IHostDataEnvelope<out TData> : IHostDataEnvelope {
    TData? Data { get; }
}

public sealed record NoRequest;