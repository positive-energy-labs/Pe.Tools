using Pe.Shared.RevitData.Families;

namespace Pe.Revit.Extensions.FamDocument.SetValue;

/// <summary>A mapping's declared `mappingUnit` (<see cref="MappingUnits" />) as the Revit unit its bare source numbers are read in.</summary>
public static class MappingUnit {
    /// <summary>The Revit unit <paramref name="symbol" /> names for <paramref name="spec" />; throws naming the legal units when it is none.</summary>
    public static ForgeTypeId Resolve(ForgeTypeId spec, string symbol) {
        var leaf = MappingUnits.Leaf(spec.TypeId);
        if (MappingUnits.Refusal(leaf, symbol) is { } why) throw new ArgumentException(why);
        var unit = (ForgeTypeId)typeof(UnitTypeId).GetProperty(MappingUnits.Find(leaf, symbol)!.RevitName)!.GetValue(null)!;
        if (UnitUtils.GetValidUnits(spec).All(valid => valid.TypeId != unit.TypeId))
            throw new ArgumentException($"'{symbol}' ({unit.TypeId}) is not a unit Revit accepts for {spec.TypeId}.");
        return unit;
    }

    public static string Hint(FamilyParameter destination) =>
        MappingUnits.Hint(destination.Definition.Name, MappingUnits.Leaf(destination.Definition.GetDataType().TypeId));
}

/// <summary>A bare number reached a measured destination with no declared unit: reported by name, never guessed, never a family refusal.</summary>
public sealed class MissingUnitException(string message) : ArgumentException(message);
