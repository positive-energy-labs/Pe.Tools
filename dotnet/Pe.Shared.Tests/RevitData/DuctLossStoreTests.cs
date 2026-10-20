using NUnit.Framework;
using Pe.Shared.RevitData.Ducts;

namespace Pe.Shared.Tests.RevitData;

/// <summary>The `_PE_DuctLosses` blob: round-trips, keeps unknown keys, and fails closed on any other version.</summary>
[TestFixture]
public sealed class DuctLossStoreTests {
    private static readonly DateTimeOffset At = new(2026, 10, 4, 12, 0, 0, TimeSpan.Zero);

    [Test]
    public void Round_trips_every_field() {
        var store = new DuctLossStore {
            Version = DuctLossStore.CurrentVersion,
            Rules = new() { ["Round Elbow:Standard|r/D 1.0"] = new DuctRuleChoice("CD3-1") },
            Instances = new() { [6749371] = new DuctInstanceRecord("SD4-1", "Ao/A1=0.5", 0.25, At) },
            Terminals = new() { [6119626] = new DuctDropRecord(0.05, "catalog", At) },
            TerminalFlows = new() { [6119626] = new DuctFlowRecord(120, "load-preview:FC-17", At) },
            EquipmentFlows = new() { [9668311] = new DuctFlowRecord(1800, "submittal p. 3", At) },
            Slots = new DuctParameterSlots(TerminalDrop: "Catalog Drop"),
            WorkRevision = 3,
            AppliedAt = At
        };

        var back = DuctLossStore.FromJson(store.ToJson());

        Assert.That(back.Version, Is.EqualTo(1));
        Assert.That(back.Rules["Round Elbow:Standard|r/D 1.0"].Table, Is.EqualTo("CD3-1"));
        Assert.That(back.Instances[6749371], Is.EqualTo(store.Instances[6749371]));
        Assert.That(back.Terminals[6119626], Is.EqualTo(store.Terminals[6119626]));
        Assert.That(back.TerminalFlows[6119626], Is.EqualTo(store.TerminalFlows[6119626]));
        Assert.That(back.EquipmentFlows[9668311], Is.EqualTo(store.EquipmentFlows[9668311]));
        Assert.That(back.Slots, Is.EqualTo(store.Slots));
        Assert.That(back.WorkRevision, Is.EqualTo(3));
        Assert.That(back.AppliedAt, Is.EqualTo(At));
        Assert.That(back.ToJson(), Is.EqualTo(store.ToJson()));
    }

    [Test]
    public void A_store_written_before_flows_reads_with_none() {
        var back = DuctLossStore.FromJson("""{"version":1,"workRevision":2}""");

        Assert.That(back.TerminalFlows, Is.Empty);
        Assert.That(back.EquipmentFlows, Is.Empty);
    }

    [Test]
    public void Keeps_unknown_keys_through_read_modify_write() {
        var back = DuctLossStore.FromJson("""{"version":1,"workRevision":2,"futureField":{"a":1}}""");
        var written = DuctLossStore.FromJson((back with { WorkRevision = 3 }).ToJson());

        Assert.That(written.Unknown.ContainsKey("futureField"), Is.True);
        Assert.That(written.WorkRevision, Is.EqualTo(3));
    }

    [TestCase("""{"version":2,"workRevision":1}""", "v2")]
    [TestCase("""{"workRevision":1}""", "v0")]
    [TestCase("""{"version":1,""", "not valid JSON")]
    [TestCase("null", "empty")]
    public void Fails_closed(string json, string message) =>
        Assert.That(() => DuctLossStore.FromJson(json), Throws.InvalidOperationException.With.Message.Contains(message));

    [Test]
    public void Partial_slots_from_the_wire_fall_back_to_the_defaults() {
        var slots = Newtonsoft.Json.JsonConvert.DeserializeObject<DuctParameterSlots>("""{"componentDrop":"Damper Drop"}""")!;

        Assert.That(slots.FanStatic, Is.Null, "Newtonsoft passes null for a missing ctor argument");
        Assert.That(slots.WithDefaults(), Is.EqualTo(new DuctParameterSlots(ComponentDrop: "Damper Drop")));
    }

    [Test]
    public void Staged_slots_win_over_the_store_and_the_store_over_the_defaults() {
        var staged = Newtonsoft.Json.JsonConvert.DeserializeObject<DuctParameterSlots>("""{"componentDrop":"Damper Drop"}""")!;
        var stored = new DuctParameterSlots(TerminalDrop: "Catalog Drop", ComponentDrop: "Old Drop");

        Assert.That(staged.Over(stored).WithDefaults(),
            Is.EqualTo(new DuctParameterSlots(ComponentDrop: "Damper Drop", TerminalDrop: "Catalog Drop")));
    }
}
