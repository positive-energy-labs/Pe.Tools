namespace Pe.Shared.HostContracts.Operations;

public enum HostClientRequestPolicy {
    None,
    Explicit
}

public sealed record HostTypeScriptClientOperation(
    string MethodName,
    HostOperationDefinition Definition,
    HostClientRequestPolicy RequestPolicy
);

public sealed record HostTypeScriptClientGroup(
    string GroupKey,
    string ClientPropertyName,
    string ClientClassName,
    IReadOnlyList<HostTypeScriptClientOperation> Operations
);

public sealed record HostTypeScriptClientCatalog(
    IReadOnlyList<HostTypeScriptClientGroup> Groups
);
