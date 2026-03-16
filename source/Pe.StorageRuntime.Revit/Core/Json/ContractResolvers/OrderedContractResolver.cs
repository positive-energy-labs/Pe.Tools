using Newtonsoft.Json;
using Newtonsoft.Json.Serialization;
using System.Reflection;

namespace Pe.StorageRuntime.Revit.Core.Json.ContractResolvers;

public class OrderedContractResolver : DefaultContractResolver {
    protected override IList<JsonProperty> CreateProperties(Type type, MemberSerialization memberSerialization) {
        var properties = base.CreateProperties(type, memberSerialization);

        var typeHierarchy = new List<Type>();
        var currentType = type;
        while (currentType != null && currentType != typeof(object)) {
            typeHierarchy.Insert(0, currentType);
            currentType = currentType.BaseType;
        }

        var orderedProperties = new List<JsonProperty>();
        var seenProperties = new HashSet<JsonProperty>();

        foreach (var current in typeHierarchy) {
            var declaredProps = current.GetProperties(
                    BindingFlags.Public |
                    BindingFlags.Instance |
                    BindingFlags.DeclaredOnly
                )
                .OrderBy(property => property.MetadataToken)
                .ToList();

            foreach (var declaredProp in declaredProps) {
                var jsonProp = properties.FirstOrDefault(property => property.UnderlyingName == declaredProp.Name);
                if (jsonProp != null && !seenProperties.Contains(jsonProp)) {
                    _ = seenProperties.Add(jsonProp);
                    orderedProperties.Add(jsonProp);
                }
            }
        }

        return orderedProperties;
    }
}