using Pe.Shared.RevitData;
using static Pe.Shared.RevitData.ParameterEditPlan;

namespace Pe.Revit.Tests;

/// <summary>The one judgment of parameter-write evidence, admission groups and aliases (no document).</summary>
[TestFixture]
public sealed class ParameterEditPlanTests {
    private const string Unresolved = "Target did not resolve.";
    private const string? Ok = null;

    public enum Ev { Fresh, None, Stale }

    private static ParameterTarget Target(long element, long parameter = -1001203, string? raw = "A") =>
        new(element, parameter, "Mark", RequestedParameterStorageType.String, false, raw != null, raw);

    private static Edit E(int group, long element, string value = "X", Ev ev = Ev.Fresh, string? unit = null, bool rawInternal = false) {
        var expected = ev switch { Ev.Fresh => Target(element), Ev.Stale => Target(element, raw: "stale"), _ => null };
        return new Edit(group, new ParameterValueEdit(element, -1001203, Value: value, Unit: unit, RawInternal: rawInternal, Expected: expected),
            Target(element));
    }

    private static Edit StaleBy(int element, Func<ParameterTarget, ParameterTarget> expected) =>
        E(element, element) with { Value = E(0, element).Value with { Expected = expected(Target(element)) } };

    /// <summary>A plan as comparable text: refusals per edit, then each write as its answered edit indices.</summary>
    private static (string?[] Refusals, string[] Writes) Shape(Plan plan) =>
        (plan.Refusals.ToArray(), plan.Writes.Select(write => string.Join(",", write.Edits)).ToArray());

    private static TestCaseData Case(string name, bool dryRun, Edit[] edits, string?[] refusals, params string[] writes) =>
        new TestCaseData(edits, dryRun, refusals, writes).SetName(name);

    private static IEnumerable<TestCaseData> Cases() {
        yield return Case("A stale Expected refuses and writes nothing", false,
            [E(0, 1, ev: Ev.Stale)], [Stale]);
        yield return Case("Any evidence field differing is stale, not just the raw value", true,
            [StaleBy(1, target => target with { IsReadOnly = true }), StaleBy(2, target => target with { HasValue = false }),
                StaleBy(3, target => target with { StorageType = RequestedParameterStorageType.Double }),
                StaleBy(4, target => target with { ParameterName = "Comments" })],
            [Stale, Stale, Stale, Stale]);
        yield return Case("A wet edit without Expected refuses", false,
            [E(0, 1, ev: Ev.None)], [MissingExpected]);
        yield return Case("A dry run admits a missing Expected but still refuses a stale one", true,
            [E(0, 1, ev: Ev.None), E(1, 1, ev: Ev.None), E(2, 2, ev: Ev.Stale)], [Ok, Ok, Stale], "0,1");
        yield return Case("Identical edits to one target write once", false,
            [E(0, 1), E(1, 1), E(2, 2, "Y")], [Ok, Ok, Ok], "0,1", "2");
        yield return Case("A transitive alias chain with one differing value refuses all three groups", false,
            [E(0, 1), E(0, 2), E(1, 2), E(1, 3), E(2, 3, "Y")],
            [AliasConflict, AliasConflict, AliasConflict, AliasConflict, AliasConflict]);
        yield return Case("Of two independent alias groups one refuses and the other writes", false,
            [E(0, 1), E(1, 1, "Y"), E(2, 2, "Z"), E(3, 2, "Z")], [AliasConflict, AliasConflict, Ok, Ok], "2,3");
        yield return Case("A refused group touching another group's target leaves that group writing", false,
            [E(0, 1), E(0, 2, ev: Ev.Stale), E(1, 2, "Y"), E(2, 1)], [GroupRefused, Stale, Ok, Ok], "2", "3");
        yield return Case("A stale Expected on one target of a multi-target cell refuses the whole cell", false,
            [E(0, 1), E(0, 2, ev: Ev.Stale), E(0, 3)], [GroupRefused, Stale, GroupRefused]);
        yield return Case("Identical-value duplicates across different groups coalesce per target", false,
            [E(0, 1), E(0, 2), E(1, 2), E(1, 3), E(2, 1)], [Ok, Ok, Ok, Ok, Ok], "0,4", "1,2", "3");
        yield return Case("A unit difference counts as differing", false,
            [E(0, 1, "5", unit: "CFM"), E(1, 1, "5")], [AliasConflict, AliasConflict]);
        yield return Case("A rawInternal difference counts as differing", false,
            [E(0, 1, "5", rawInternal: true), E(1, 1, "5")], [AliasConflict, AliasConflict]);
        yield return Case("An unresolved target refuses its group", true,
            [new Edit(0, new ParameterValueEdit(9, -1, Value: "X"), null), E(0, 1), E(1, 1)], [Unresolved, GroupRefused, Ok], "2");
        yield return Case("A resolution refusal is kept as the answer", false,
            [new Edit(0, new ParameterValueEdit(9, -1, Value: "X", Expected: Target(9)), null, "Element 9 was not found.")],
            ["Element 9 was not found."]);
    }

    [TestCaseSource(nameof(Cases))]
    public void Judges(Edit[] edits, bool dryRun, string?[] refusals, string[] writes) {
        var (actualRefusals, actualWrites) = Shape(Build(edits, dryRun));
        Assert.Multiple(() => {
            Assert.That(actualRefusals, Is.EqualTo(refusals));
            Assert.That(actualWrites, Is.EqualTo(writes));
        });
    }

    [TestCaseSource(nameof(Cases))]
    public void Is_independent_of_input_order(Edit[] edits, bool dryRun, string?[] refusals, string[] writes) {
        var random = new Random(7);
        var expected = Canonical(edits, dryRun, Enumerable.Range(0, edits.Length).ToArray());
        for (var trial = 0; trial < 20; trial++) {
            var order = Enumerable.Range(0, edits.Length).OrderBy(_ => random.Next()).ToArray();
            Assert.That(Canonical(edits, dryRun, order), Is.EqualTo(expected), $"order {string.Join(",", order)}");
        }
    }

    /// <summary>Judges edits in the given order and answers in original-index terms, as sets.</summary>
    private static string Canonical(Edit[] edits, bool dryRun, int[] order) {
        var plan = Build(order.Select(i => edits[i]).ToList(), dryRun);
        var refusals = order.Select((original, at) => (original, plan.Refusals[at])).OrderBy(pair => pair.original);
        var writes = plan.Writes.Select(write => string.Join(",", write.Edits.Select(at => order[at]).Order())).Order();
        return string.Join("|", refusals) + " / " + string.Join(" ", writes);
    }

    [Test]
    public void A_group_at_the_cap_writes_once_per_target_and_one_stale_target_refuses_all_of_it() {
        var cap = ParameterValueApplyBounds.MaxEditsPerCall;
        // One cell group of cap targets plus a second group aliasing its last target identically: cap writes.
        var edits = Enumerable.Range(1, cap).Select(element => E(0, element)).Append(E(1, cap)).ToList();
        var plan = Build(edits, dryRun: false);
        Assert.Multiple(() => {
            Assert.That(plan.Refusals, Is.All.Null);
            Assert.That(plan.Writes, Has.Count.EqualTo(cap));
            Assert.That(plan.Writes[^1].Edits, Is.EqualTo(new[] { cap - 1, cap }));
        });

        edits[cap - 1] = E(0, cap, ev: Ev.Stale);
        var refused = Build(edits, dryRun: false);
        Assert.Multiple(() => {
            Assert.That(refused.Refusals.Take(cap - 1), Is.All.EqualTo(GroupRefused));
            Assert.That(refused.Refusals[cap - 1], Is.EqualTo(Stale));
            Assert.That(Shape(refused).Writes, Is.EqualTo(new[] { $"{cap}" }));
        });
    }

    [Test]
    public void Agrees_with_a_naive_reference_judge_on_random_edit_sets() {
        var random = new Random(20260918);
        for (var trial = 0; trial < 500; trial++) {
            var edits = Enumerable.Range(0, random.Next(1, 11)).Select(_ => RandomEdit(random)).ToList();
            var dryRun = random.Next(4) == 0;
            var actual = Shape(Build(edits, dryRun));
            var naive = Naive(edits, dryRun);
            Assert.Multiple(() => {
                Assert.That(actual.Refusals, Is.EqualTo(naive.Refusals), $"trial {trial} refusals");
                Assert.That(actual.Writes, Is.EqualTo(naive.Writes), $"trial {trial} writes");
            });
        }
    }

    private static Edit RandomEdit(Random random) {
        var group = random.Next(4);
        var element = random.Next(1, 5);
        if (random.Next(12) == 0) return new Edit(group, new ParameterValueEdit(element, -1001203, Value: "X"), null);
        var ev = random.Next(8) switch { 0 => Ev.None, 1 => Ev.Stale, _ => Ev.Fresh };
        return E(group, element, random.Next(3) == 0 ? "Y" : "X", ev, random.Next(10) == 0 ? "CFM" : null, random.Next(10) == 0);
    }

    /// <summary>
    ///     Reference judge written the obvious way: live edits connect when they share a group or a target; a
    ///     connected set with more than one payload refuses; the rest coalesce per target.
    /// </summary>
    private static (string?[] Refusals, string[] Writes) Naive(IReadOnlyList<Edit> edits, bool dryRun) {
        var n = edits.Count;
        var judged = edits.Select(edit =>
            edit.Refusal ?? (edit.Current == null ? Unresolved
                : edit.Value.Expected == null ? (dryRun ? null : MissingExpected)
                : edit.Value.Expected == edit.Current ? null : Stale)).ToArray();
        var refusals = Enumerable.Range(0, n).Select(i => judged[i]
            ?? (Enumerable.Range(0, n).Any(j => edits[j].Group == edits[i].Group && judged[j] != null) ? GroupRefused : null)).ToArray();

        bool Live(int i) => refusals[i] == null;
        bool SameTarget(int i, int j) => edits[i].Current!.ElementId == edits[j].Current!.ElementId
                                         && edits[i].Current!.ParameterId == edits[j].Current!.ParameterId;
        var conflicted = new bool[n];
        for (var start = 0; start < n; start++) {
            if (!Live(start)) continue;
            var reached = new HashSet<int> { start };
            for (var grew = true; grew;) {
                grew = false;
                for (var j = 0; j < n; j++)
                    if (Live(j) && !reached.Contains(j) && reached.Any(i => edits[i].Group == edits[j].Group || SameTarget(i, j)))
                        grew = reached.Add(j);
            }
            conflicted[start] = reached.Select(i => (edits[i].Value.Value, edits[i].Value.Unit, edits[i].Value.RawInternal)).Distinct().Count() > 1;
        }
        for (var i = 0; i < n; i++)
            if (conflicted[i]) refusals[i] = AliasConflict;

        var writes = new List<List<int>>();
        for (var i = 0; i < n; i++) {
            if (!Live(i)) continue;
            var write = writes.FirstOrDefault(w => SameTarget(w[0], i));
            if (write == null) writes.Add([i]);
            else write.Add(i);
        }
        return (refusals, writes.Select(w => string.Join(",", w)).ToArray());
    }
}
