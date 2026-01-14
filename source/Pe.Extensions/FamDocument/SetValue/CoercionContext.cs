using Pe.Extensions.FamDocument.GetValue;

namespace Pe.Extensions.FamDocument.SetValue;

/// <summary>
///     Context object containing all data needed for parameter coercion strategies.
///     Supports both value-to-param and param-to-param mapping scenarios.
/// </summary>
public record CoercionContext {
    public required FamilyDocument FamilyDocument { get; init; }
    public required FamilyManager FamilyManager { get; init; }
    public required FamilyParameter TargetParam { get; init; }
    public required object SourceValue { get; init; }

    /// <summary>
    ///     The string representation of the source parameter's internally stored value.
    ///     Only populated for param-to-param mapping. Will be null for value-to-param mapping.
    /// </summary>
    public string? SourceValueString { get; init; }

    /// <summary>
    ///     The data type of the source parameter from FamilyParameter.Definition.GetDataType().
    ///     Only populated for param-to-param mapping. Will be null for value-to-param mapping.
    /// </summary>
    public ForgeTypeId? SourceDataType { get; init; }

    /// <summary>
    ///     The storage type of the source value, derived from the value's type.
    /// </summary>
    public StorageType SourceStorageType { get; init; }

    /// <summary>
    ///     The storage type of the target parameter from FamilyParameter.StorageType
    /// </summary>
    public StorageType TargetStorageType => this.TargetParam.StorageType;

    /// <summary>
    ///     The data type of the target parameter from FamilyParameter.Definition.GetDataType()
    /// </summary>
    public ForgeTypeId TargetDataType => this.TargetParam.Definition.GetDataType();

    /// <summary>
    ///     The unit type id of the target parameter.
    ///     Use this to convert the source value to the target parameter's internal storage type.
    ///     Cached for performance - computed once at context creation.
    ///     <code>
    /// var convertedVal = UnitUtils.ConvertToInternalUnits(sourceValue, context.TargetUnitType);
    /// context.FamilyDocument.SetValueStrict(context.TargetParam, convertedVal);
    /// </code>
    /// </summary>
    public ForgeTypeId? TargetUnitType { get; init; }

    /// <summary>
    ///     Factory method for creating a context from a direct value to target parameter mapping.
    /// </summary>
    public static CoercionContext FromValue(FamilyDocument doc, object sourceValue, FamilyParameter targetParam) =>
        new() {
            FamilyDocument = doc,
            FamilyManager = doc.FamilyManager,
            SourceValue = sourceValue,
            SourceStorageType = DeriveStorageTypeFromValue(sourceValue),
            TargetParam = targetParam,
            TargetUnitType = ComputeTargetUnitType(doc, targetParam)
        };

    private static StorageType DeriveStorageTypeFromValue(object value) =>
        value switch {
            double => StorageType.Double,
            int => StorageType.Integer,
            string => StorageType.String,
            ElementId => StorageType.ElementId,
            _ => StorageType.None
        };

    /// <summary>
    ///     Factory method for creating a context from a source parameter to target parameter mapping.
    /// </summary>
    public static CoercionContext FromParam(FamilyDocument doc,
        FamilyParameter sourceParam,
        FamilyParameter targetParam) =>
        new() {
            FamilyDocument = doc,
            FamilyManager = doc.FamilyManager,
            SourceValue = doc.GetValue(sourceParam),
            SourceValueString = doc.FamilyManager.CurrentType.AsValueString(sourceParam),
            SourceDataType = sourceParam.Definition.GetDataType(),
            SourceStorageType = sourceParam.StorageType,
            TargetParam = targetParam,
            TargetUnitType = ComputeTargetUnitType(doc, targetParam)
        };

    /// <summary>
    ///     Computes the target unit type for a parameter, handling exceptions gracefully.
    /// </summary>
    private static ForgeTypeId? ComputeTargetUnitType(FamilyDocument doc, FamilyParameter targetParam) {
        try {
            return doc.GetUnits()
                .GetFormatOptions(targetParam.Definition.GetDataType())
                .GetUnitTypeId();
        } catch {
            return null; // not a measurable spec identifier
        }
    }
}