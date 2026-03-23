using System.Reflection;

namespace Pe.StorageRuntime.Json;

public static class DefaultInstanceFactory {
    public static object? TryCreateDefaultInstance(Type type) {
        try {
            return Activator.CreateInstance(type);
        } catch {
            try {
                var constructors = type.GetConstructors(BindingFlags.Public | BindingFlags.Instance);
                var constructor = constructors.OrderBy(c => c.GetParameters().Length).FirstOrDefault();
                if (constructor == null)
                    return null;

                var parameters = constructor.GetParameters();
                var paramValues = new object?[parameters.Length];
                for (var i = 0; i < parameters.Length; i++) {
                    var paramType = parameters[i].ParameterType;
                    paramValues[i] = paramType.IsValueType ? Activator.CreateInstance(paramType) : null;
                }

                return constructor.Invoke(paramValues);
            } catch {
                return null;
            }
        }
    }
}