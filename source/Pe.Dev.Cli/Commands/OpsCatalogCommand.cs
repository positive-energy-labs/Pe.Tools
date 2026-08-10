using Newtonsoft.Json;
using Newtonsoft.Json.Converters;
using Newtonsoft.Json.Serialization;
using Pe.Shared.HostContracts.Operations;

namespace Pe.Dev.Cli;

/// <summary>
///     Offline projection of the bridge op catalog — the same entries a live session's
///     host.ops.catalog serves, produced from the contracts assembly alone. Powers host-contracts
///     typegen without a running host; live sessions verify the projection (codegen:verify-live)
///     rather than generate it.
/// </summary>
internal static class OpsCatalogCommand {
    // Mirror of the bridge response serializer (BridgeAgent) so offline catalog JSON matches
    // what a live /ops round-trip yields: camelCase, string enums, nulls omitted.
    private static readonly JsonSerializerSettings JsonSettings = new() {
        NullValueHandling = NullValueHandling.Ignore,
        ContractResolver = new DefaultContractResolver {
            NamingStrategy = new CamelCaseNamingStrategy {
                ProcessDictionaryKeys = false,
                OverrideSpecifiedNames = false
            }
        },
        Converters = [new StringEnumConverter()]
    };

    public static async Task<int> RunAsync(IReadOnlyList<string> args) {
        string? outPath = null;
        for (var index = 0; index < args.Count; index++) {
            if (args[index] != "--out")
                continue;
            if (index + 1 >= args.Count) {
                Console.Error.WriteLine("Missing value for --out.");
                return 10;
            }

            outPath = args[index + 1];
        }

        BridgeOpRegistry.RegisterFrom(typeof(RevitBridgeOps).Assembly);
        // Handler-bound ops (definitions live in the contracts factories; Revit-side handlers are
        // bound in Pe.App at runtime). Stub handlers — only Definition feeds the catalog.
        BridgeOpRegistry.Register(FamilyModelHostOperations.Capture(
            (_, _, _) => throw new NotSupportedException("catalog projection only")));
        BridgeOpRegistry.Register(FamilyModelHostOperations.Build(
            (_, _, _) => throw new NotSupportedException("catalog projection only")));

        var operations = BridgeOpRegistry.All
            .Select(HostOpsCatalogEntry.FromOp)
            .OrderBy(entry => entry.Key, StringComparer.Ordinal)
            .ToArray();
        var json = JsonConvert.SerializeObject(
            new HostOpsCatalogData(operations),
            Formatting.Indented,
            JsonSettings
        );

        if (outPath == null) {
            Console.WriteLine(json);
        } else {
            var fullPath = Path.GetFullPath(outPath);
            Directory.CreateDirectory(Path.GetDirectoryName(fullPath)!);
            await File.WriteAllTextAsync(fullPath, json);
            Console.WriteLine($"Wrote {operations.Length} operations to {fullPath}");
        }

        return 0;
    }
}
