using NUnit.Framework;
using Pe.Shared.RevitData.Ducts;
using Pe.Shared.RevitData.Serialization;

namespace Pe.Shared.Tests.RevitData;

/// <summary>The `_PE_DuctLosses` blob: round-trips in the owner envelope, keeps unknown keys, and fails closed on any other shape or version.</summary>
[TestFixture]
public sealed class DuctLossStoreTests {
    private static readonly DateTimeOffset At = new(2026, 10, 4, 12, 0, 0, TimeSpan.Zero);

    private static OwnerValue<DuctLossStore> Read(string? stored) => DuctLossStore.Read(OwnerBlob.Decode(DuctLossStore.Owner, stored));

    private static string Stored(string data, int version = 2) => $$"""{"owner":"duct-losses","version":{{version}},"data":{{data}}}""";

    [Test]
    public void Round_trips_every_field() {
        var store = new DuctLossStore {
            Version = DuctLossStore.CurrentVersion,
            Rules = new() { ["Round Elbow:Standard|r/D 1.0"] = new DuctRuleChoice("CD3-1") },
            Instances = new() { [6749371] = new DuctInstanceRecord("SD4-1", "Ao/A1=0.5", 0.25, At) },
            Terminals = new() { [6119626] = new DuctDropRecord(0.05, "catalog", At) },
            TerminalFlows = new() { [6119626] = new DuctFlowRecord(120, "load-preview:FC-17", At) },
            EquipmentFlows = new() { [9668311] = new DuctFlowRecord(1800, "submittal p. 3", At) },
            Verdicts = new() { ["open-end:6119626:1"] = new DuctVerdictRecord("ignore", At) },
            Roles = new() { [9668311] = new DuctRoleRecord("passive", At) },
            Slots = new DuctParameterSlotOverrides(TerminalDrop: "Catalog Drop"),
            WorkRevision = 3,
            AppliedAt = At
        };

        var back = Read(store.ToJson()).Value!;

        Assert.That(back.Version, Is.EqualTo(2));
        Assert.That(back.Rules["Round Elbow:Standard|r/D 1.0"].Table, Is.EqualTo("CD3-1"));
        Assert.That(back.Instances[6749371], Is.EqualTo(store.Instances[6749371]));
        Assert.That(back.Terminals[6119626], Is.EqualTo(store.Terminals[6119626]));
        Assert.That(back.TerminalFlows[6119626], Is.EqualTo(store.TerminalFlows[6119626]));
        Assert.That(back.EquipmentFlows[9668311], Is.EqualTo(store.EquipmentFlows[9668311]));
        Assert.That(back.Verdicts["open-end:6119626:1"], Is.EqualTo(store.Verdicts["open-end:6119626:1"]));
        Assert.That(back.Roles[9668311], Is.EqualTo(store.Roles[9668311]));
        Assert.That(back.Slots, Is.EqualTo(store.Slots));
        Assert.That(back.WorkRevision, Is.EqualTo(3));
        Assert.That(back.AppliedAt, Is.EqualTo(At));
        Assert.That(back.ToJson(), Is.EqualTo(store.ToJson()));
        Assert.That(store.ToJson(), Does.StartWith("""{"owner":"duct-losses","version":2,"data":{"rules":"""), "one version, in the envelope");
    }

    [Test]
    public void A_store_with_only_a_revision_reads_with_empty_maps() {
        var back = Read(Stored("""{"workRevision":2}""")).Value!;

        Assert.That(back.Version, Is.EqualTo(DuctLossStore.CurrentVersion));
        Assert.That(back.TerminalFlows, Is.Empty);
        Assert.That(back.Verdicts, Is.Empty);
        Assert.That(back.WorkRevision, Is.EqualTo(2));
    }

    [Test]
    public void A_chosen_airflow_slot_round_trips() {
        var store = new DuctLossStore {
            Version = DuctLossStore.CurrentVersion,
            Slots = new DuctParameterSlotOverrides(TerminalFlow: "Actual Supply Air Flow")
        };

        Assert.That(Read(store.ToJson()).Value!.Slots!.TerminalFlow, Is.EqualTo("Actual Supply Air Flow"));
    }

    [Test]
    public void Keeps_unknown_keys_through_read_modify_write() {
        var back = Read(Stored("""{"workRevision":2,"futureField":{"a":1}}""")).Value!;
        var written = Read((back with { WorkRevision = 3 }).ToJson()).Value!;

        Assert.That(written.Unknown.ContainsKey("futureField"), Is.True);
        Assert.That(written.WorkRevision, Is.EqualTo(3));
    }

    [TestCase("""{"owner":"duct-losses","version":3,"data":{"workRevision":1}}""", "version 3")]
    [TestCase("""{"owner":"duct-losses","version":1,"data":{"workRevision":1}}""", "version 1")]
    [TestCase("""{"owner":"duct-losses","version":2,"data":{"version":2,"workRevision":1}}""", "belongs to the envelope")]
    [TestCase("""{"owner":"duct-losses","version":2,""", "not strict JSON")]
    public void A_store_this_build_cannot_read_is_a_refusal(string json, string message) {
        var read = Read(json);

        Assert.That(read.Value, Is.Null);
        Assert.That(read.Refusal, Does.Contain(message).And.Contain("refused and kept"));
    }

    [TestCase(null)]
    [TestCase("null")]
    [TestCase("""{"version":2,"workRevision":1}""", Description = "an old un-enveloped store")]
    public void No_envelope_is_no_store(string? json) =>
        Assert.That(Read(json), Is.EqualTo(new OwnerValue<DuctLossStore>(null, null)));

    [Test]
    public void Partial_slots_from_the_wire_fall_back_to_the_defaults() {
        var slots = Newtonsoft.Json.JsonConvert.DeserializeObject<DuctParameterSlotOverrides>("""{"componentDrop":"Damper Drop"}""")!;

        Assert.That(slots.FanStatic, Is.Null, "Newtonsoft passes null for a missing ctor argument");
        Assert.That(slots.Resolve().FanStatic, Is.EqualTo("PE_M_Fan_ExternalStaticPressure"));
        Assert.That(slots.Resolve(), Is.EqualTo(new DuctParameterSlotOverrides(ComponentDrop: "Damper Drop").Resolve()));
    }

    [Test]
    public void Staged_slots_win_over_the_store_and_the_store_over_the_defaults() {
        var staged = Newtonsoft.Json.JsonConvert.DeserializeObject<DuctParameterSlotOverrides>("""{"componentDrop":"Damper Drop"}""")!;
        var stored = new DuctParameterSlotOverrides(TerminalDrop: "Catalog Drop", ComponentDrop: "Old Drop");

        Assert.That(staged.Resolve(stored),
            Is.EqualTo(new DuctParameterSlotOverrides(ComponentDrop: "Damper Drop", TerminalDrop: "Catalog Drop").Resolve()));
    }
}
