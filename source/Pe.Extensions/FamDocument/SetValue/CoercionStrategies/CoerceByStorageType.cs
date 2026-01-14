using Pe.Extensions.FamDocument.SetValue.Utils;

namespace Pe.Extensions.FamDocument.SetValue.CoercionStrategies;

/// <summary>
///     Storage type coercion strategy - handles cases where storage types differ but data types are compatible.
///     Implements comprehensive storage type conversions based on Revit's parameter system.
/// </summary>
public class CoerceByStorageType : ICoercionStrategy {
    public bool CanMap(CoercionContext context) {
        // Same storage type - always compatible
        if (context.SourceStorageType == context.TargetStorageType)
            return true;

        // Check cross-storage-type conversions      
        return (context.SourceStorageType, context.TargetStorageType) switch {
            (StorageType.Integer, StorageType.String) => true,
            (StorageType.Integer, StorageType.Double) => true,
            (StorageType.Double, StorageType.String) => true,
            (StorageType.Double, StorageType.Integer) => true,
            (StorageType.String, StorageType.Integer) => Regexes.TryExtractInteger(
                context.SourceValue.ToString(), out _),
            (StorageType.String, StorageType.Double) => Regexes.TryExtractDouble(
                context.SourceValue.ToString(), out _),
            _ => false
        };
    }

    public Result<FamilyParameter> Map(CoercionContext context) {
        var convertedValue = (context.SourceStorageType, context.TargetStorageType) switch {
            // Same type - no conversion needed
            _ when context.SourceStorageType == context.TargetStorageType => context.SourceValue,

            // There is only one relevant SpecTypeId that stores as an integer: SpecTypeId.Int.Integer. 
            // Int.NumberOfPoles & Boolean.YesNo do too, but we can assume 
            // 1) that the user will not attempt this conversion and 2) that these are already "properly" set.
            (StorageType.Integer, StorageType.Double) => UnitUtils.ConvertToInternalUnits(
                context.SourceValue as int? ?? 0, context.TargetUnitType),

            // Safe to simply .ToString() on the integerParam's value
            (StorageType.Integer, StorageType.String) => context.SourceValue.ToString(),

            // Try to use the SourceValueString if it is available, otherwise fall back to ToString()
            (StorageType.Double, StorageType.String) => context.SourceValueString ?? context.SourceValue.ToString(),

            // Set to integer by extracting integer from the doubleParam's "value string"
            (StorageType.Double, StorageType.Integer) =>
                Regexes.ExtractInteger(context.SourceValueString ?? string.Empty),

            // Set to integer by extracting integer from the stringParam's value
            (StorageType.String, StorageType.Integer) =>
                Regexes.ExtractInteger(context.SourceValue.ToString() ?? string.Empty),

            // Set to double by extracting double from the stringParam's value
            (StorageType.String, StorageType.Double) =>
                Regexes.ExtractDouble(context.SourceValue.ToString() ?? string.Empty),

            _ => throw new ArgumentException(
                $"Unsupported storage type conversion from {context.SourceStorageType} to {context.TargetStorageType}")
        };

        // Inline the Strict strategy to avoid recursive SetValue call
        var fm = context.FamilyManager;
        var target = context.TargetParam;

        switch (convertedValue) {
        case double doubleValue:
            fm.Set(target, doubleValue);
            return target;
        case int intValue:
            fm.Set(target, intValue);
            return target;
        case string stringValue:
            fm.Set(target, stringValue);
            return target;
        case ElementId elementIdValue:
            fm.Set(target, elementIdValue);
            return target;
        default:
            return new ArgumentException($"Invalid type of value to set ({convertedValue?.GetType().Name ?? "null"})");
        }
    }
}