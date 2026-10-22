using Autodesk.Revit.DB.Mechanical;
using Autodesk.Revit.DB.Structure;
using Pe.Revit.Failures;
using Pe.Revit.Tasks;
using Pe.Shared.RevitData.Ducts;
using Serilog;

namespace Pe.Revit.Global.Lib.Mep;

/// <summary>
///     The Revit half of `ducts.heal` (pressure-drop ledger 2026-10-20; spike `.artifacts/runs/close-ducts-v1/heal/`).
///     Caps a dangling end with its duct type's Caps routing rule (NewFamilyInstance, rotated and sized by hand: there
///     is no cap API), connects coincident ends, and bridges a small same-size gap with a union (two ducts) or by
///     extending the duct (duct to part). Each item runs in a SubTransaction and must pass our own post-check
///     (connected, sizes equal, origins within <see cref="CheckTolIn" />, no system split or merged); Revit's
///     "connected" alone is not proof: it reports a 13.7 in extend as connected. A failing item rolls back alone.
///     Apply commits one transaction per group; preview commits them inside a TransactionGroup it rolls back, so the
///     failure processing a real commit meets is met in preview too.
/// </summary>
public static class DuctHealer {
    /// <summary>Ends this close are coincident and only ConnectTo. Mirrors HEAL_COINCIDENT_IN (ducts-domain heal.ts).</summary>
    public const double CoincidentIn = 1.0 / 16;

    /// <summary>
    ///     The widest gap a union or an extend heals. The spike PROVED a 3 in union and a 2.8 in extend and FALSIFIED a
    ///     13.7 in extend (Revit said connected with the end 13.7 in off). Mirrors HEAL_JOIN_GAP_IN.
    /// </summary>
    public const double JoinGapIn = 3.0;

    /// <summary>The post-check: the most two joined connector origins may differ, and the most an end may sit off its partner's axis.</summary>
    public const double CheckTolIn = 1.0 / 16;

    private const double SizeTolIn = 0.01;
    private const double OpposedCos = 0.999;

    private sealed class Refused(string message, string? how = null) : Exception(message) {
        public string? How { get; } = how;
    }

    private sealed record Done(string How, IReadOnlyList<long> Created, IReadOnlyList<long> Replaced, string Check);

    public static DuctHealResult Heal(Document doc, DuctHealRequest request) {
        var groups = new List<DuctHealGroupOutcome>();
        if (request.PreviewOnly) {
            using var all = new TransactionGroup(doc, DocumentSandbox.TransactionNamePrefix + "Pe Heal Ducts (preview)");
            _ = all.Start();
            try {
                foreach (var g in request.Groups) groups.Add(Group(doc, g, true));
            } finally {
                _ = all.RollBack();
            }
        } else {
            foreach (var g in request.Groups) groups.Add(Group(doc, g, false));
        }
        var items = groups.SelectMany(g => g.Items).ToList();
        return new DuctHealResult(request.PreviewOnly, groups, new DuctHealCounts(
            items.Count(i => i.Outcome == "planned"),
            items.Count(i => i.Outcome == "healed"),
            items.Count(i => i.Outcome == "refused")));
    }

    private static DuctHealGroupOutcome Group(Document doc, DuctHealGroup group, bool preview) {
        var keys = group.Items.SelectMany(i => new[] { i.End, i.Other }).OfType<string>().Distinct().ToList();
        var before = Systems(keys.Select(k => Try(() => Find(doc, k))).OfType<Connector>());
        var outcomes = new List<DuctHealOutcome>();
        var seen = new HashSet<string>(StringComparer.Ordinal);
        var diagnostics = new List<(bool IsError, string Message)>();
        try {
            using var sandbox = DocumentSandbox.BeginCommit(doc, (preview ? DocumentSandbox.TransactionNamePrefix : "") + $"Pe Heal Ducts ({group.Group})");
            var options = sandbox.Transaction.GetFailureHandlingOptions();
            _ = options.SetFailuresPreprocessor(new DelegatingFailuresPreprocessor(a => PeToolsFailureHandling.RejectErrors(a, diagnostics)));
            _ = options.SetClearAfterRollback(true);
            _ = options.SetForcedModalHandling(false);
            sandbox.Transaction.SetFailureHandlingOptions(options);
            foreach (var item in group.Items)
                outcomes.Add(seen.Add(item.Key)
                    ? Item(doc, item, preview)
                    : Outcome(item, null, "refused", "the request names this key twice", null));
            if (outcomes.All(o => o.Outcome == "refused"))
                return new DuctHealGroupOutcome(group.Group, "empty", "no item passed its checks; nothing was changed", outcomes, before, before);
            sandbox.Complete();
        } catch (Exception ex) when (DuctSnapshots.IsRevitFailure(ex) || ex is ArgumentException) {
            Log.Error(ex, "ducts.heal group {Group} failed", group.Group);
            var detail = string.Join("; ", diagnostics.Where(d => d.IsError).Select(d => d.Message));
            var reason = $"the group's transaction failed and rolled back ({ex.Message}{(detail.Length > 0 ? ": " + detail : "")})";
            var rolled = outcomes.Select(o => o.Outcome == "refused" ? o : o with { Outcome = "refused", Reason = reason, Created = [], Replaced = [] }).ToList();
            return new DuctHealGroupOutcome(group.Group, "refused", reason, rolled, before, before);
        }
        var touched = keys.Select(k => Try(() => Find(doc, k)))
            .Concat(outcomes.SelectMany(o => o.Created).Select(id => doc.GetElement(id.ToElementId())).OfType<Element>().SelectMany(DuctSnapshots.HvacConnectors))
            .OfType<Connector>();
        return new DuctHealGroupOutcome(group.Group, preview ? "planned" : "healed", null, outcomes, before, Systems(touched));
    }

    private static DuctHealOutcome Item(Document doc, DuctHealItem item, bool preview) {
        // Revit creates in the active view's phase; a fitting in another phase than the run it heals is
        // filtered out of the working phase and the end reads open again (Project A: cap in Future on a New
        // Construction duct). Read before the heal: a union may replace the owner.
        var phase = Try(() => Find(doc, item.End))?.Owner.CreatedPhaseId;
        using var sub = new SubTransaction(doc);
        _ = sub.Start();
        try {
            var done = item.Kind switch {
                DuctHealKind.Cap => Cap(doc, item.End),
                DuctHealKind.Join when item.Other is { } other => Join(doc, item.End, other),
                DuctHealKind.Join => throw new Refused("a join names two ends"),
                _ => throw new Refused($"unknown kind {item.Kind}")
            };
            if (phase is not null)
                foreach (var made in done.Created.Select(id => doc.GetElement(id.ToElementId())).OfType<Element>())
                    if (made.CreatedPhaseId != phase) made.CreatedPhaseId = phase;
            _ = sub.Commit();
            return new DuctHealOutcome(item.Key, Word(item.Kind), done.How, preview ? "planned" : "healed", null, done.Created, done.Replaced, done.Check);
        } catch (Refused r) {
            _ = sub.RollBack();
            return Outcome(item, r.How, "refused", r.Message, null);
        } catch (Exception ex) when (DuctSnapshots.IsRevitFailure(ex) || ex is ArgumentException) {
            _ = sub.RollBack();
            return Outcome(item, null, "refused", $"Revit refused: {ex.Message}", null);
        }
    }

    private static DuctHealOutcome Outcome(DuctHealItem item, string? how, string outcome, string? reason, string? check) =>
        new(item.Key, Word(item.Kind), how, outcome, reason, [], [], check);

    private static string Word(DuctHealKind kind) => kind == DuctHealKind.Cap ? "cap" : "join";

    /// <summary>A dangling end gets its duct type's cap, faced and sized onto it.</summary>
    private static Done Cap(Document doc, string key) {
        var end = Open(doc, key);
        var owner = end.Owner;
        var takes = owner is Duct
                    || (owner is FamilyInstance fi && fi.Category?.ToBuiltInCategory() == BuiltInCategory.OST_DuctFitting
                                                   && (fi.MEPModel as MechanicalFitting)?.PartType != PartType.Cap);
        if (!takes) throw new Refused($"{key} is on a {owner.Category?.Name ?? "part"}; only a duct or a duct fitting end takes a cap", "cap");
        var system = SystemId(end);
        var symbol = CapSymbol(doc, end);
        if (!symbol.IsActive) {
            symbol.Activate();
            doc.Regenerate();
        }
        var cap = doc.Create.NewFamilyInstance(end.Origin, symbol, StructuralType.NonStructural);
        doc.Regenerate();
        var cc = First(cap);
        var want = end.CoordinateSystem.BasisZ.Negate();
        var dot = want.DotProduct(cc.CoordinateSystem.BasisZ);
        if (dot < 0.9999) {
            var axis = cc.CoordinateSystem.BasisZ.CrossProduct(want);
            if (axis.GetLength() < 1e-6) axis = cc.CoordinateSystem.BasisX;
            ElementTransformUtils.RotateElement(doc, cap.Id, Line.CreateUnbound(end.Origin, axis.Normalize()), Math.Acos(Math.Max(-1, Math.Min(1, dot))));
            doc.Regenerate();
            cc = First(cap);
        }
        if (end.Shape == ConnectorProfileType.Rectangular) {
            var bx = cc.CoordinateSystem.BasisX;
            var tx = end.CoordinateSystem.BasisX;
            var ax = end.CoordinateSystem.BasisZ;
            var roll = Math.Atan2(bx.CrossProduct(tx).DotProduct(ax.Negate()), bx.DotProduct(tx));
            if (Math.Abs(roll) > 1e-4) {
                ElementTransformUtils.RotateElement(doc, cap.Id, Line.CreateUnbound(end.Origin, ax), roll);
                doc.Regenerate();
            }
        }
        void Set(string name, double value) {
            if (cap.LookupParameter(name) is { IsReadOnly: false, StorageType: StorageType.Double } p) _ = p.Set(value);
        }
        if (end.Shape == ConnectorProfileType.Round) {
            Set("Duct Radius", end.Radius);
            Set("Duct Diameter", end.Radius * 2);
        } else {
            Set("Width", end.Width);
            Set("Height", end.Height);
            Set("Duct Width", end.Width);
            Set("Duct Height", end.Height);
        }
        doc.Regenerate();
        cc = First(cap);
        cc.ConnectTo(end);
        doc.Regenerate();
        cc = First(cap);
        end = Find(doc, key);
        var problems = new List<string>();
        if (!cc.IsConnectedTo(end)) problems.Add("the cap is not connected to the end");
        problems.AddRange(SizeProblems(Dims(cc), Dims(end), "the cap"));
        var off = Inches(cc.Origin.DistanceTo(end.Origin));
        if (off > CheckTolIn) problems.Add($"the cap sits {off:0.###} in off the end");
        if (system is { } s && SystemId(end) != s) problems.Add("the end left its system");
        if (problems.Count > 0) throw new Refused("post-check failed: " + string.Join("; ", problems), "cap");
        return new Done("cap", [cap.Id.Value()], [], $"cap {Size(Dims(cc))} on {Size(Dims(end))}, {off:0.###} in off, {SystemName(end)}");
    }

    private static FamilySymbol CapSymbol(Document doc, Connector end) {
        const RoutingPreferenceRuleGroupType caps = RoutingPreferenceRuleGroupType.Caps;
        bool Has(DuctType? t) => t is not null && t.Shape == end.Shape && t.RoutingPreferenceManager.GetNumberOfRules(caps) > 0;
        var own = end.Owner is Duct d ? doc.GetElement(d.GetTypeId()) as DuctType : null;
        // A fitting's end takes the cap of a duct it already joins, else the first duct type of its shape with one.
        var type = Has(own)
            ? own
            : Neighbours(end.Owner).OfType<Duct>().Select(x => doc.GetElement(x.GetTypeId()) as DuctType).FirstOrDefault(Has)
              ?? new FilteredElementCollector(doc).OfClass(typeof(DuctType)).Cast<DuctType>().OrderBy(t => t.Id.Value()).FirstOrDefault(Has);
        if (type is null) throw new Refused($"no {end.Shape} duct type carries a Caps routing rule", "cap");
        return doc.GetElement(type.RoutingPreferenceManager.GetRule(caps, 0).MEPPartId) as FamilySymbol
               ?? throw new Refused($"duct type {type.Name}'s Caps rule names no family type", "cap");
    }

    /// <summary>Two open ends of one size, class and system: connect when coincident, else union two ducts or extend the duct.</summary>
    private static Done Join(Document doc, string keyA, string keyB) {
        var a = Open(doc, keyA);
        var b = Open(doc, keyB);
        if (a.Owner.Id == b.Owner.Id) throw new Refused("both ends are on one element");
        foreach (var c in new[] { a, b })
            if (c.Owner.Category?.ToBuiltInCategory() == BuiltInCategory.OST_MechanicalEquipment)
                throw new Refused($"{c.Owner.Id.Value()} is equipment; a join there splits or merges systems and is a person's");
        if (a.Shape != b.Shape) throw new Refused("the ends differ in shape; a transition is a person's");
        var dims = Dims(a);
        if (SizeProblems(Dims(b), dims, "the ends").Any()) throw new Refused($"the ends differ in size ({Size(dims)} and {Size(Dims(b))}); a transition is a person's");
        if (a.DuctSystemType != b.DuctSystemType) throw new Refused($"the ends are {a.DuctSystemType} and {b.DuctSystemType}; a person joins across classifications");
        var (sa, sb) = (SystemId(a), SystemId(b));
        if (sa is not null && sb is not null && sa != sb) throw new Refused("the ends are on different systems; joining them merges systems and is a person's");
        var system = sa ?? sb;
        var gap = Inches(a.Origin.DistanceTo(b.Origin));
        var (ida, idb) = (a.Owner.Id.Value(), b.Owner.Id.Value());
        string how;
        var created = new List<long>();
        if (gap <= CoincidentIn) {
            how = "connect";
            a.ConnectTo(b);
        } else {
            if (gap > JoinGapIn) throw new Refused($"the ends are {gap:0.##} in apart, past the {JoinGapIn} in heal limit; a person's");
            var za = a.CoordinateSystem.BasisZ;
            var r = b.Origin - a.Origin;
            if (za.DotProduct(b.CoordinateSystem.BasisZ) > -OpposedCos || r.DotProduct(za) <= 0)
                throw new Refused("the ends do not face each other");
            var lateral = Inches((r - za.Multiply(r.DotProduct(za))).GetLength());
            if (lateral > CheckTolIn) throw new Refused($"the ends are {lateral:0.##} in off one axis; a person's");
            if (a.Shape == ConnectorProfileType.Rectangular && Math.Abs(a.CoordinateSystem.BasisX.DotProduct(b.CoordinateSystem.BasisX)) < OpposedCos)
                throw new Refused("the rectangular ends are rolled against each other");
            if (a.Owner is Duct && b.Owner is Duct) {
                how = "union";
                created.Add(doc.Create.NewUnionFitting(a, b).Id.Value());
            } else if (a.Owner is Duct || b.Owner is Duct) {
                how = "extend";
                var (move, onto, key) = a.Owner is Duct ? (a, b, keyA) : (b, a, keyB);
                Extend((Duct)move.Owner, move, onto.Origin);
                Find(doc, key).ConnectTo(onto);
            } else {
                throw new Refused($"a {gap:0.##} in gap between two parts has no duct to extend; a person's");
            }
        }
        doc.Regenerate();
        var replaced = new[] { ida, idb }.Where(id => doc.GetElement(id.ToElementId()) is null).ToList();
        // The joint as it now stands: the two connector pairs to check (one for connect and extend, two through a union).
        List<(Connector X, Connector? Y)> pairs = how == "union"
            ? DuctSnapshots.HvacConnectors(doc.GetElement(created[0].ToElementId())).Select(u => (u, Partner(u))).ToList()
            : [(Find(doc, keyA), Find(doc, keyB))];
        var problems = new List<string>();
        foreach (var (x, y) in pairs) {
            if (y is null || !x.IsConnectedTo(y)) {
                problems.Add($"{x.Owner.Id.Value()}:{x.Id} is not connected");
                continue;
            }
            problems.AddRange(SizeProblems(Dims(x), dims, "the joint"));
            problems.AddRange(SizeProblems(Dims(y), dims, "the joint"));
            var off = Inches(x.Origin.DistanceTo(y.Origin));
            if (off > CheckTolIn) problems.Add($"the joint is {off:0.###} in open");
            if (SystemId(x) is var s && s != SystemId(y)) problems.Add("the two sides are on different systems");
            else if (system is { } before && s != before) problems.Add("the joint left its system");
            if (how == "union" && !replaced.Contains(y.Owner.Id.Value()) && y.Owner.Id.Value() is var id && id != ida && id != idb)
                created.Add(id);
        }
        if (problems.Count > 0) throw new Refused("post-check failed: " + string.Join("; ", problems), how);
        return new Done(how, created, replaced, $"{how} {Size(dims)}, {gap:0.###} in gap closed, {SystemName(pairs[0].X)}");
    }

    private static void Extend(Duct duct, Connector end, XYZ onto) {
        if (duct.Location is not LocationCurve { Curve: Line line } location) throw new Refused($"duct {duct.Id.Value()} is not straight", "extend");
        var atStart = end.Origin.DistanceTo(line.GetEndPoint(0)) < end.Origin.DistanceTo(line.GetEndPoint(1));
        var anchor = line.GetEndPoint(atStart ? 1 : 0);
        var dir = (line.GetEndPoint(atStart ? 0 : 1) - anchor).Normalize();
        var to = anchor + dir.Multiply((onto - anchor).DotProduct(dir));
        location.Curve = atStart ? Line.CreateBound(to, anchor) : Line.CreateBound(anchor, to);
        duct.Document.Regenerate();
    }

    private static Connector? Partner(Connector c) =>
        c.IsConnected ? c.AllRefs.Cast<Connector>().FirstOrDefault(r => r.Owner.Id != c.Owner.Id && r.ConnectorType == ConnectorType.End) : null;

    private static IEnumerable<Element> Neighbours(Element e) =>
        DuctSnapshots.HvacConnectors(e).Where(c => c.IsConnected).Select(Partner).OfType<Connector>().Select(c => c.Owner);

    private static Connector Find(Document doc, string key) {
        var parts = key.Split(':');
        if (parts.Length != 2 || !long.TryParse(parts[0], out var id) || !int.TryParse(parts[1], out var index))
            throw new Refused($"'{key}' is not an elementId:connector key");
        var e = doc.GetElement(id.ToElementId()) ?? throw new Refused($"element {id} is not in the document");
        return DuctSnapshots.HvacConnectors(e).FirstOrDefault(c => c.Id == index) ?? throw new Refused($"element {id} has no duct connector {index}");
    }

    private static Connector Open(Document doc, string key) {
        var c = Find(doc, key);
        if (c.ConnectorType != ConnectorType.End) throw new Refused($"{key} is not an end connector");
        if (c.IsConnected) throw new Refused($"{key} is already connected");
        return c;
    }

    private static Connector First(FamilyInstance fi) =>
        DuctSnapshots.HvacConnectors(fi).FirstOrDefault() ?? throw new Refused($"the cap family {fi.Symbol.FamilyName} has no duct connector", "cap");

    private static (ConnectorProfileType Shape, double W, double H) Dims(Connector c) =>
        c.Shape == ConnectorProfileType.Round
            ? (c.Shape, Inches(c.Radius * 2), Inches(c.Radius * 2))
            : (c.Shape, Inches(c.Width), Inches(c.Height));

    private static IEnumerable<string> SizeProblems((ConnectorProfileType Shape, double W, double H) x, (ConnectorProfileType Shape, double W, double H) want, string what) {
        if (x.Shape != want.Shape) yield return $"{what} is {x.Shape}, not {want.Shape}";
        else if (Math.Abs(x.W - want.W) > SizeTolIn || Math.Abs(x.H - want.H) > SizeTolIn) yield return $"{what} is {Size(x)}, not {Size(want)}";
    }

    private static string Size((ConnectorProfileType Shape, double W, double H) d) =>
        d.Shape == ConnectorProfileType.Round ? $"{d.W:0.##} in round" : $"{d.W:0.##}x{d.H:0.##} in";

    private static double Inches(double feet) => feet * 12;

    private static long? SystemId(Connector c) => Try(() => c.MEPSystem?.Id.Value());

    private static string SystemName(Connector c) => Try(() => c.MEPSystem?.Name) is { } n ? $"system {n}" : "no system";

    private static List<DuctSystem> Systems(IEnumerable<Connector> connectors) =>
        connectors.Select(c => Try(() => c.MEPSystem as MechanicalSystem)).OfType<MechanicalSystem>()
            .GroupBy(m => m.Id.Value()).Select(g => g.First())
            .OrderBy(m => m.Name, StringComparer.Ordinal)
            .Select(DuctSnapshots.RevitSystem)
            .ToList();

    private static T? Try<T>(Func<T?> read) {
        try {
            return read();
        } catch (Exception ex) when (DuctSnapshots.IsRevitFailure(ex) || ex is Refused) {
            return default;
        }
    }
}
