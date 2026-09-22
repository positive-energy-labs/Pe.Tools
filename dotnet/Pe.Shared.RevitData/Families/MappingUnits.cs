namespace Pe.Shared.RevitData.Families;

/// <summary>
///     The units a mapping may declare as `mappingUnit` (ruling 2026-09-19: "always map, and always be careful of implicit units bc project
///     units are a bitch and hidden"), keyed by spec leaf (`autodesk.spec.aec.hvac:power-2.0.0` → `power`; hvac and piping pressure share
///     theirs). Each names the Revit `UnitTypeId` property it resolves to; the first is the sample a hint offers. `FamilyReconcilerTests.
///     Mapping_units_resolve_to_units_revit_accepts_for_every_spec_of_their_leaf` (Pe.Revit.Tests) pins every entry against Revit in a session.
/// </summary>
public static class MappingUnits {
    public sealed record Unit(string Symbol, string RevitName, params string[] Aliases);

    private static readonly Unit[] Length = [new("in", "Inches"), new("ft", "Feet"), new("mm", "Millimeters"), new("cm", "Centimeters"), new("m", "Meters")];
    private static readonly Unit[] Power = [
        new("Btu/h", "BritishThermalUnitsPerHour", "BTUH"), new("MBH", "ThousandBritishThermalUnitsPerHour"), new("W", "Watts"),
        new("kW", "Kilowatts"), new("ton", "TonsOfRefrigeration")
    ];
    private static readonly Unit[] Pressure = [
        new("in-wg", "InchesOfWater60DegreesFahrenheit", "inH2O"), new("Pa", "Pascals"), new("kPa", "Kilopascals"), new("psi", "PoundsForcePerSquareInch")
    ];
    private static readonly Unit[] Temperature = [new("°F", "Fahrenheit", "F"), new("°C", "Celsius", "C"), new("K", "Kelvin")];

    public static readonly IReadOnlyDictionary<string, Unit[]> ByLeaf = new Dictionary<string, Unit[]>(StringComparer.Ordinal) {
        ["length"] = Length, ["pipeSize"] = Length, ["ductSize"] = Length,
        ["area"] = [new("ft²", "SquareFeet", "ft2", "SF"), new("in²", "SquareInches", "in2"), new("m²", "SquareMeters", "m2")],
        ["volume"] = [new("ft³", "CubicFeet", "ft3", "CF"), new("m³", "CubicMeters", "m3"), new("L", "Liters"), new("gal", "UsGallons")],
        ["angle"] = [new("°", "Degrees", "deg"), new("rad", "Radians")],
        ["power"] = Power, ["heatingLoad"] = Power, ["coolingLoad"] = Power, ["heatGain"] = Power,
        ["wattage"] = [new("W", "Watts"), new("kW", "Kilowatts")],
        ["potential"] = [new("V", "Volts"), new("kV", "Kilovolts"), new("mV", "Millivolts")],
        ["current"] = [new("A", "Amperes"), new("mA", "Milliamperes"), new("kA", "Kiloamperes")],
        ["apparentPower"] = [new("VA", "VoltAmperes"), new("kVA", "KilovoltAmperes")],
        ["frequency"] = [new("Hz", "Hertz")],
        ["airFlow"] = [new("CFM", "CubicFeetPerMinute"), new("L/s", "LitersPerSecond"), new("m³/h", "CubicMetersPerHour", "m3/h")],
        ["flow"] = [new("GPM", "UsGallonsPerMinute"), new("L/s", "LitersPerSecond"), new("m³/h", "CubicMetersPerHour", "m3/h")],
        ["pressure"] = Pressure,
        ["temperature"] = Temperature,
        ["velocity"] = [new("FPM", "FeetPerMinute"), new("m/s", "MetersPerSecond")]
    };

    /// <summary>`autodesk.spec.aec.hvac:power-2.0.0` → `power`.</summary>
    public static string Leaf(string specTypeId) {
        var colon = specTypeId.LastIndexOf(':');
        var leaf = colon >= 0 ? specTypeId.Substring(colon + 1) : specTypeId;
        var dash = leaf.IndexOf('-');
        return dash > 0 ? leaf.Substring(0, dash) : leaf;
    }

    public static string Leaf(DataType dataType) => dataType switch {
        DataType.ElectricalPotential => "potential",
        DataType.PipingFlow => "flow",
        DataType.HvacVelocity => "velocity",
        _ => char.ToLowerInvariant(dataType.ToString()[0]) + dataType.ToString().Substring(1)
    };

    /// <summary>The destination's spec leaf as the document declares it, or null when only the shared definition knows it.</summary>
    public static string? Leaf(FamilyModelParameter parameter) =>
        parameter.SharedSpecId is { } spec ? Leaf(spec) : parameter.DataType is { } dataType ? Leaf(dataType) : null;

    public static Unit? Find(string leaf, string symbol) =>
        ByLeaf.TryGetValue(leaf, out var units)
            ? units.FirstOrDefault(unit => unit.Aliases.Prepend(unit.Symbol).Contains(symbol.Trim(), StringComparer.OrdinalIgnoreCase))
            : null;

    /// <summary>Why <paramref name="symbol" /> is not a mapping unit of <paramref name="leaf" />, or null when it is.</summary>
    public static string? Refusal(string leaf, string symbol) =>
        !ByLeaf.TryGetValue(leaf, out var units) ? $"'{symbol}' is not a unit of {leaf}: {leaf} takes no mappingUnit."
        : Find(leaf, symbol) is null ? $"'{symbol}' is not a unit of {leaf}. Legal: {string.Join(", ", units.Select(unit => $"\"{unit.Symbol}\""))}."
        : null;

    /// <summary>What a bare number needs, e.g. `declare mappingUnit on 'PE_M___BoilerOutput' (a unit of power, e.g. "Btu/h")`.</summary>
    public static string Hint(string destination, string leaf) =>
        $"declare mappingUnit on '{destination}' ({(ByLeaf.TryGetValue(leaf, out var units) ? $"a unit of {leaf}, e.g. \"{units[0].Symbol}\"" : $"no mappingUnit is defined for {leaf} yet")})";
}
