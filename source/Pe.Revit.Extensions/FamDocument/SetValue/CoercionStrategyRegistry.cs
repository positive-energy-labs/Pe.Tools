using Pe.Extensions.FamDocument.SetValue.CoercionStrategies;

namespace Pe.Extensions.FamDocument.SetValue;

public enum BuiltInCoercionStrategy {
    Strict,
    CoerceByStorageType,
    CoerceMeasurableToNumber
}

/// <summary>
///     Registry for ParamCoercionStrategy implementations.
///     Allows runtime registration of custom coercion strategies and dynamic discovery of available strategies.
///     Strategies are cached as singletons for performance.
/// </summary>
public static class ParamCoercionStrategyRegistry {
    private static readonly Dictionary<string, ICoercionStrategy> _instances = new();
    private static readonly object _lock = new();

    static ParamCoercionStrategyRegistry() {
        Register(BuiltInCoercionStrategy.Strict.ToString(), new Strict());
        Register(BuiltInCoercionStrategy.CoerceByStorageType.ToString(), new CoerceByStorageType());

        // CoerceMeasurableToNumber with fallback to CoerceByStorageType
        // Tries unit conversion first, falls back to raw value copy if no mapping exists
        Register(BuiltInCoercionStrategy.CoerceMeasurableToNumber.ToString(), new CompositeStrategy(
            new CoerceMeasurableToNumber(),
            new CoerceByStorageType()
        ));

        Register("CoerceElectrical", new CoerceElectrical());
    }

    /// <summary>
    ///     Register a new coercion strategy instance (singleton).
    /// </summary>
    /// <param name="name">Strategy name (should match enum value for C# usage)</param>
    /// <param name="instance">Strategy instance to register</param>
    public static void Register(string name, ICoercionStrategy instance) {
        lock (_lock) _instances[name] = instance;
    }

    /// <summary>
    ///     Get a coercion strategy instance by name (cached singleton).
    /// </summary>
    /// <param name="name">Strategy name</param>
    /// <returns>Cached strategy instance</returns>
    /// <exception cref="KeyNotFoundException">Thrown if strategy name is not registered</exception>
    public static ICoercionStrategy Get(string name) {
        if (!_instances.TryGetValue(name, out var instance)) {
            throw new KeyNotFoundException(
                $"Coercion strategy '{name}' not found. Available strategies: {string.Join(", ", GetAllNames())}");
        }

        return instance;
    }

    /// <summary>
    ///     Get all registered strategy names.
    /// </summary>
    /// <returns>Collection of strategy names</returns>
    public static IEnumerable<string> GetAllNames() => _instances.Keys;
}

/// <summary>
///     Registry for ValueCoercionStrategy implementations.
///     Allows runtime registration of custom coercion strategies and dynamic discovery of available strategies.
///     Strategies are cached as singletons for performance.
/// </summary>
public static class ValueCoercionStrategyRegistry {
    private static readonly Dictionary<string, ICoercionStrategy> _instances = new();
    private static readonly object _lock = new();

    static ValueCoercionStrategyRegistry() {
        Register(BuiltInCoercionStrategy.Strict.ToString(), new Strict());
        Register(BuiltInCoercionStrategy.CoerceByStorageType.ToString(), new CoerceByStorageType());

        // CoerceMeasurableToNumber with fallback to CoerceByStorageType
        // Tries unit conversion first, falls back to raw value copy if no mapping exists
        Register(BuiltInCoercionStrategy.CoerceMeasurableToNumber.ToString(), new CompositeStrategy(
            new CoerceMeasurableToNumber(),
            new CoerceByStorageType()
        ));
    }

    /// <summary>
    ///     Register a new coercion strategy instance (singleton).
    /// </summary>
    /// <param name="name">Strategy name (should match enum value for C# usage)</param>
    /// <param name="instance">Strategy instance to register</param>
    public static void Register(string name, ICoercionStrategy instance) {
        lock (_lock) _instances[name] = instance;
    }

    /// <summary>
    ///     Get a coercion strategy instance by name (cached singleton).
    /// </summary>
    /// <param name="name">Strategy name</param>
    /// <returns>Cached strategy instance</returns>
    /// <exception cref="KeyNotFoundException">Thrown if strategy name is not registered</exception>
    public static ICoercionStrategy Get(string name) {
        if (!_instances.TryGetValue(name, out var instance)) {
            throw new KeyNotFoundException(
                $"Coercion strategy '{name}' not found. Available strategies: {string.Join(", ", GetAllNames())}");
        }

        return instance;
    }

    /// <summary>
    ///     Get all registered strategy names.
    /// </summary>
    /// <returns>Collection of strategy names</returns>
    public static IEnumerable<string> GetAllNames() => _instances.Keys;
}