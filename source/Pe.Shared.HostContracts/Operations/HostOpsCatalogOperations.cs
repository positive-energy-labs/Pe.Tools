namespace Pe.Shared.HostContracts.Operations;

/// <summary>
///     The runtime operation catalog op: every bridge op this session supports, with JSON Schemas
///     generated from the C# request/response types (see <see cref="BridgeOpSchemaGenerator" />).
///     Serves the TS host's GET /ops endpoint. The catalog is a pure projection of the registry —
///     the same entries are produced offline by `pe-dev ops-catalog` for typegen, and a live
///     session is used to VERIFY that projection (codegen:verify-live), not to generate it.
/// </summary>
internal static class HostOpsCatalogOperations {
    [Op("host.ops.catalog", Does = "List every bridge operation this Revit session supports, with JSON Schemas for request and response payloads.", Title = "Get Host Operations Catalog", Finds = ["operations", "catalog", "schema", "discovery", "typegen"])]
    public static Task<HostOpsCatalogData> GetHostOpsCatalogAsync(
        NoRequest request,
        CancellationToken cancellationToken
    ) {
        var operations = OpRegistry.All
            .Select(HostOpsCatalogEntry.FromOp)
            .OrderBy(entry => entry.Key, StringComparer.Ordinal)
            .ToArray();
        return Task.FromResult(new HostOpsCatalogData(operations));
    }
}
