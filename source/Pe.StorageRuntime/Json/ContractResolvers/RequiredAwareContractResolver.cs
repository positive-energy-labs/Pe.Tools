using Newtonsoft.Json;
using Newtonsoft.Json.Serialization;
using Pe.StorageRuntime.Json;
using Pe.StorageRuntime.Json.Converters;
using System.Collections;
using System.ComponentModel.DataAnnotations;
using System.Reflection;

namespace Pe.StorageRuntime.Json.ContractResolvers;

public class RequiredAwareContractResolver : RegisteredTypeContractResolver {
    private readonly Dictionary<Type, object> _defaultInstanceCache = new();
    private readonly HashSet<Type> _defaultInstanceCreationFailures = [];

    public RequiredAwareContractResolver(JsonTypeSchemaBindingRegistry? bindingRegistry = null)
        : base(bindingRegistry) {
    }

    protected override JsonProperty CreateProperty(MemberInfo member, MemberSerialization memberSerialization) {
        var property = base.CreateProperty(member, memberSerialization);

        if (property.PropertyType == null || member is not PropertyInfo propertyInfo)
            return property;

        ApplyUniformChildKeySerialization(property, propertyInfo);

        var requirement = GetRequirementKind(propertyInfo);
        if (requirement != RequiredPropertyKind.None) {
            ApplyRequiredSerialization(property, requirement);
            return property;
        }

        var declaringType = propertyInfo.DeclaringType;
        if (declaringType == null)
            return property;

        var defaultInstance = this.GetOrCreateDefaultInstance(declaringType);
        if (defaultInstance == null)
            return property;

        var defaultValue = GetDefaultValue(propertyInfo, defaultInstance);
        property.ShouldSerialize = instance => {
            var actualValue = propertyInfo.GetValue(instance);
            return !AreValuesEqual(actualValue, defaultValue, propertyInfo.PropertyType);
        };

        return property;
    }

    private static void ApplyUniformChildKeySerialization(JsonProperty property, PropertyInfo propertyInfo) {
        var uniformAttribute = propertyInfo.GetCustomAttribute<UniformChildKeysAttribute>();
        if (uniformAttribute == null || property.PropertyType == typeof(string))
            return;
        if (!typeof(IEnumerable).IsAssignableFrom(property.PropertyType))
            return;

        property.Converter = new UniformChildKeysListConverter(uniformAttribute.MissingValue);
    }

    private static RequiredPropertyKind GetRequirementKind(PropertyInfo propertyInfo) {
        if (propertyInfo.GetCustomAttribute<RequiredAttribute>() != null)
            return RequiredPropertyKind.ValidationRequired;
        if (HasRequiredMemberAttribute(propertyInfo))
            return RequiredPropertyKind.InitializationRequired;

        return RequiredPropertyKind.None;
    }

    private static bool HasRequiredMemberAttribute(PropertyInfo propertyInfo) =>
        propertyInfo.CustomAttributes.Any(attributeData =>
            string.Equals(
                attributeData.AttributeType.FullName,
                "System.Runtime.CompilerServices.RequiredMemberAttribute",
                StringComparison.Ordinal
            )
        );

    private static void ApplyRequiredSerialization(JsonProperty property, RequiredPropertyKind requirement) {
        property.DefaultValueHandling = DefaultValueHandling.Include;
        property.NullValueHandling = NullValueHandling.Include;
        property.Required = Required.AllowNull;
    }

    private object? GetOrCreateDefaultInstance(Type type) {
        if (this._defaultInstanceCache.TryGetValue(type, out var cached))
            return cached;
        if (this._defaultInstanceCreationFailures.Contains(type))
            return null;

        var instance = DefaultInstanceFactory.TryCreateDefaultInstance(type);
        if (instance == null) {
            _ = this._defaultInstanceCreationFailures.Add(type);
            return null;
        }

        this._defaultInstanceCache[type] = instance;
        return instance;
    }

    private static object? GetDefaultValue(PropertyInfo propertyInfo, object defaultInstance) {
        try {
            return propertyInfo.GetValue(defaultInstance);
        } catch {
            return null;
        }
    }

    private static bool AreValuesEqual(object? value1, object? value2, Type propertyType) {
        if (value1 == null && value2 == null)
            return true;
        if (value1 == null || value2 == null)
            return false;

        if (value1 is IEnumerable enumerable1 && value2 is IEnumerable enumerable2) {
            if (value1 is string || value2 is string)
                return Equals(value1, value2);

            var list1 = enumerable1.Cast<object?>().ToList();
            var list2 = enumerable2.Cast<object?>().ToList();

            if (list1.Count != list2.Count)
                return false;

            return list1.SequenceEqual(list2);
        }

        var comparerType = typeof(EqualityComparer<>).MakeGenericType(propertyType);
        var defaultComparer = comparerType
            .GetProperty("Default", BindingFlags.Public | BindingFlags.Static)
            ?.GetValue(null);
        if (defaultComparer == null)
            return Equals(value1, value2);

        var equalsMethod = comparerType.GetMethod("Equals", [propertyType, propertyType]);
        if (equalsMethod != null)
            return (bool)(equalsMethod.Invoke(defaultComparer, [value1, value2]) ?? false);

        return Equals(value1, value2);
    }

    private enum RequiredPropertyKind {
        None,
        ValidationRequired,
        InitializationRequired
    }
}
