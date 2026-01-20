using System.Diagnostics;

namespace Pe.Extensions.FamDocument.SetValue.CoercionStrategies;

/// <summary>
///     Composite coercion strategy that tries multiple strategies in sequence.
///     Returns the result of the first strategy that can handle the conversion.
/// </summary>
public class CompositeStrategy : ICoercionStrategy {
    private readonly ICoercionStrategy[] _strategies;

    public CompositeStrategy(params ICoercionStrategy[] strategies) => this._strategies = strategies;

    public bool CanMap(CoercionContext context) {
        // DEBUG: Log which strategies are being checked
        foreach (var strategy in this._strategies) {
            var canMap = strategy.CanMap(context);
            Debug.WriteLine($"[CompositeStrategy] {strategy.GetType().Name}.CanMap = {canMap}");
            if (canMap) return true;
        }

        Debug.WriteLine("[CompositeStrategy] No strategy could handle the conversion");
        return false;
    }

    public Result<FamilyParameter> Map(CoercionContext context) {
        // Try each strategy in order until one succeeds
        foreach (var strategy in this._strategies) {
            if (strategy.CanMap(context))
                return strategy.Map(context);
        }

        // This shouldn't happen if CanMap returned true, but handle it anyway
        throw new InvalidOperationException(
            "No strategy could handle the conversion, but CanMap returned true");
    }
}