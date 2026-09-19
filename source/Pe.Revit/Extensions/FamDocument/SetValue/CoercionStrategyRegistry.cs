using Pe.Revit.Extensions.FamDocument.SetValue.CoercionStrategies;
using Pe.Shared.RevitData.Families;

namespace Pe.Revit.Extensions.FamDocument.SetValue;

/// <summary>
///     Registry for ParamCoercionStrategy implementations.
///     Allows runtime registration of custom coercion strategies and dynamic discovery of available strategies.
///     Strategies are cached as singletons for performance.
/// </summary>
public static class ParamCoercionStrategyRegistry {
    private static readonly Dictionary<string, ICoercionStrategy> _instances = new();
    private static readonly object _lock = new();

    static ParamCoercionStrategyRegistry() {
        Register(MappingStrategy.Strict.ToString(), new Strict());
        Register(MappingStrategy.CoerceByStorageType.ToString(), new CoerceByStorageType());

        // CoerceMeasurableToNumber with fallback to CoerceByStorageType
        // Tries unit conversion first, falls back to raw value copy if no mapping exists
        Register(MappingStrategy.CoerceMeasurableToNumber.ToString(), new CompositeStrategy(
            new CoerceMeasurableToNumber(),
            new CoerceByStorageType()
        ));

        Register(nameof(MappingStrategy.CoerceElectrical), new CoerceElectrical());
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

    // Only these convert through explicit units, so only these may carry a value across a data-type change. The registered
    // CoerceMeasurableToNumber falls back to a raw storage copy; its unit-aware stage alone is honest there.
    private static readonly Dictionary<string, ICoercionStrategy> UnitAwareInstances = new(StringComparer.Ordinal) {
        ["CoerceElectrical"] = new CoerceElectrical(),
        [nameof(MappingStrategy.CoerceMeasurableToNumber)] = new CoerceMeasurableToNumber()
    };

    /// <summary>The unit-aware stage of a registered strategy, or null when the strategy is unit-blind (Strict, CoerceByStorageType).</summary>
    public static ICoercionStrategy? UnitAware(string name) => UnitAwareInstances.GetValueOrDefault(name);
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
        Register(MappingStrategy.Strict.ToString(), new Strict());
        Register(MappingStrategy.CoerceByStorageType.ToString(), new CoerceByStorageType());

        // CoerceMeasurableToNumber with fallback to CoerceByStorageType
        // Tries unit conversion first, falls back to raw value copy if no mapping exists
        Register(MappingStrategy.CoerceMeasurableToNumber.ToString(), new CompositeStrategy(
            new CoerceMeasurableToNumber(),
            new CoerceByStorageType()
        ));

        Register(nameof(MappingStrategy.CoerceElectrical), new CoerceElectrical());
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
