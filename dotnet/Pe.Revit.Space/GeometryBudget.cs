using Autodesk.Revit.DB.Electrical;
using Autodesk.Revit.DB.Mechanical;
using Autodesk.Revit.DB.Plumbing;
using Serilog;

namespace Pe.Revit.Space;

/// <summary>
///     A geometry read refused before it loaded or tessellated anything: its reach holds more elements than one read may
///     walk. The host turns this into the typed <c>OverBudget</c> refusal; <see cref="Cost" /> and <see cref="Ceiling" />
///     are in the budget's weighted element units (<see cref="GeometryBudget" />).
/// </summary>
public sealed class OverBudgetException(string message, int count, double cost, double ceiling, string narrowing) : ArgumentException(message) {
    /// <summary>Elements the read would have walked, unweighted.</summary>
    public int Count { get; } = count;
    public double Cost { get; } = cost;
    public double Ceiling { get; } = ceiling;
    /// <summary>How the caller makes the question smaller.</summary>
    public string Narrowing { get; } = narrowing;
}

/// <summary>
///     The one admission rule for every geometry prepare (a region, a verb's tight reach, a scene's context reach): count
///     the elements the read would walk, from collectors alone, and refuse above <see cref="Ceiling" /> before the first
///     element is loaded. Element count is what costs: a Chadds read follows the elements it first touches (READING-REVIT
///     U5, ≈14 KB per loaded element, far more once tessellated), not the size of the box that found them.
///     <para>
///         The count is weighted by what the read does with each kept element. One that is tessellated weighs 1. One that is
///         only loaded (<see cref="Plan" />'s <c>light</c>: a link's DirectShapes under link-boxes, sized runs and family
///         frames under oriented context) weighs <see cref="LoadWeight" />. Without the weight one ceiling cannot be right for
///         both representations: Chadds SA 7 reads the same ids as link-boxes and as meshes, at +670 MiB and +5.2 GiB.
///     </para>
/// </summary>
public static class GeometryBudget {
    /// <summary>
    ///     A load-only element as a fraction of a tessellated one. Measured on Chadds SA 7 at 15 ft, cold processes, 2026-11-02:
    ///     meshes cost 56,443 elements for +6,274 MiB (0.111 MiB each); link-boxes read the same ids for +1,145 MiB with 3,074
    ///     tessellated and 53,369 load-only, which solves to 0.135. 1/8 keeps the model's error under 10%.
    /// </summary>
    internal const double LoadWeight = 0.125;

    /// <summary>
    ///     Weighted elements one read may walk: 20,000. The slope is measured (0.111 MiB per weighted element on Chadds SA 7 meshes:
    ///     14,208 → +1,375 MiB, 22,949 → +2,787, 41,167 → +6,038, 56,443 → +6,274 cumulative, cold), so 20,000 is about 2.2 GiB of
    ///     Revit private bytes. The 2 GiB allowance is a product choice, not a measurement: it admits step 6's verbs (tens to a few
    ///     thousand), Chadds SA 7 and SA 7 + EX 7 link-boxes (9,745 and 12,536) and meshes at 2 ft of reach (14,208), and refuses
    ///     SA 7 meshes at 5 ft and beyond (22,949 to 56,443) and every whole-model box. Spatial ledger, 2026-11-02.
    /// </summary>
    public static double Ceiling { get; internal set; } = 20_000;

    internal static double Cost(IEnumerable<ReachPlan> plans) => plans.Sum(plan => plan.Keep.Count - plan.Light + (LoadWeight * plan.Light));

    /// <summary>Throws <see cref="OverBudgetException" /> when the plans together exceed the ceiling. Nothing has been loaded yet.</summary>
    internal static void Admit(IReadOnlyList<ReachPlan> plans, string question) {
        var cost = Cost(plans);
        var count = plans.Sum(plan => plan.Keep.Count);
        var sources = string.Join("; ", plans.Where(plan => plan.Keep.Count > 0)
            .Select(plan => $"{(plan.Source.LinkInstanceId is null ? "host" : plan.Source.Doc.Title)} {plan.Keep.Count:N0}" + (plan.Light > 0 ? $" ({plan.Light:N0} load-only)" : "")));
        Log.Information("Space budget {Question}: count {Count}, cost {Cost:N0} of ceiling {Ceiling:N0}; {Sources}", question, count, cost, Ceiling, sources);
        if (cost <= Ceiling) return;
        const string narrowing = "Name a room or space, or use a smaller box.";
        throw new OverBudgetException(
            $"OverBudget: {question} reaches {count:N0} elements, weighing {cost:N0} against a ceiling of {Ceiling:N0} ({sources}); it was refused before any geometry was read. {narrowing}",
            count, cost, Ceiling, narrowing);
    }

    private static readonly ElementFilter Frames = new LogicalOrFilter([
        new ElementClassFilter(typeof(FamilyInstance)), new ElementClassFilter(typeof(Duct)), new ElementClassFilter(typeof(Pipe)),
        new ElementClassFilter(typeof(Conduit)), new ElementClassFilter(typeof(CableTray))]);
    private static readonly ElementFilter FramesAndShapes = new LogicalOrFilter(Frames, new ElementClassFilter(typeof(DirectShape)));

    /// <summary>The kept elements of <paramref name="source" /> that a scene reads without tessellating, or null when every one is tessellated.</summary>
    internal static ElementFilter? Light(SceneContextRepresentation context, SourceKind source) => context switch {
        SceneContextRepresentation.Oriented or SceneContextRepresentation.TriangleBoxes => Frames,
        SceneContextRepresentation.LinkBoxes => source == SourceKind.Host ? Frames : FramesAndShapes,
        _ => null
    };
}
