using Newtonsoft.Json;
using Newtonsoft.Json.Serialization;
using Pe.StorageRuntime.Json;
using Pe.StorageRuntime.Revit.Core.Json.Converters;
using System.Collections;
using System.ComponentModel.DataAnnotations;
using System.Reflection;
using System.Runtime.CompilerServices;

namespace Pe.StorageRuntime.Revit.Core.Json.ContractResolvers;

public class RequiredAwareContractResolver : RevitTypeContractResolver {
    private readonly Dictionary<Type, object> _defaultInstanceCache = new();

    protected override JsonProperty CreateProperty(MemberInfo member, MemberSerialization memberSerialization) {
        var property = base.CreateProperty(member, memberSerialization);

        if (property.PropertyType == null || member is not PropertyInfo propInfo)
            return property;

        this.ApplyUniformChildKeySerialization(property, propInfo);

        if (this.IsRequiredProperty(propInfo)) {
            property.DefaultValueHandling = DefaultValueHandling.Include;
            return property;
        }

        var declaringType = propInfo.DeclaringType;
        if (declaringType == null)
            return property;

        var defaultInstance = this.GetOrCreateDefaultInstance(declaringType);
        if (defaultInstance == null) {
            property.DefaultValueHandling = DefaultValueHandling.Ignore;
            return property;
        }

        var defaultValue = this.GetDefaultValue(propInfo, defaultInstance);
        property.ShouldSerialize = instance => {
            var actualValue = propInfo.GetValue(instance);
            return !this.AreValuesEqual(actualValue, defaultValue, propInfo.PropertyType);
        };

        return property;
    }

    private void ApplyUniformChildKeySerialization(JsonProperty property, PropertyInfo propertyInfo) {
        var uniformAttr = propertyInfo.GetCustomAttribute<UniformChildKeysAttribute>();
        if (uniformAttr == null || property.PropertyType == typeof(string))
            return;
        if (!typeof(IEnumerable).IsAssignableFrom(property.PropertyType))
            return;

        property.Converter = new UniformChildKeysListConverter(uniformAttr.MissingValue);
    }

    private bool IsRequiredProperty(PropertyInfo propertyInfo) =>
        propertyInfo.GetCustomAttribute<RequiredAttribute>() != null ||
        propertyInfo.GetCustomAttribute<RequiredMemberAttribute>() != null;

    private object? GetOrCreateDefaultInstance(Type type) {
        if (this._defaultInstanceCache.TryGetValue(type, out var cached))
            return cached;

        var instance = DefaultInstanceFactory.TryCreateDefaultInstance(type);
        if (instance != null)
            this._defaultInstanceCache[type] = instance;
        return instance;
    }

    private object? GetDefaultValue(PropertyInfo propertyInfo, object? defaultInstance) {
        try {
            return defaultInstance == null ? null : propertyInfo.GetValue(defaultInstance);
        } catch {
            return null;
        }
    }

    private bool AreValuesEqual(object? value1, object? value2, Type propertyType) {
        if (value1 == null && value2 == null)
            return true;
        if (value1 == null || value2 == null)
            return false;

        if (value1 is IEnumerable enum1 && value2 is IEnumerable enum2) {
            if (value1 is string || value2 is string)
                return Equals(value1, value2);

            var list1 = enum1.Cast<object>().ToList();
            var list2 = enum2.Cast<object>().ToList();

            if (list1.Count != list2.Count)
                return false;
            if (list1.Count == 0 && list2.Count == 0)
                return true;

            return list1.SequenceEqual(list2);
        }

        var comparerType = typeof(EqualityComparer<>).MakeGenericType(propertyType);
        var defaultComparer = comparerType.GetProperty("Default", BindingFlags.Public | BindingFlags.Static)
            ?.GetValue(null);
        if (defaultComparer == null)
            return Equals(value1, value2);

        var equalsMethod = comparerType.GetMethod("Equals", new[] { propertyType, propertyType });
        if (equalsMethod != null)
            return (bool)(equalsMethod.Invoke(defaultComparer, new[] { value1, value2 }) ?? false);

        return Equals(value1, value2);
    }
}