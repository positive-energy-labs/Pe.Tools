namespace Pe.Shared.RevitData.Ducts;

// What the Pe loss server computes when a fitting carries a table instead of its own coefficient (pressure-drop
// ledger, 2026-10-12: the server owns junctions and transitions; Revit's table route is gone). Revit-free so the
// numbers are pinned beside the web's loss-grid.ts and loss-rules.ts, which price the same fittings for the view.

/// <summary>One connector as Revit hands it to the server: Index (-1 is a takeoff's own branch), flow and area in Revit internal units.</summary>
public sealed record LossLeg(int Index, double Flow, double Area, bool Round, bool In);

/// <summary>One leg Revit prices: the connector pair of a `DuctFittingAndAccessoryPressureDropItem`.</summary>
public sealed record LossItem(int Begin, int End);

/// <summary>ASHRAE grid interpolation, row for row with the web's `lookupGrid`: linear in 1-D, bilinear in 2-D, clamped at the edges.</summary>
public static class AshraeLookup {
    public static double Value(AshraeGrid g, double x, double? y = null) {
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
public static class DuctFittingPricing {
    public const string Transition = "Transition";

    public static double Price(string partType, IReadOnlyDictionary<string, AshraeGrid> table, IReadOnlyList<LossLeg> legs, LossItem item) =>
        DuctNetwork.JunctionPartTypes.Contains(partType) ? Junction(table, legs, item)
        : partType == Transition ? TransitionCo(table, legs, item)
        : Single(table, legs, item);

    /// <summary>
    ///     Junction (the web's `tap-std`): the inlet is the leg with the most flow, the largest on a tie (an end-of-run
    ///     takeoff reports its branch and its upstream main equal). The item's other end is the priced leg: the inlet's
    ///     size makes it the straight leg, Cs over Qs/Qc; any other size is the branch, Cb over Qb/Qc and Ab/Ac.
    ///     PROVEN[session, srv-spike5 2026-10-05] for a Round Takeoff: legs 0 and 1 are the main's two halves, -1 the
    ///     branch, items (-1,1) and (-1,0). ponytail: an equal-size branch tee reads as two straight legs; the connector
    ///     angle would tell them apart, unproven.
    /// </summary>
    public static double Junction(IReadOnlyDictionary<string, AshraeGrid> table, IReadOnlyList<LossLeg> legs, LossItem item) {
        var inlet = legs.OrderByDescending(l => l.Flow).ThenByDescending(l => l.Area).FirstOrDefault();
        if (inlet is null || inlet.Flow <= 0) return 0;
        var legIndex = item.End == inlet.Index ? item.Begin : item.End;
        var leg = legs.FirstOrDefault(l => l.Index == legIndex);
        // A leg with no flow prices 0 (its Pv is 0 anyway; the grid edge would read thousands). PROVEN[session, srv-1-apply 2026-10-12].
        if (leg is null || leg.Index == inlet.Index || leg.Flow <= 0) return 0;
        var q = leg.Flow / inlet.Flow;
        var straight = leg.Round == inlet.Round && Math.Abs(leg.Area - inlet.Area) <= 0.02 * inlet.Area;
        if (straight) return table.TryGetValue("Cs", out var cs) ? AshraeLookup.Value(cs, q, cs.Y is null ? null : 1) : 0;
        return table.TryGetValue("Cb", out var cb) ? AshraeLookup.Value(cb, q, cb.Y is null ? null : leg.Area / inlet.Area) : 0;
    }

    /// <summary>
    ///     Transition (the web's `trx-*`): Co over the included angle and Ao/A1, outlet area over inlet area. The angle
    ///     is the family's 45°, as the web prices it; the inlet is the leg Revit marks In. UNPROVEN[session]: what a
    ///     transition reports as FlowDirection and Angle; a wrong inlet inverts the ratio.
    /// </summary>
    public static double TransitionCo(IReadOnlyDictionary<string, AshraeGrid> table, IReadOnlyList<LossLeg> legs, LossItem item) {
        if (!table.TryGetValue("Co", out var co) || legs.Count < 2) return 0;
        var inlet = legs.FirstOrDefault(l => l.In) ?? legs.First(l => l.Index == item.Begin);
        var outlet = legs.First(l => l.Index != inlet.Index);
        if (inlet.Area <= 0) return 0;
        return AshraeLookup.Value(co, 45, co.Y is null ? null : outlet.Area / inlet.Area);
    }

    /// <summary>One-leg fittings (elbows without their own coefficient): Co over the inlet diameter in inches, the web's `elbowInput`. An r/D table needs the family and reads 0 here.</summary>
    public static double Single(IReadOnlyDictionary<string, AshraeGrid> table, IReadOnlyList<LossLeg> legs, LossItem item) {
        if (!table.TryGetValue("Co", out var co) || co.Y is not null || co.XLabel.IndexOf("r/D", StringComparison.OrdinalIgnoreCase) >= 0) return 0;
        var inlet = legs.FirstOrDefault(l => l.Index == item.Begin) ?? legs.FirstOrDefault();
        if (inlet is null || inlet.Area <= 0) return 0;
        // Diameter from area, in inches; a rectangular leg prices on its equivalent round diameter.
        return AshraeLookup.Value(co, Math.Sqrt(4 * inlet.Area / Math.PI) * 12);
    }
}
