using Pe.Shared.ApsAuth;
using Pe.Shared.HostContracts.Operations;
using Pe.Shared.RevitData;
using Pe.Shared.StorageRuntime;

namespace Pe.Dev.Cli.Codegen;

internal static class HostContractExportModelProvider {
    public static GeneratedHostTypeModel Load() {
        var sourceAssemblies = LoadSourceAssemblies();

        // Open generic definitions have no concrete wire shape. Operations expose
        // concrete contracts; exclude any annotated generic from the schema/type surface.
        var exportedTypes = sourceAssemblies
            .SelectMany(assembly => assembly.GetTypes())
            .Where(IsTypeScriptExportedType)
            .Where(type => !string.IsNullOrWhiteSpace(type.FullName))
            .Where(type => !type.IsGenericTypeDefinition && !type.ContainsGenericParameters)
            .GroupBy(type => type.FullName!, StringComparer.Ordinal)
            .ToDictionary(group => group.Key, group => group.First().Name, StringComparer.Ordinal);

        return new GeneratedHostTypeModel(exportedTypes);
    }

    public static IReadOnlyList<Type> ResolveExportedTypes(
        IReadOnlyDictionary<string, string> exportedTypeNames
    ) => LoadSourceAssemblies()
        .SelectMany(assembly => assembly.GetTypes())
        .Where(IsTypeScriptExportedType)
        .Where(type => type.FullName != null && exportedTypeNames.ContainsKey(type.FullName))
        .ToArray();

    private static IEnumerable<System.Reflection.Assembly> LoadSourceAssemblies() => [
        typeof(HostOperationsCatalog).Assembly,
        typeof(ApsTokenRequest).Assembly,
        typeof(GlobalStorage).Assembly,
        typeof(RevitDataIssue).Assembly
    ];

    private static bool IsTypeScriptExportedType(Type type) =>
        type.CustomAttributes.Any(attribute =>
            attribute.AttributeType.FullName == "Pe.Shared.Codegen.ExportTsSchemaAttribute"
        );

    internal sealed record GeneratedHostTypeModel(
        IReadOnlyDictionary<string, string> ExportedTypeNames
    );
}
