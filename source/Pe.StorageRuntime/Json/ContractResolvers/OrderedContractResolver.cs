using Newtonsoft.Json;
using Newtonsoft.Json.Serialization;
using System.Reflection;

namespace Pe.StorageRuntime.Json.ContractResolvers;

public class OrderedContractResolver : DefaultContractResolver {
    protected override IList<JsonProperty> CreateProperties(Type type, MemberSerialization memberSerialization) {
        var properties = base.CreateProperties(type, memberSerialization);
        var typeHierarchy = CreateTypeHierarchy(type);
        var interfaceOrder = CreateInterfaceOrderMap(type);
        var hierarchyOrder = typeHierarchy
            .Select((currentType, index) => new { currentType, index })
            .ToDictionary(item => item.currentType, item => item.index);
        var declarationOrder = CreateDeclarationOrderMap(typeHierarchy);

        return properties
            .OrderBy(property => property.Order ?? int.MaxValue)
            .ThenBy(property => GetOriginBucket(property, interfaceOrder))
            .ThenBy(property => GetInterfaceIndex(property, interfaceOrder))
            .ThenBy(property => GetHierarchyIndex(property, hierarchyOrder))
            .ThenBy(property => GetDeclarationIndex(property, declarationOrder))
            .ToList();
    }

    private static IReadOnlyList<Type> CreateTypeHierarchy(Type type) {
        var hierarchy = new List<Type>();
        var currentType = type;
        while (currentType != null && currentType != typeof(object)) {
            hierarchy.Insert(0, currentType);
            currentType = currentType.BaseType;
        }

        return hierarchy;
    }

    private static IReadOnlyDictionary<string, int> CreateInterfaceOrderMap(Type type) {
        var interfaces = type
            .GetInterfaces()
            .OrderBy(GetInterfaceDepth)
            .ThenBy(iface => iface.FullName, StringComparer.Ordinal)
            .ToList();
        var interfaceOrder = new Dictionary<string, int>(StringComparer.Ordinal);

        for (var i = 0; i < interfaces.Count; i++) {
            foreach (var property in interfaces[i].GetProperties()) {
                if (!interfaceOrder.ContainsKey(property.Name))
                    interfaceOrder[property.Name] = i;
            }
        }

        return interfaceOrder;
    }

    private static IReadOnlyDictionary<(Type DeclaringType, string MemberName), int> CreateDeclarationOrderMap(
        IEnumerable<Type> typeHierarchy
    ) {
        var declarationOrder = new Dictionary<(Type DeclaringType, string MemberName), int>();

        foreach (var currentType in typeHierarchy) {
            var members = currentType
                .GetMembers(BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.DeclaredOnly)
                .Where(member => member.MemberType is MemberTypes.Property or MemberTypes.Field)
                .OrderBy(member => member.MetadataToken)
                .ToList();

            for (var i = 0; i < members.Count; i++)
                declarationOrder[(currentType, members[i].Name)] = i;
        }

        return declarationOrder;
    }

    private static int GetOriginBucket(
        JsonProperty property,
        IReadOnlyDictionary<string, int> interfaceOrder
    ) {
        var memberName = GetMemberName(property);
        if (memberName != null && interfaceOrder.ContainsKey(memberName))
            return 0;
        if (property.DeclaringType != null)
            return 1;

        return 2;
    }

    private static int GetInterfaceIndex(
        JsonProperty property,
        IReadOnlyDictionary<string, int> interfaceOrder
    ) {
        var memberName = GetMemberName(property);
        if (memberName == null)
            return int.MaxValue;

        return interfaceOrder.TryGetValue(memberName, out var order)
            ? order
            : int.MaxValue;
    }

    private static int GetHierarchyIndex(
        JsonProperty property,
        IReadOnlyDictionary<Type, int> hierarchyOrder
    ) {
        if (property.DeclaringType == null)
            return int.MaxValue;

        return hierarchyOrder.TryGetValue(property.DeclaringType, out var order)
            ? order
            : int.MaxValue;
    }

    private static int GetDeclarationIndex(
        JsonProperty property,
        IReadOnlyDictionary<(Type DeclaringType, string MemberName), int> declarationOrder
    ) {
        if (property.DeclaringType == null)
            return int.MaxValue;

        var memberName = GetMemberName(property);
        if (memberName == null)
            return int.MaxValue;

        return declarationOrder.TryGetValue((property.DeclaringType, memberName), out var order)
            ? order
            : int.MaxValue;
    }

    private static int GetInterfaceDepth(Type interfaceType) =>
        interfaceType.GetInterfaces().Length;

    private static string? GetMemberName(JsonProperty property) =>
        property.UnderlyingName ?? property.PropertyName;
}
