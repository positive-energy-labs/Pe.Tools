namespace Pe.Shared.RevitData.Ducts;

// What the Pe loss server computes when a fitting carries a table instead of its own coefficient (pressure-drop
// ledger, 2026-10-12: the server owns junctions and transitions; Revit's table route is gone). Revit-free so the
// numbers are pinned beside the web's loss-grid.ts and loss-rules.ts, which price the same fittings for the view.

/// <summary>One connector as Revit hands it to the server: Index (-1 is a takeoff's own branch), flow and area in Revit internal units.</summary>
public sealed record LossLeg(int Index, double Flow, double Area, bool Round, string Direction);

/// <summary>One leg Revit prices: the connector pair of a `DuctFittingAndAccessoryPressureDropItem`.</summary>
public sealed record LossItem(int Begin, int End);

/// <summary>ASHRAE grid interpolation, row for row with the web's `lookupGrid`: linear in 1-D, bilinear in 2-D, clamped at the edges.</summary>
public static class AshraeLookup {
    public static double Value(AshraeGrid g, double x, double? y = null) {
        // The loss server prices one- and two-axis tables; a three-axis grid (ER5-1, ED5-3) is the web's to look up.
        if (g.Z is not null) throw new ArgumentException($"{g.Title}: a three-axis table ({g.ZLabel}) the loss server does not price");
        if (g.X.Count == 0) return Flat(g)[0];
        if (g.Y is null) return Interp(x, g.X, Flat(g), g.XLabel);
        if (y is null || double.IsNaN(y.Value)) throw new ArgumentException($"{g.Title} needs {g.YLabel ?? "y"}");
        var rows = g.Grid as IReadOnlyList<IReadOnlyList<double>> ?? throw new ArgumentException($"{g.Title}: grid rows are not numbers");
        var column = rows.Select(row => Interp(x, g.X, row, g.XLabel)).ToList();
        return Interp(y.Value, g.Y, column, g.YLabel ?? "y");
    }

    private static IReadOnlyList<double> Flat(AshraeGrid g) =>
        g.Grid as IReadOnlyList<double> ?? throw new ArgumentException($"{g.Title}: grid is not a number row");

    private static double Interp(double x, IReadOnlyList<double> xs, IReadOnlyList<double> ys, string label) {
        if (double.IsNaN(x)) throw new ArgumentException($"{label} is not a number");
        var last = xs.Count - 1;
        if (x <= xs[0]) return ys[0];
        if (x >= xs[last]) return ys[last];
        for (var k = 0; k < last; k++)
            if (xs[k] <= x && x <= xs[k + 1]) {
                var t = (x - xs[k]) / (xs[k + 1] - xs[k]);
                return ys[k] + t * (ys[k + 1] - ys[k]);
            }
        throw new InvalidOperationException($"{label} {x} is not on an ascending axis");
    }
}

/// <summary>
///     The coefficient for one priced leg of a fitting under one ASHRAE table, from the legs Revit reports. The
///     velocity pressure a coefficient multiplies is Revit's own per item; the web charges a tap's straight leg on
///     the main's downstream Pv and a transition on its outlet Pv, and whether Revit agrees is a session proof.
/// </summary>
public sealed record LossPrice(double? Coefficient, string? Error) {
    public bool Success => Coefficient.HasValue;
}

public static class DuctFittingPricing {
    public const string Transition = "Transition";
    private static LossPrice Unknown(string reason) => new(null, reason);
    private static LossPrice Known(double coefficient) => Finite(coefficient) && coefficient >= 0
        ? new(coefficient, null) : Unknown("The table returned a negative or non-finite coefficient");
    private static bool Finite(double value) => !double.IsNaN(value) && !double.IsInfinity(value);

    /// <summary>Unknown/unsupported inputs are failures, distinct from a known zero-flow coefficient.</summary>
    public static LossPrice TryPrice(string partType, IReadOnlyDictionary<string, AshraeGrid>? table,
        IReadOnlyList<LossLeg> legs, LossItem item, double? transitionAngleDeg = null) {
        if (legs.Count == 0 || legs.Select(l => l.Index).Distinct().Count() != legs.Count)
            return Unknown("Connector indices are missing or ambiguous");
        if (item.Begin == item.End || !legs.Any(l => l.Index == item.Begin) || !legs.Any(l => l.Index == item.End))
            return Unknown("The priced item does not identify two retained connectors");
        if (legs.Any(l => !Finite(l.Flow) || l.Flow < 0)) return Unknown("Connector flow is unknown or invalid");
        if (legs.All(l => l.Flow == 0)) return Known(0);
        if (table is null) return Unknown("The fitting has no readable coefficient table");
        try {
            return DuctNetwork.JunctionPartTypes.Contains(partType) ? Junction(table, legs, item)
                : partType == Transition ? TransitionCo(table, legs, transitionAngleDeg)
                : partType == "Elbow" ? Single(table, legs, item)
                : Unknown($"Unsupported fitting part type {partType}");
        } catch (Exception ex) when (ex is ArgumentException or InvalidOperationException or IndexOutOfRangeException) {
            return Unknown(ex.Message);
        }
    }

    // Existing junction policy: most-flow inlet, largest on a tie. Shape/role improvements are separate.
    private static LossPrice Junction(IReadOnlyDictionary<string, AshraeGrid> table, IReadOnlyList<LossLeg> legs, LossItem item) {
        var inlet = legs.OrderByDescending(l => l.Flow).ThenByDescending(l => l.Area).First();
        var legIndex = item.End == inlet.Index ? item.Begin : item.End;
        var leg = legs.FirstOrDefault(l => l.Index == legIndex);
        if (leg is null || leg.Index == inlet.Index) return Unknown("The priced junction leg is unresolved");
        // Observed zero-flow legs are known zero, not an unsupported-table fallback.
        if (leg.Flow == 0) return Known(0);
        if (!Finite(inlet.Area) || inlet.Area <= 0 || !Finite(leg.Area) || leg.Area <= 0)
            return Unknown("Junction cross-section is unknown or invalid");
        var q = leg.Flow / inlet.Flow;
        var straight = leg.Round == inlet.Round && Math.Abs(leg.Area - inlet.Area) <= 0.02 * inlet.Area;
        var result = straight ? "Cs" : "Cb";
        if (!table.TryGetValue(result, out var grid)) return Unknown($"The table has no {result} junction result");
        return Known(AshraeLookup.Value(grid, q, grid.Y is null ? null : straight ? 1 : leg.Area / inlet.Area));
    }

    private static LossPrice TransitionCo(IReadOnlyDictionary<string, AshraeGrid> table,
        IReadOnlyList<LossLeg> legs, double? angleDeg) {
        var pair = DuctNetwork.TwoPortFlow(legs, l => l.Direction);
        if (pair is null) return Unknown("Transition requires exactly one In and one Out connector");
        if (angleDeg is not { } angle || !Finite(angle) || angle <= 0 || angle > 180)
            return Unknown("Transition has no valid measured included angle in degrees");
        var (inlet, outlet) = pair.Value;
        if (!Finite(inlet.Area) || inlet.Area <= 0 || !Finite(outlet.Area) || outlet.Area <= 0)
            return Unknown("Transition cross-section is unknown or invalid");
        if (!table.TryGetValue("Co", out var co)) return Unknown("The table has no Co transition result");
        return Known(AshraeLookup.Value(co, angle, co.Y is null ? null : outlet.Area / inlet.Area));
    }

    private static LossPrice Single(IReadOnlyDictionary<string, AshraeGrid> table, IReadOnlyList<LossLeg> legs, LossItem item) {
        if (!table.TryGetValue("Co", out var co) || co.Y is not null || co.XLabel.IndexOf("r/D", StringComparison.OrdinalIgnoreCase) >= 0)
            return Unknown("The elbow table needs geometry this pricing input does not carry");
        var inlet = legs.First(l => l.Index == item.Begin);
        if (!inlet.Round || !Finite(inlet.Area) || inlet.Area <= 0) return Unknown("The round elbow cross-section is unknown or invalid");
        return Known(AshraeLookup.Value(co, Math.Sqrt(4 * inlet.Area / Math.PI) * 12));
    }
}
