using Newtonsoft.Json;
using Newtonsoft.Json.Converters;
using Newtonsoft.Json.Serialization;
using Pe.Shared.HostContracts.Operations;
using System.Reflection;

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

        var operations = ReadDefinitions()
            .Select(HostOpsCatalogEntry.FromDefinition)
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

    private static IReadOnlyList<HostOperationDefinition> ReadDefinitions() {
        var baseDirectory = AppContext.BaseDirectory;
        var resolverPaths = ((string)AppContext.GetData("TRUSTED_PLATFORM_ASSEMBLIES")!)
            .Split(Path.PathSeparator)
            .Concat(Directory.EnumerateFiles(baseDirectory, "*.dll"))
            .Concat(FindRevitReferenceAssemblies())
            .Distinct(StringComparer.OrdinalIgnoreCase);
        using var context = new MetadataLoadContext(new PathAssemblyResolver(resolverPaths));
        var definitions = new Dictionary<string, HostOperationDefinition>(StringComparer.Ordinal);
        foreach (var fileName in new[] {
                     "Pe.Shared.HostContracts.dll",
                     "Pe.Revit.Global.dll",
                     "Pe.Revit.Scripting.dll",
                     "Pe.App.dll"
                 }) {
            var assembly = context.LoadFromAssemblyPath(Path.Combine(baseDirectory, fileName));
            foreach (var method in assembly.GetTypes().SelectMany(type => type.GetMethods(
                         BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Static | BindingFlags.Instance))) {
                var data = method.GetCustomAttributesData()
                    .SingleOrDefault(attribute => attribute.AttributeType.FullName == typeof(OpAttribute).FullName);
                if (data == null)
                    continue;

                var attribute = OpRegistry.ReadAttribute(data);
                var requestType = ResolveRuntimeType(method.GetParameters()[0].ParameterType);
                var responseMetadataType = method.ReturnType.IsGenericType
                                           && method.ReturnType.GetGenericTypeDefinition().FullName == typeof(Task<>).FullName
                    ? method.ReturnType.GetGenericArguments()[0]
                    : method.ReturnType;
                var parameters = method.GetParameters();
                var documentParameter = parameters.Length > 1
                                        && parameters[1].ParameterType.FullName != typeof(CancellationToken).FullName
                    ? parameters[1].ParameterType
                    : null;
                var definition = OpRegistry.Define(
                    attribute,
                    requestType,
                    ResolveRuntimeType(responseMetadataType),
                    OpRegistry.GetNeeds(documentParameter));
                if (!definitions.TryAdd(definition.Key, definition))
                    throw new InvalidOperationException($"Bridge op '{definition.Key}' is registered twice.");
            }
        }

        return definitions.Values.ToArray();
    }

    private static Type ResolveRuntimeType(Type metadataType) {
        var assembly = Assembly.Load(metadataType.Assembly.GetName());
        return assembly.GetType(metadataType.FullName!, throwOnError: true)!;
    }

    private static IEnumerable<string> FindRevitReferenceAssemblies() {
        var packageRoot = Environment.GetEnvironmentVariable("NUGET_PACKAGES")
                          ?? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".nuget", "packages");
        foreach (var package in new[] { "nice3point.revit.api.revitapi", "nice3point.revit.api.revitapiui" }) {
            var root = Path.Combine(packageRoot, package);
            if (!Directory.Exists(root))
                continue;
            foreach (var path in Directory.EnumerateFiles(root, "*.dll", SearchOption.AllDirectories)
                         .Where(path => path.Contains($"{Path.DirectorySeparatorChar}2025.", StringComparison.OrdinalIgnoreCase))
                         .Where(path => path.Contains("net8.0-windows7.0", StringComparison.OrdinalIgnoreCase)))
                yield return path;
        }
    }
}
