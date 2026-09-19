using Pe.Shared.RevitData;
using static Pe.Shared.RevitData.ParameterEditPlan;

namespace Pe.Revit.Tests;

/// <summary>The one judgment of parameter-write evidence, admission groups and aliases (no document).</summary>
[TestFixture]
public sealed class ParameterEditPlanTests {
    private const string Unresolved = "Target element 9 did not resolve.";
    private const string? Ok = null;

    /// <summary>What <see cref="E" /> with <see cref="Ev.Stale" /> on <paramref name="element" /> answers.</summary>
    private static string S(long element) => Stale(Target(element, raw: "stale"), Target(element));

    /// <summary>What a sibling answers when <paramref name="cause" /> refused its group.</summary>
    private static string G(string cause, int more = 0) => GroupRefused + cause + (more > 0 ? $" (+{more} more refused)" : "");

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

    private static string Why(Edit edit) => Stale(edit.Value.Expected!, edit.Current!);

    /// <summary>A plan as comparable text: refusals per edit, then each write as its answered edit indices.</summary>
    private static (string?[] Refusals, string[] Writes) Shape(Plan plan) =>
        (plan.Refusals.Select(refusal => refusal?.Message).ToArray(), plan.Writes.Select(write => string.Join(",", write.Edits)).ToArray());

    private static TestCaseData Case(string name, Evidence evidence, Edit[] edits, string?[] refusals, params string[] writes) =>
        new TestCaseData(edits, evidence, refusals, writes).SetName(name);

    private static IEnumerable<TestCaseData> Cases() {
        yield return Case("A stale Expected refuses and writes nothing", Evidence.Required,
            [E(0, 1, ev: Ev.Stale)], [S(1)]);
        Edit[] fields = [StaleBy(1, target => target with { IsReadOnly = true }), StaleBy(2, target => target with { HasValue = false }),
            StaleBy(3, target => target with { StorageType = RequestedParameterStorageType.Double }),
            StaleBy(4, target => target with { ParameterName = "Comments" })];
        yield return Case("Any evidence field differing is stale, not just the raw value", Evidence.IfGiven,
            fields, fields.Select(Why).ToArray<string?>());
        yield return Case("A wet edit without Expected refuses", Evidence.Required,
            [E(0, 1, ev: Ev.None)], [MissingExpected]);
        yield return Case("Evidence if given (dry run, script door) admits a missing Expected but still refuses a stale one", Evidence.IfGiven,
            [E(0, 1, ev: Ev.None), E(1, 1, ev: Ev.None), E(2, 2, ev: Ev.Stale)], [Ok, Ok, S(2)], "0,1");
        yield return Case("The script door writes without evidence yet still coalesces, refuses aliases and stale evidence", Evidence.IfGiven,
            [E(0, 1, ev: Ev.None), E(1, 1, ev: Ev.None), E(2, 2, ev: Ev.None), E(3, 2, "Y", Ev.None), E(4, 3, ev: Ev.Stale)],
            [Ok, Ok, AliasConflict, AliasConflict, S(3)], "0,1");
        yield return Case("Identical edits to one target write once", Evidence.Required,
            [E(0, 1), E(1, 1), E(2, 2, "Y")], [Ok, Ok, Ok], "0,1", "2");
        yield return Case("A transitive alias chain with one differing value refuses all three groups", Evidence.Required,
            [E(0, 1), E(0, 2), E(1, 2), E(1, 3), E(2, 3, "Y")],
            [AliasConflict, AliasConflict, AliasConflict, AliasConflict, AliasConflict]);
        yield return Case("Of two independent alias groups one refuses and the other writes", Evidence.Required,
            [E(0, 1), E(1, 1, "Y"), E(2, 2, "Z"), E(3, 2, "Z")], [AliasConflict, AliasConflict, Ok, Ok], "2,3");
        yield return Case("A refused group touching another group's target leaves that group writing", Evidence.Required,
            [E(0, 1), E(0, 2, ev: Ev.Stale), E(1, 2, "Y"), E(2, 1)], [G(S(2)), S(2), Ok, Ok], "2", "3");
        yield return Case("A stale Expected on one target of a multi-target cell refuses the whole cell", Evidence.Required,
            [E(0, 1), E(0, 2, ev: Ev.Stale), E(0, 3)], [G(S(2)), S(2), G(S(2))]);
        yield return Case("Identical-value duplicates across different groups coalesce per target", Evidence.Required,
            [E(0, 1), E(0, 2), E(1, 2), E(1, 3), E(2, 1)], [Ok, Ok, Ok, Ok, Ok], "0,4", "1,2", "3");
        yield return Case("A unit difference counts as differing", Evidence.Required,
            [E(0, 1, "5", unit: "CFM"), E(1, 1, "5")], [AliasConflict, AliasConflict]);
        yield return Case("A rawInternal difference counts as differing", Evidence.Required,
            [E(0, 1, "5", rawInternal: true), E(1, 1, "5")], [AliasConflict, AliasConflict]);
        yield return Case("An unresolved target refuses its group", Evidence.IfGiven,
            [new Edit(0, new ParameterValueEdit(9, -1, Value: "X"), null), E(0, 1), E(1, 1)], [Unresolved, G(Unresolved), Ok], "2");
        yield return Case("A resolution refusal is kept as the answer", Evidence.Required,
            [new Edit(0, new ParameterValueEdit(9, -1, Value: "X", Expected: Target(9)), null, "Element 9 was not found.")],
            ["Element 9 was not found."]);
    }

    [TestCaseSource(nameof(Cases))]
    public void Judges(Edit[] edits, Evidence evidence, string?[] refusals, string[] writes) {
        var (actualRefusals, actualWrites) = Shape(Build(edits, evidence));
        Assert.Multiple(() => {
            Assert.That(actualRefusals, Is.EqualTo(refusals));
            Assert.That(actualWrites, Is.EqualTo(writes));
        });
    }

    [TestCaseSource(nameof(Cases))]
    public void Is_independent_of_input_order(Edit[] edits, Evidence evidence, string?[] refusals, string[] writes) {
        var random = new Random(7);
        var expected = Canonical(edits, evidence, Enumerable.Range(0, edits.Length).ToArray());
        for (var trial = 0; trial < 20; trial++) {
            var order = Enumerable.Range(0, edits.Length).OrderBy(_ => random.Next()).ToArray();
            Assert.That(Canonical(edits, evidence, order), Is.EqualTo(expected), $"order {string.Join(",", order)}");
        }
    }

    /// <summary>Judges edits in the given order and answers in original-index terms, as sets.</summary>
    private static string Canonical(Edit[] edits, Evidence evidence, int[] order) {
        var plan = Build(order.Select(i => edits[i]).ToList(), evidence);
        var refusals = order.Select((original, at) => (original, plan.Refusals[at]?.Code, plan.Refusals[at]?.Cause, plan.Refusals[at]?.Message))
            .OrderBy(pair => pair.original);
        var writes = plan.Writes.Select(write => string.Join(",", write.Edits.Select(at => order[at]).Order())).Order();
        return string.Join("|", refusals) + " / " + string.Join(" ", writes);
    }

    [Test]
    public void A_stale_nonfirst_target_names_itself_on_every_sibling_of_its_cell() {
        var plan = Build([E(0, 1), E(0, 2, ev: Ev.Stale), E(0, 3)], Evidence.Required);
        Assert.Multiple(() => {
            Assert.That(plan.Writes, Is.Empty);
            foreach (var refusal in plan.Refusals.Select(refusal => refusal?.Message)) {
                Assert.That(refusal, Does.Contain("stale"));
                Assert.That(refusal, Does.Contain("element 2"));
                Assert.That(refusal, Does.Contain("'Mark'"));
                Assert.That(refusal, Does.Contain("expected 'stale', now 'A'"));
            }
        });
    }

    // Authority ask A: every refusal carries one closed code; the prose stays the `error`.
    [Test]
    public void Each_refusal_carries_its_closed_code() {
        EditRefusalCode? Code(Evidence evidence, params Edit[] edits) => Build(edits, evidence).Refusals[0]?.Code;
        Assert.Multiple(() => {
            Assert.That(Code(Evidence.Required, E(0, 1, ev: Ev.Stale)), Is.EqualTo(EditRefusalCode.TargetEvidenceStale));
            Assert.That(Code(Evidence.Required, E(0, 1, ev: Ev.None)), Is.EqualTo(EditRefusalCode.TargetEvidenceMissing));
            Assert.That(Code(Evidence.IfGiven, new Edit(0, new ParameterValueEdit(9, -1, Value: "X"), null)), Is.EqualTo(EditRefusalCode.TargetUnresolved));
            Assert.That(Code(Evidence.Required, new Edit(0, new ParameterValueEdit(9, -1, Value: "X", Expected: Target(9)), null, "Element 9 was not found.")),
                Is.EqualTo(EditRefusalCode.TargetUnresolved), "a resolver refusal is an unresolved target");
            Assert.That(Code(Evidence.Required, E(0, 1), E(1, 1, "Y")), Is.EqualTo(EditRefusalCode.AliasConflict));
            Assert.That(Build([E(0, 1)], Evidence.Required).Refusals[0], Is.Null);
        });
    }

    // A sibling's code is admission-group-refused, and it carries its cause's code: the same cause its message names, in any input order.
    [Test]
    public void A_refused_group_carries_its_cause_code_on_every_sibling_in_any_order() {
        // Two causes: stale (element 2) and missing evidence (element 3). The ordinal-first message ("A wet run…") is the named cause.
        Edit[] edits = [E(0, 1), E(0, 2, ev: Ev.Stale), E(0, 3, ev: Ev.None), E(1, 4)];
        var plan = Build(edits, Evidence.Required);
        Assert.Multiple(() => {
            Assert.That(plan.Refusals.Select(r => (r?.Code, r?.Cause)), Is.EqualTo(new (EditRefusalCode?, EditRefusalCode?)[] {
                (EditRefusalCode.AdmissionGroupRefused, EditRefusalCode.TargetEvidenceMissing),
                (EditRefusalCode.TargetEvidenceStale, null),
                (EditRefusalCode.TargetEvidenceMissing, null),
                (null, null)
            }));
            Assert.That(plan.Refusals[0]?.Message, Is.EqualTo(G(MissingExpected, 1)), "the prose is unchanged");
        });
        var expected = Canonical(edits, Evidence.Required, [0, 1, 2, 3]);
        foreach (var order in new[] { new[] { 3, 2, 1, 0 }, [2, 0, 3, 1], [1, 3, 0, 2] })
            Assert.That(Canonical(edits, Evidence.Required, order), Is.EqualTo(expected), string.Join(",", order));
    }

    [Test]
    public void Codes_serialize_as_their_closed_kebab_names() =>
        Assert.That(Enum.GetValues<EditRefusalCode>().Select(code => Newtonsoft.Json.JsonConvert.SerializeObject(code)), Is.EqualTo(new[] {
            "\"target-evidence-stale\"", "\"target-evidence-missing\"", "\"target-unresolved\"", "\"admission-group-refused\"", "\"alias-conflict\""
        }));

    [Test]
    public void A_group_at_the_cap_writes_once_per_target_and_one_stale_target_refuses_all_of_it() {
        var cap = ParameterValueApplyBounds.MaxEditsPerCall;
        // One cell group of cap targets plus a second group aliasing its last target identically: cap writes.
        var edits = Enumerable.Range(1, cap).Select(element => E(0, element)).Append(E(1, cap)).ToList();
        var plan = Build(edits, Evidence.Required);
        Assert.Multiple(() => {
            Assert.That(plan.Refusals, Is.All.Null);
            Assert.That(plan.Writes, Has.Count.EqualTo(cap));
            Assert.That(plan.Writes[^1].Edits, Is.EqualTo(new[] { cap - 1, cap }));
        });

        edits[cap - 1] = E(0, cap, ev: Ev.Stale);
        var refused = Build(edits, Evidence.Required);
        Assert.Multiple(() => {
            Assert.That(refused.Refusals.Take(cap - 1).Select(refusal => refusal?.Message), Is.All.EqualTo(G(S(cap))));
            Assert.That(refused.Refusals[cap - 1]?.Message, Is.EqualTo(S(cap)));
            Assert.That(Shape(refused).Writes, Is.EqualTo(new[] { $"{cap}" }));
        });
    }

    [Test]
    public void Agrees_with_a_naive_reference_judge_on_random_edit_sets() {
        var random = new Random(20260918);
        for (var trial = 0; trial < 500; trial++) {
            var edits = Enumerable.Range(0, random.Next(1, 11)).Select(_ => RandomEdit(random)).ToList();
            var evidence = random.Next(4) == 0 ? Evidence.IfGiven : Evidence.Required;
            var actual = Shape(Build(edits, evidence));
            var naive = Naive(edits, evidence);
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
    private static (string?[] Refusals, string[] Writes) Naive(IReadOnlyList<Edit> edits, Evidence evidence) {
        var n = edits.Count;
        var judged = edits.Select(edit =>
            edit.Refusal ?? (edit.Current == null ? $"Target element {edit.Value.ElementId} did not resolve."
                : edit.Value.Expected == null ? (evidence == Evidence.IfGiven ? null : MissingExpected)
                : edit.Value.Expected == edit.Current ? null : Stale(edit.Value.Expected, edit.Current))).ToArray();
        var refusals = Enumerable.Range(0, n).Select(i => {
            if (judged[i] != null) return judged[i];
            var causes = Enumerable.Range(0, n).Where(j => edits[j].Group == edits[i].Group && judged[j] != null)
                .Select(j => judged[j]!).Order(StringComparer.Ordinal).ToList();
            return causes.Count == 0 ? null : G(causes[0], causes.Count - 1);
        }).ToArray();

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
