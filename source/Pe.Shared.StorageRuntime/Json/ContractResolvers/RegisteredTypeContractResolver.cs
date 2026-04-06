using Newtonsoft.Json;
using Newtonsoft.Json.Serialization;
using System.Reflection;

namespace Pe.Shared.StorageRuntime.Json.ContractResolvers;

public class RegisteredTypeContractResolver : OrderedContractResolver {
    private readonly JsonTypeSchemaBindingRegistry _bindingRegistry;

    public RegisteredTypeContractResolver(JsonTypeSchemaBindingRegistry? bindingRegistry = null) {
        this._bindingRegistry = bindingRegistry ?? JsonTypeSchemaBindingRegistry.Shared;
    }

    protected override JsonProperty CreateProperty(MemberInfo member, MemberSerialization memberSerialization) {
        var property = base.CreateProperty(member, memberSerialization);
        if (member is not PropertyInfo propertyInfo)
            return property;

        var targetType = ResolveTargetType(propertyInfo.PropertyType);
        if (!this.TryGetTypeBinding(targetType, out var binding))
            return property;

        var converter = binding.CreateConverter(propertyInfo);
        if (converter == null)
            return property;

        if (ShouldUseItemConverter(propertyInfo.PropertyType))
            property.ItemConverter = converter;
        else
            property.Converter = converter;

        return property;
    }

    protected virtual bool TryGetTypeBinding(Type type, out IJsonTypeSchemaBinding binding) =>
        this._bindingRegistry.TryGet(type, out binding!);

    protected static Type ResolveTargetType(Type propertyType) {
        var unwrappedType = Nullable.GetUnderlyingType(propertyType) ?? propertyType;
        if (unwrappedType.IsArray)
            return unwrappedType.GetElementType() ?? unwrappedType;

        if (!unwrappedType.IsGenericType)
            return unwrappedType;

        var genericTypeDefinition = unwrappedType.GetGenericTypeDefinition();
        if (genericTypeDefinition != typeof(List<>) &&
            genericTypeDefinition != typeof(IList<>) &&
            genericTypeDefinition != typeof(ICollection<>) &&
            genericTypeDefinition != typeof(IEnumerable<>) &&
            genericTypeDefinition != typeof(IReadOnlyList<>) &&
            genericTypeDefinition != typeof(IReadOnlyCollection<>)) {

            return unwrappedType;
        }


        return unwrappedType.GetGenericArguments()[0];
    }

    protected static bool ShouldUseItemConverter(Type propertyType) {
        var unwrappedType = Nullable.GetUnderlyingType(propertyType) ?? propertyType;
        if (unwrappedType.IsArray)
            return true;
        if (!unwrappedType.IsGenericType)
            return false;

        var genericTypeDefinition = unwrappedType.GetGenericTypeDefinition();
        return genericTypeDefinition == typeof(List<>) ||
               genericTypeDefinition == typeof(IList<>) ||
               genericTypeDefinition == typeof(ICollection<>) ||
               genericTypeDefinition == typeof(IEnumerable<>) ||
               genericTypeDefinition == typeof(IReadOnlyList<>) ||
               genericTypeDefinition == typeof(IReadOnlyCollection<>);
    }
}
