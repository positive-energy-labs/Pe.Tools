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

        Assert.That(slots.RequiredEsp, Is.Null, "Newtonsoft passes null for a missing ctor argument");
        Assert.That(slots.Resolve().RequiredEsp, Is.EqualTo("PE_M_Fan_ExternalStaticPressure"));
        Assert.That(slots.Resolve(), Is.EqualTo(new DuctParameterSlotOverrides(ComponentDrop: "Damper Drop").Resolve()));
    }

    [Test]
    public void Required_esp_none_round_trips_and_retired_slot_is_ignored_without_migration() {
        var oldKey = "fan" + "Static";
        var read = Read(Stored("{\"slots\":{\"" + oldKey + "\":\"Old ESP\"}}"));
        Assert.That(read.Refusal, Is.Null);
        Assert.That(read.Value!.Slots!.Resolve().RequiredEsp, Is.EqualTo("PE_M_Fan_ExternalStaticPressure"));
        var store = new DuctLossStore { Slots = new(RequiredEsp: "", RatedEsp: "Rated ESP") };
        var back = Read(store.ToJson()).Value!;
        Assert.That(back.Version, Is.EqualTo(2));
        Assert.That(back.Slots!.RequiredEsp, Is.EqualTo(""));
        Assert.That(back.Slots.Resolve().RequiredEsp, Is.Null);
        Assert.That(RevitDataJson.Serialize(back.Slots.Resolve()), Does.Contain("\"requiredEsp\":null"), "the snapshot must preserve resolved none across the wire");
        Assert.That(back.Slots.Resolve().RatedEsp, Is.EqualTo("Rated ESP"));
    }

    [TestCase("ESP", "ESP")]
    [TestCase("ESP", "esp")]
    [TestCase(" ESP ", "esp")]
    public void Required_and_rated_esp_must_be_different_parameters(string required, string rated) =>
        Assert.Throws<ArgumentException>(() => new DuctParameterSlotOverrides(RequiredEsp: required, RatedEsp: rated).Resolve());

    [Test]
    public void Stored_slot_receipts_do_not_supply_resolution_defaults() {
        var staged = Newtonsoft.Json.JsonConvert.DeserializeObject<DuctParameterSlotOverrides>("""{"componentDrop":"Damper Drop"}""")!;
        var stored = Read(new DuctLossStore { Slots = new(TerminalDrop: "Catalog Drop", ComponentDrop: "Old Drop") }.ToJson()).Value!;

        Assert.That(stored.Slots!.TerminalDrop, Is.EqualTo("Catalog Drop"), "the receipt survives independently of resolution");
        Assert.That(staged.Resolve(),
            Is.EqualTo(new DuctParameterSlotOverrides(ComponentDrop: "Damper Drop").Resolve()));
    }
}
