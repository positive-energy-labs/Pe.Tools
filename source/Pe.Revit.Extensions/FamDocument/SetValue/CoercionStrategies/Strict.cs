namespace Pe.Extensions.FamDocument.SetValue.CoercionStrategies;

/// <summary>
///     Strict coercion strategy - only allows mapping when source and target storage types match exactly.
/// </summary>
/// <exception cref="T:System.ArgumentException">Invalid value type</exception>
/// <exception cref="T:Autodesk.Revit.Exceptions.ArgumentException">
///     Thrown when the input argument-"targetParam"-is an invalid family parameter.
///     --or-- When the storage type of family parameter is not ElementId
///     --or-- The input ElementId does not represent either a valid element in the document or InvalidElementId.
/// </exception>
/// <exception cref="T:Autodesk.Revit.Exceptions.ArgumentOutOfRangeException">
///     Thrown when the input argument-"targetParam"-is out of range.
///     --or-- Thrown when the input ElementId is not valid as a value for this FamilyParameter.
/// </exception>
/// <exception cref="T:Autodesk.Revit.Exceptions.InvalidOperationException">
///     Thrown when the family parameter is determined by formula,
///     or the current family type is invalid.
/// </exception>
public class Strict : ICoercionStrategy {
    public bool CanMap(CoercionContext context) =>
        context.SourceStorageType == context.TargetStorageType;

    public Result<FamilyParameter> Map(CoercionContext context) {
        var fm = context.FamilyManager;
        var target = context.TargetParam;

        switch (context.SourceValue) {
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
            return new ArgumentException($"Invalid type of value to set ({context.SourceValue.GetType().Name})");
        }
    }
}