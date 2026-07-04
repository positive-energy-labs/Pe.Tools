using Pe.Revit.Global.Services.Host;
using Pe.Shared.RevitData.Families;

namespace Pe.Revit.Tests;

[TestFixture]
public sealed class DocShadowTests {
    private static FamilySnapshotRecord Record(long familyId, bool isPartial = false) => new(
        familyId,
        $"unique-{familyId}",
        $"Family {familyId}",
        "Mechanical Equipment",
        VersionGuid: null,
        TypeNames: [],
        Parameters: [],
        Issues: [],
        IsPartial: isPartial
    );

    private static DocumentDelta Delta(
        long[]? added = null,
        long[]? modified = null,
        long[]? deleted = null
    ) => new(added ?? [], modified ?? [], deleted ?? [], []);

    [Test]
    public void Symbol_change_evicts_only_its_family() {
        var shadow = new DocShadow();
        shadow.Store(Record(1));
        shadow.Store(Record(2));

        // id 99 is a symbol of family 1
        shadow.Apply(Delta(modified: [99]), _ => new DeltaImpact(1, false, false));

        Assert.That(shadow.TryGet(1, out _), Is.False);
        Assert.That(shadow.TryGet(2, out _), Is.True);
    }

    [Test]
    public void Unrelated_change_evicts_nothing() {
        var shadow = new DocShadow();
        shadow.Store(Record(1));

        shadow.Apply(Delta(modified: [42, 43]), _ => DeltaImpact.None);

        Assert.That(shadow.TryGet(1, out _), Is.True);
    }

    [Test]
    public void Deleted_id_matching_cached_family_evicts_it() {
        var shadow = new DocShadow();
        shadow.Store(Record(1));
        shadow.Store(Record(2));

        shadow.Apply(Delta(deleted: [1]), _ => DeltaImpact.None);

        Assert.That(shadow.TryGet(1, out _), Is.False);
        Assert.That(shadow.TryGet(2, out _), Is.True);
    }

    [Test]
    public void Oversized_delta_clears_everything() {
        var shadow = new DocShadow();
        shadow.Store(Record(1));
        shadow.Store(Record(2));

        var hugeDelta = Delta(modified: Enumerable.Range(1000, 600).Select(id => (long)id).ToArray());
        shadow.Apply(hugeDelta, _ => DeltaImpact.None);

        Assert.That(shadow.CachedFamilyCount, Is.Zero);
    }

    [Test]
    public void Partial_records_are_never_cached() {
        var shadow = new DocShadow();
        shadow.Store(Record(1, isPartial: true));

        Assert.That(shadow.TryGet(1, out _), Is.False);
    }

    [Test]
    public void Empty_delta_is_a_noop() {
        var shadow = new DocShadow();
        shadow.Store(Record(1));

        shadow.Apply(Delta(), _ => throw new InvalidOperationException("classify must not run for empty deltas"));

        Assert.That(shadow.TryGet(1, out _), Is.True);
    }
}
