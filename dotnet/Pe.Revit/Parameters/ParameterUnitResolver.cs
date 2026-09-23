namespace Pe.Revit.Parameters;

/// <summary>
///     Resolves a caller-supplied unit string to a unit ForgeTypeId WITHIN a parameter's spec —
///     the closed-world validation that makes unit-aware value conversion exact: the only units
///     considered are <see cref="UnitUtils.GetValidUnits(ForgeTypeId)" /> for the spec, and the
///     conversion itself is Revit's own <see cref="UnitUtils.ConvertToInternalUnits" />. Accepted
///     spellings per unit: the ForgeTypeId typeId (with or without version suffix), the UnitTypeId
///     static member name ("CubicFeetPerMinute"), the localized unit label ("Cubic feet per
///     minute"), or any valid symbol label ("CFM"). No match and ambiguous matches both fail with
///     the full valid-unit vocabulary so callers can self-correct.
/// </summary>
public static class ParameterUnitResolver {

    public static ForgeTypeId Resolve(string unit, ForgeTypeId specTypeId) {
        var requested = unit.Trim();
        var validUnits = UnitUtils.GetValidUnits(specTypeId);
        var matches = validUnits
            .Where(unitTypeId => MatchesUnit(requested, unitTypeId))
            .GroupBy(unitTypeId => unitTypeId.TypeId, StringComparer.OrdinalIgnoreCase)
            .Select(group => group.First())
            .ToList();

        if (matches.Count == 1)
            return matches[0];

        // Symbol collisions like "in" (Inches vs Fractional inches) are formatting variants that
        // convert identically — immaterial for conversion, so they collapse to one unit. Only
        // matches with genuinely DIFFERENT conversion factors are ambiguous.
        if (matches.Count > 1) {
            var factors = matches
                .Select(unitTypeId => UnitUtils.ConvertToInternalUnits(1.0, unitTypeId))
                .Distinct()
                .ToList();
            if (factors.Count == 1)
                return matches[0];
        }

        var vocabulary = string.Join("; ", validUnits.Select(DescribeUnit));
        throw new InvalidOperationException(matches.Count == 0
            ? $"Unit '{requested}' is not valid for this parameter's spec. Valid units: {vocabulary}"
            : $"Unit '{requested}' is ambiguous within this parameter's spec ({string.Join(", ", matches.Select(GetUnitLabel))}) and the candidates convert differently. Use a typeId or exact label. Valid units: {vocabulary}");
    }

    private static bool MatchesUnit(string requested, ForgeTypeId unitTypeId) {
        var typeId = unitTypeId.TypeId;
        if (string.Equals(requested, typeId, StringComparison.OrdinalIgnoreCase))
            return true;

        // "autodesk.unit.unit:cubicFeetPerMinute-1.0.1" without the version suffix, and the bare
        // schema-less name after the colon.
        var versionless = typeId.Split('-')[0];
        if (string.Equals(requested, versionless, StringComparison.OrdinalIgnoreCase))
            return true;
        var colonIndex = versionless.LastIndexOf(':');
        if (colonIndex >= 0 &&
            string.Equals(requested, versionless[(colonIndex + 1)..], StringComparison.OrdinalIgnoreCase))
            return true;

        if (string.Equals(requested, GetStaticMemberName(typeof(UnitTypeId), unitTypeId), StringComparison.OrdinalIgnoreCase))
            return true;

        if (string.Equals(requested, GetUnitLabel(unitTypeId), StringComparison.OrdinalIgnoreCase))
            return true;

        return GetValidSymbols(unitTypeId)
            .Any(symbolTypeId => string.Equals(
                requested,
                GetSymbolLabel(symbolTypeId),
                StringComparison.OrdinalIgnoreCase));
    }

    private static string DescribeUnit(ForgeTypeId unitTypeId) {
        var label = GetUnitLabel(unitTypeId);
        var symbols = GetValidSymbols(unitTypeId)
            .Select(GetSymbolLabel)
            .Where(symbol => !string.IsNullOrWhiteSpace(symbol))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .Take(3)
            .ToList();
        return symbols.Count == 0 ? label : $"{label} ({string.Join(", ", symbols)})";
    }

    public static IEnumerable<ForgeTypeId> GetValidSymbols(ForgeTypeId unitTypeId) {
        try {
            return FormatOptions.GetValidSymbols(unitTypeId);
        } catch {
            return [];
        }
    }

    public static string GetUnitLabel(ForgeTypeId unitTypeId) {
        try {
            var label = LabelUtils.GetLabelForUnit(unitTypeId);
            if (!string.IsNullOrWhiteSpace(label))
                return label;
        } catch {
        }

        return GetStaticMemberName(typeof(UnitTypeId), unitTypeId) ?? unitTypeId.TypeId;
    }

    public static string GetSymbolLabel(ForgeTypeId symbolTypeId) {
        try {
            var label = LabelUtils.GetLabelForSymbol(symbolTypeId);
            if (!string.IsNullOrWhiteSpace(label))
                return label;
        } catch {
        }

        return GetStaticMemberName(typeof(SymbolTypeId), symbolTypeId) ?? symbolTypeId.TypeId;
    }

    private static string? GetStaticMemberName(Type type, ForgeTypeId forgeTypeId) {
        foreach (var property in type.GetProperties(BindingFlags.Public | BindingFlags.Static)) {
            if (property.PropertyType != typeof(ForgeTypeId))
                continue;

            if (property.GetValue(null) is ForgeTypeId value &&
                string.Equals(value.TypeId, forgeTypeId.TypeId, StringComparison.OrdinalIgnoreCase))
                return property.Name;
        }

        return null;
    }
}
