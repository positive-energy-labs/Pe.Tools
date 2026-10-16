namespace Pe.Shared.RevitData.Ducts;

// What the Pe loss server computes when a fitting carries a table instead of its own coefficient (pressure-drop
// ledger, 2026-10-12: the server owns junctions and transitions; Revit's table route is gone). Revit-free so the
// numbers are pinned beside the web's loss-grid.ts and loss-rules.ts, which price the same fittings for the view.

/// <summary>One connector as Revit hands it to the server: Index (-1 is a takeoff's own branch), flow and area in Revit internal units.</summary>
public sealed record LossLeg(int Index, double Flow, double Area, bool Round, string Direction);

/// <summary>One leg Revit prices: the connector pair of a `DuctFittingAndAccessoryPressureDropItem`.</summary>
public sealed record LossItem(int Begin, int End);

/// <summary>Named-coordinate interpolation only inside completely populated bracketing cells. No extrapolation.</summary>
public static class AshraeLookup {
    public static double Value(AshraeGrid grid, IReadOnlyDictionary<string, double> coordinates) {
        grid.Validate();
        var names = grid.Axis is null ? grid.RowAxes.ToList() : new[] { grid.Axis.Name }.Concat(grid.RowAxes).ToList();
        if (coordinates.Count != names.Count || names.Any(n => !coordinates.ContainsKey(n)) || coordinates.Values.Any(v => (double.IsNaN(v) || double.IsInfinity(v))))
            throw new ArgumentException($"{grid.Title}: exact finite named coordinates required: {string.Join(", ", names)}");
        if (grid.Axis is null) return grid.Rows[0].Values[0];
        var axes = new List<IReadOnlyList<double>> { grid.Axis.Values };
        for (var i = 0; i < grid.RowAxes.Count; i++) axes.Add(grid.Rows.Select(r => r.Coordinates[i]).Distinct().OrderBy(v => v).ToList());
        var corners = new List<(List<double> At, double Weight)> { ([], 1) };
        for (var i = 0; i < names.Count; i++) {
            var xs = axes[i];
            var q = coordinates[names[i]];
            if (q < xs[0] || q > xs[^1]) throw new ArgumentException($"{names[i]} outside published domain");
            var bracket = new List<(double At, double Weight)>();
            if (xs.Contains(q)) bracket.Add((q, 1));
            else {
                var k = Enumerable.Range(0, xs.Count - 1).First(k => xs[k] < q && q < xs[k + 1]);
                var t = (q - xs[k]) / (xs[k + 1] - xs[k]);
                bracket.Add((xs[k], 1 - t)); bracket.Add((xs[k + 1], t));
            }
            corners = corners.SelectMany(c => bracket.Where(p => p.Weight > 0).Select(p =>
                (c.At.Append(p.At).ToList(), c.Weight * p.Weight))).ToList();
        }
        var value = 0.0;
        foreach (var corner in corners) {
            var rows = grid.Rows.Where(r => r.Coordinates.SequenceEqual(corner.At.Skip(1))).ToList();
            if (rows.Count != 1) throw new ArgumentException($"{grid.Title}: missing published bracketing corner");
            var x = grid.Axis.Values.ToList().IndexOf(corner.At[0]);
            value += rows[0].Values[x] * corner.Weight;
        }
        if ((double.IsNaN(value) || double.IsInfinity(value))) throw new ArgumentException($"{grid.Title}: interpolation is not finite");
        return value;
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
        if (grid.RowAxes.Count > 1) return Unknown("Junction pricing does not qualify three-coordinate or mixing tables");
        var coordinates = new Dictionary<string, double> { [straight ? "Qs/Qc" : "Qb/Qc"] = q };
        if (grid.RowAxes.Count == 1) coordinates[straight ? "As/Ac" : "Ab/Ac"] = straight ? 1 : leg.Area / inlet.Area;
        return Known(AshraeLookup.Value(grid, coordinates));
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
        return Known(AshraeLookup.Value(co, new Dictionary<string, double> { ["Theta"] = angle, ["Ao/A1"] = outlet.Area / inlet.Area }));
    }

    private static LossPrice Single(IReadOnlyDictionary<string, AshraeGrid> table, IReadOnlyList<LossLeg> legs, LossItem item) {
        if (!table.TryGetValue("Co", out var co) || co.RowAxes.Count != 0 || co.Axis?.Name.IndexOf("r/D", StringComparison.OrdinalIgnoreCase) >= 0)
            return Unknown("The elbow table needs geometry this pricing input does not carry");
        var inlet = legs.First(l => l.Index == item.Begin);
        if (!inlet.Round || !Finite(inlet.Area) || inlet.Area <= 0) return Unknown("The round elbow cross-section is unknown or invalid");
        return Known(AshraeLookup.Value(co, new Dictionary<string, double> { ["D, in.(mm)"] = Math.Sqrt(4 * inlet.Area / Math.PI) * 12 }));
    }
}
