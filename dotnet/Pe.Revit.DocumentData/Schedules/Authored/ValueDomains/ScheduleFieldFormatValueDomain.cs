using static Pe.Revit.Parameters.ParameterUnitResolver;

namespace Pe.Revit.DocumentData.Schedules.Authored.ValueDomains;

public sealed record ScheduleFormatValueOption(string Value, string Label);

public static class ScheduleFieldFormatValueDomain {
    public static IReadOnlyList<ScheduleFormatValueOption> GetUnitOptions() => UnitUtils.GetAllUnits()
        .Select(unitTypeId => CreateUnitOption(unitTypeId))
        .WhereNotNull()
        .GroupBy(item => item.Value, StringComparer.OrdinalIgnoreCase)
        .Select(group => group.First())
        .OrderBy(item => item.Label, StringComparer.OrdinalIgnoreCase)
        .ThenBy(item => item.Value, StringComparer.Ordinal)
        .ToList();

    public static IReadOnlyList<ScheduleFormatValueOption> GetSymbolOptions(string? unitValue = null) {
        if (!string.IsNullOrWhiteSpace(unitValue) && ResolveUnit(unitValue) is { } unitTypeId)
            return GetValidSymbols(unitTypeId)
                .Select(CreateSymbolOption)
                .WhereNotNull()
                .GroupBy(item => item.Value, StringComparer.OrdinalIgnoreCase)
                .Select(group => group.First())
                .OrderBy(item => item.Label, StringComparer.OrdinalIgnoreCase)
                .ThenBy(item => item.Value, StringComparer.Ordinal)
                .ToList();

        return UnitUtils.GetAllUnits()
            .SelectMany(GetValidSymbols)
            .GroupBy(symbol => symbol.TypeId, StringComparer.OrdinalIgnoreCase)
            .Select(group => CreateSymbolOption(group.First()))
            .WhereNotNull()
            .GroupBy(item => item.Value, StringComparer.OrdinalIgnoreCase)
            .Select(group => group.First())
            .OrderBy(item => item.Label, StringComparer.OrdinalIgnoreCase)
            .ThenBy(item => item.Value, StringComparer.Ordinal)
            .ToList();
    }

    public static ForgeTypeId? ResolveUnit(string? value) {
        if (string.IsNullOrWhiteSpace(value))
            return null;

        return UnitUtils.GetAllUnits()
            .FirstOrDefault(unitTypeId =>
                string.Equals(GetUnitLabel(unitTypeId), value, StringComparison.OrdinalIgnoreCase));
    }

    public static ForgeTypeId? ResolveSymbol(string? value, ForgeTypeId? unitTypeId = null) {
        if (string.IsNullOrWhiteSpace(value))
            return null;

        var candidates = unitTypeId != null && !unitTypeId.Empty()
            ? GetValidSymbols(unitTypeId)
            : UnitUtils.GetAllUnits().SelectMany(GetValidSymbols).GroupBy(symbol => symbol.TypeId).Select(group => group.First());

        return candidates.FirstOrDefault(symbolTypeId =>
            string.Equals(GetSymbolLabel(symbolTypeId), value, StringComparison.OrdinalIgnoreCase));
    }

    public static string? SerializeUnit(ForgeTypeId? unitTypeId) =>
        unitTypeId == null || unitTypeId.Empty() ? null : GetUnitLabel(unitTypeId);

    public static string? SerializeSymbol(ForgeTypeId? symbolTypeId) =>
        symbolTypeId == null || symbolTypeId.Empty() ? null : GetSymbolLabel(symbolTypeId);

    private static ScheduleFormatValueOption? CreateUnitOption(ForgeTypeId unitTypeId) {
        if (!IsUnit(unitTypeId))
            return null;

        var label = GetUnitLabel(unitTypeId);
        return string.IsNullOrWhiteSpace(label) ? null : new ScheduleFormatValueOption(label, label);
    }

    private static ScheduleFormatValueOption? CreateSymbolOption(ForgeTypeId symbolTypeId) {
        if (string.IsNullOrWhiteSpace(symbolTypeId.TypeId))
            return null;

        var label = GetSymbolLabel(symbolTypeId);
        return string.IsNullOrWhiteSpace(label) ? null : new ScheduleFormatValueOption(label, label);
    }

    private static bool IsUnit(ForgeTypeId unitTypeId) {
        try {
            return !string.IsNullOrWhiteSpace(unitTypeId.TypeId) && UnitUtils.IsUnit(unitTypeId);
        } catch {
            return false;
        }
    }

    private static IEnumerable<T> WhereNotNull<T>(this IEnumerable<T?> values) where T : class {
        foreach (var value in values) {
            if (value != null)
                yield return value;
        }
    }
}
