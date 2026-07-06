using Pe.Shared.HostContracts.Operations;

namespace Pe.Revit.Global.Services.Host;

/// <summary>
///     The runtime operation catalog: every bridge op this session supports, with JSON Schemas
///     generated from the C# request/response types (see <see cref="BridgeOpSchemaGenerator" />).
///     Serves the TS host's GET /ops endpoint and the browser typegen — the running Revit
///     session is the source of truth, not codegen output.
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
            .Select(CreateEntry)
            .OrderBy(entry => entry.Key, StringComparer.Ordinal)
            .ToArray();
        return Task.FromResult(new HostOpsCatalogData(operations));
    }

    private static HostOpsCatalogEntry CreateEntry(BridgeOp op) {
        var definition = op.Definition;
        var metadata = definition.AgentMetadata;
        return new HostOpsCatalogEntry(
            definition.Key,
            definition.DisplayName,
            metadata.Intent.ToString(),
            metadata.CostTier.ToString(),
            metadata.Visibility.ToString(),
            metadata.RequiresActiveDocument,
            metadata.Description,
            metadata.SearchTerms,
            metadata.RequestExamples,
            metadata.SafeDefaultRequestJson,
            metadata.CallGuidance,
            BridgeOpSchemaGenerator.GetRequestSchemaJson(definition.RequestType),
            BridgeOpSchemaGenerator.GetResponseSchemaJson(definition.ResponseType)
        );
    }
}
