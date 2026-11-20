using NUnit.Framework;
using Pe.Shared.Product;
using Pe.Shared.StorageRuntime;
using System.Security.Cryptography;
using System.Text;
using Pe.Shared.RevitData.Ducts;
using Pe.Shared.RevitData.Serialization;

namespace Pe.Shared.Tests.RevitData;

/// <summary>The `_PE_DuctLosses` blob: round-trips in the owner envelope, keeps unknown keys, and fails closed on any other shape or version.</summary>
[TestFixture]
public sealed class DuctLossStoreTests {
    private const string Elbow = "5191cd54-1806-4a9d-8e57-bb8a93975f4a-0066fcbb";
    private const string Terminal = "5191cd54-1806-4a9d-8e57-bb8a93975f4a-005d60ca";
    private const string Unit = "5191cd54-1806-4a9d-8e57-bb8a93975f4a-009385d7";
    private static readonly DateTimeOffset At = new(2026, 10, 4, 12, 0, 0, TimeSpan.Zero);

    private static OwnerValue<DuctLossStore> Read(string? stored) => DuctLossStore.Read(OwnerBlob.Decode(DuctLossStore.Owner, stored));

    private static string Stored(string data, int version = DuctLossStore.CurrentVersion) => $$"""{"owner":"duct-losses","version":{{version}},"data":{{data}}}""";

    [Test]
    public void Round_trips_every_field() {
        var store = new DuctLossStore {
            Version = DuctLossStore.CurrentVersion,
            Rules = new() { ["Round Elbow:Standard|r/D 1.0"] = new DuctRuleChoice("CD3-1") },
            Instances = new() { [Elbow] = new DuctInstanceRecord("SD4-1", "Ao/A1=0.5", 0.25, At) },
            Terminals = new() { [Terminal] = new DuctDropRecord(0.05, "catalog", At) },
            TerminalFlows = new() { [Terminal] = new DuctFlowRecord(120, "load-preview:FC-17", At, "revit:Flow") },
            EquipmentFlows = new() { [Unit] = new DuctFlowRecord(1800, "submittal p. 3", At, "Design Fan Flow") },
            Verdicts = new() { ["open-end:6119626:1"] = new DuctVerdictRecord("ignore", At) },
            Roles = new() { [Unit] = new DuctRoleRecord("passive", At) },
            Slots = new DuctParameterSlotOverrides(TerminalDrop: "Catalog Drop"),
            WorkRevision = 3,
            AppliedAt = At
        };

        var back = Read(store.ToJson()).Value!;

        Assert.That(back.Version, Is.EqualTo(3));
        Assert.That(back.Rules["Round Elbow:Standard|r/D 1.0"].Table, Is.EqualTo("CD3-1"));
        Assert.That(back.Instances[Elbow], Is.EqualTo(store.Instances[Elbow]));
        Assert.That(back.Terminals[Terminal], Is.EqualTo(store.Terminals[Terminal]));
        Assert.That(back.TerminalFlows[Terminal], Is.EqualTo(store.TerminalFlows[Terminal]));
        Assert.That(back.EquipmentFlows[Unit], Is.EqualTo(store.EquipmentFlows[Unit]));
        Assert.That(back.Verdicts["open-end:6119626:1"], Is.EqualTo(store.Verdicts["open-end:6119626:1"]));
        Assert.That(back.Roles[Unit], Is.EqualTo(store.Roles[Unit]));
        Assert.That(back.Slots, Is.EqualTo(store.Slots));
        Assert.That(back.WorkRevision, Is.EqualTo(3));
        Assert.That(back.AppliedAt, Is.EqualTo(At));
        Assert.That(back.ToJson(), Is.EqualTo(store.ToJson()));
        Assert.That(store.ToJson(), Does.StartWith("""{"owner":"duct-losses","version":3,"data":{"rules":"""), "one version, in the envelope");
    }

    [Test]
    public void A_receipt_without_a_parameter_does_not_inherit_the_store_slot() {
        var back = Read(Stored($$$"""{"terminalFlows":{"{{{Terminal}}}":{"cfm":0,"appliedAt":"2026-10-04T12:00:00Z"}},"slots":{"terminalFlow":"Flow"}}""")).Value!;

        Assert.That(back.TerminalFlows[Terminal].Parameter, Is.Null);
        Assert.That(back.Slots!.TerminalFlow, Is.EqualTo("Flow"));
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

    [TestCase("""{"owner":"duct-losses","version":4,"data":{"workRevision":1}}""", "version 4")]
    [TestCase("""{"owner":"duct-losses","version":1,"data":{"workRevision":1}}""", "version 1")]
    [TestCase("""{"owner":"duct-losses","version":3,"data":{"version":3,"workRevision":1}}""", "belongs to the envelope")]
    [TestCase("""{"owner":"duct-losses","version":2,""", "not strict JSON")]
    public void A_store_this_build_cannot_read_is_a_refusal(string json, string message) {
        var read = Read(json);

        Assert.That(read.Value, Is.Null);
        Assert.That(read.Refusal, Does.Contain(message).And.Contain("unreadable"));
    }

    [TestCase(2, OwnerBlobStatus.UnknownVersion)]
    [TestCase(3, OwnerBlobStatus.Invalid)]
    public void Numeric_element_keys_never_become_UniqueIds(int version, OwnerBlobStatus expected) {
        var raw = Stored("""{"roles":{"42":{"role":"fan","ruledAt":"2026-10-04T12:00:00Z"}}}""", version);
        var blob = OwnerBlob.Decode(DuctLossStore.Owner, raw);

        Assert.That(blob.Status, Is.EqualTo(expected));
        Assert.That(blob.Replacement?.Status, Is.EqualTo(expected));
        Assert.That(blob.Raw, Is.EqualTo(raw));
        Assert.That(DuctLossStore.Read(blob).Value, Is.Null);
    }

    [TestCase(false)]
    [TestCase(true)]
    public void Data_refused_preview_is_pure_and_apply_requires_the_same_bytes(bool stale) {
        var root = Directory.CreateTempSubdirectory("pe-duct-replacement-").FullName;
        try {
            var owner = DuctLossStore.Owner;
            var raw = Stored("{\"roles\":{\"42\":{\"role\":\"fan\"}},\"note\":\"donn\u00e9e\"}");
            var bytes = Encoding.UTF8.GetBytes(raw);
            var envelope = owner with { ValidateData = null };
            var blob = OwnerBlob.Decode(envelope, raw);
            var refused = DuctLossStore.Read(blob);
            Assert.That(blob.Status, Is.EqualTo(OwnerBlobStatus.Ok));
            Assert.That(blob.Replacement, Is.Null);
            Assert.That(refused.Value, Is.Null);

            var replacement = blob.DataRefused(refused.Refusal!);
            var sha = Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();
            Assert.That(replacement, Is.EqualTo(new OwnerBlobReplacement(owner.Owner, OwnerBlobStatus.Invalid, refused.Refusal!, sha)));
            Assert.That(Encoding.UTF8.GetBytes(blob.Raw!), Is.EqualTo(bytes));
            Assert.That(Directory.GetFileSystemEntries(root), Is.Empty, "preview has no disk effects");

            var modelText = stale ? raw + " " : raw;
            var before = Encoding.UTF8.GetBytes(modelText);
            var next = new DuctLossStore { Roles = new() { [Unit] = new DuctRoleRecord("fan", At) } };
            void Apply() => modelText = OwnerBlob.Replace(OwnerBlob.Decode(envelope, modelText), next.ToData(),
                (evidence, kept) => StoredFile.KeepModelRecord(root, evidence.Owner, "Fixture model", kept, evidence.Reason),
                replacement) ?? modelText;

            if (stale) {
                Assert.That(Apply, Throws.InvalidOperationException.With.Message.Contains("changed since replacement"));
                Assert.That(Encoding.UTF8.GetBytes(modelText), Is.EqualTo(before));
                Assert.That(Directory.GetFileSystemEntries(root), Is.Empty);
                return;
            }

            Apply();
            Assert.That(Read(modelText).Value?.Roles[Unit].Role, Is.EqualTo("fan"));
            var recovery = Path.Combine(root, "model-recovery", "owner-duct-losses");
            var backup = Path.Combine(recovery, sha + ".txt");
            Assert.That(File.ReadAllBytes(backup), Is.EqualTo(bytes));
            var notices = Path.Combine(root, ProductPathNames.StoredNoticesFileName);
            Assert.That(File.ReadAllLines(notices), Has.Length.EqualTo(1));

            modelText = raw; // Simulate retry after the model transaction rolled back.
            Apply();
            Assert.That(modelText, Is.EqualTo(next.ToJson()));
            Assert.That(Directory.GetFiles(recovery), Is.EqualTo(new[] { backup }));
            Assert.That(File.ReadAllLines(notices), Has.Length.EqualTo(1));
        } finally {
            Directory.Delete(root, recursive: true);
        }
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
        Assert.That(back.Version, Is.EqualTo(3));
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
}
