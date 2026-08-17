namespace Pe.Shared.HostContracts.Operations;

/// <summary>
///     The runtime operation catalog op: every bridge op this session supports, with JSON Schemas
///     generated from the C# request/response types (see <see cref="BridgeOpSchemaGenerator" />).
///     Serves the TS host's GET /ops endpoint. The catalog is a pure projection of the registry —
///     the same entries are produced offline by `pe-dev ops-catalog` for typegen, and a live
///     session is used to VERIFY that projection (codegen:verify-live), not to generate it.
/// </summary>
internal static class HostOpsCatalogOperations {
    [BridgeOperation(
        "host.ops.catalog",
        DisplayName = "Get Host Operations Catalog",
        Description =
            "List every bridge operation this Revit session supports, with JSON Schemas for request and response payloads.",
        SearchTerms = ["operations", "catalog", "schema", "discovery", "typegen"],
        RequiresActiveDocument = false
    )]
    public static Task<HostOpsCatalogData> GetHostOpsCatalogAsync(
        NoRequest request,
        IBridgeOperationContext context,
        CancellationToken cancellationToken
    ) {
        var operations = BridgeOpRegistry.All
            .Select(HostOpsCatalogEntry.FromOp)
            .OrderBy(entry => entry.Key, StringComparer.Ordinal)
            .ToArray();
        return Task.FromResult(new HostOpsCatalogData(operations));
    }
}
