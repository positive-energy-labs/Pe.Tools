using Newtonsoft.Json.Linq;
using Pe.Shared.Product;
using Pe.Shared.StorageRuntime;
using System.Security.Cryptography;
using System.Text;
using NUnit.Framework;
using Pe.Revit.Takeoff;
using Pe.Shared.RevitData;
using Pe.Shared.RevitData.Ducts;
using Pe.Shared.RevitData.Serialization;

namespace Pe.Shared.Tests.RevitData;

/// <summary>
///     The one envelope for every Pe blob stored in a model (ADR 0032 storage amendment, homes freeze shapes 4 and 5):
///     strict decode, absent told from invalid told from unknown version, the cap, exact read-back, and each owner's
///     stored shape. The Revit round trip is <c>OwnerBlobRoundTripTests</c> in Pe.Revit.Tests.
/// </summary>
[TestFixture]
public sealed class OwnerBlobTests {
    private static readonly OwnerDescriptor Owner = new("test-owner", 3, new Guid("00000000-0000-0000-0000-0000000000a1"), "_PE_Test", "test");

    private static string Stored(string data, int version = 3, string owner = "test-owner") =>
        $$"""{"owner":"{{owner}}","version":{{version}},"data":{{data}}}""";

    [Test]
    public void Encodes_the_frozen_shape_and_decodes_it_back() {
        var text = OwnerBlob.Encode(Owner, new JObject { ["a"] = 1, ["nested"] = new JObject { ["b"] = "x" } });

        Assert.That(text, Is.EqualTo("""{"owner":"test-owner","version":3,"data":{"a":1,"nested":{"b":"x"}}}"""));
        var read = OwnerBlob.Decode(Owner, text);
        Assert.Multiple(() => {
            Assert.That(read.Status, Is.EqualTo(OwnerBlobStatus.Ok));
            Assert.That(read.Raw, Is.EqualTo(text));
            Assert.That(read.MayOverwrite, Is.True);
            Assert.That(OwnerBlob.Encode(Owner, read.Data!), Is.EqualTo(text), "decode then encode returns the same bytes");
        });
    }

    [TestCase(null)]
    [TestCase("")]
    [TestCase("  \n")]
    public void An_empty_value_is_absent_and_may_be_written(string? raw) {
        var read = OwnerBlob.Decode(Owner, raw);

        Assert.That(read.Status, Is.EqualTo(OwnerBlobStatus.Absent));
        Assert.That(read.MayOverwrite, Is.True);
        Assert.That(read.Parse(data => data), Is.EqualTo(new OwnerValue<JObject>(null, null)), "absent is neither a value nor a refusal");
    }

    [TestCase("null")]
    [TestCase("[]")]
    [TestCase("""{"version":3,"workRevision":1}""", Description = "an old flat shape")]
    [TestCase("""{"Version":1,"Systems":[]}""")]
    public void An_old_unenveloped_shape_is_absent_and_may_be_written_over(string raw) {
        var read = OwnerBlob.Decode(Owner, raw);

        Assert.Multiple(() => {
            Assert.That(read.Status, Is.EqualTo(OwnerBlobStatus.Absent));
            Assert.That(read.MayOverwrite, Is.True);
            Assert.That(read.Error, Is.Null);
            Assert.That(read.Raw, Is.EqualTo(raw));
            Assert.That(read.Parse(data => data), Is.EqualTo(new OwnerValue<JObject>(null, null)), "the owner starts from its defaults");
        });
    }

    [TestCase("not json at all", Description = "not provably old")]
    [TestCase("""{"version":3,"workRevision":1""", Description = "truncated")]
    [TestCase("""{"owner":"test-owner","version":3}""")]
    [TestCase("""{"owner":"test-owner","version":3,"data":[]}""")]
    [TestCase("""{"owner":"test-owner","version":3,"data":{},"extra":1}""")]
    [TestCase("""{"owner":"test-owner","version":"3","data":{}}""")]
    [TestCase("""{"owner":"test-owner","version":3.0,"data":{}}""")]
    [TestCase("""{"owner":"someone-else","version":3,"data":{}}""")]
    [TestCase("""{"owner":"test-owner","owner":"test-owner","version":3,"data":{}}""", Description = "duplicate key")]
    [TestCase("""{"owner":"test-owner","version":3,"data":{"a":1,"a":2}}""", Description = "duplicate key in the data")]
    [TestCase("""{"owner":"test-owner","version":3,"data":{}} trailing""")]
    [TestCase("""{"owner":"test-owner","version":3,"data":{}}{}""")]
    public void Anything_but_this_owners_envelope_is_invalid_and_kept(string raw) {
        var read = OwnerBlob.Decode(Owner, raw);

        Assert.Multiple(() => {
            Assert.That(read.Status, Is.EqualTo(OwnerBlobStatus.Invalid));
            Assert.That(read.Raw, Is.EqualTo(raw), "the refused bytes are handed back unchanged");
            Assert.That(read.MayOverwrite, Is.False);
            Assert.That(read.Error, Does.Contain("refused and kept"));
            Assert.That(read.Parse(data => data).Refusal, Is.EqualTo(read.Error), "a read hands the refusal back as a value");
            Assert.That(() => read.Parse(data => data).OrThrow(), Throws.InvalidOperationException, "only a write door throws it");
        });
    }

    [TestCase(4, Description = "a future version")]
    [TestCase(2, Description = "an older version: there is no migration")]
    [TestCase(0)]
    public void Any_other_version_is_unknown_and_kept(int version) {
        var raw = Stored("""{"future":true}""", version);
        var read = OwnerBlob.Decode(Owner, raw);

        Assert.Multiple(() => {
            Assert.That(read.Status, Is.EqualTo(OwnerBlobStatus.UnknownVersion));
            Assert.That(read.Raw, Is.EqualTo(raw));
            Assert.That(read.MayOverwrite, Is.False);
            Assert.That(read.Error, Does.Contain($"version {version}").And.Contain("version 3"));
        });
    }

    [Test]
    public void Nesting_past_the_depth_bound_is_refused_on_read_and_on_write() {
        var deep = new JObject();
        var cursor = deep;
        for (var i = 0; i < OwnerBlob.MaxDepth; i++) cursor = (JObject)(cursor["n"] = new JObject());
        var raw = Stored(deep.ToString(Newtonsoft.Json.Formatting.None));

        Assert.That(OwnerBlob.Decode(Owner, raw).Status, Is.EqualTo(OwnerBlobStatus.Invalid));
        Assert.That(() => OwnerBlob.Encode(Owner, deep), Throws.InvalidOperationException.With.Message.Contains("read back"));
    }

    [Test]
    public void A_blob_over_the_cap_is_refused_and_one_under_it_is_not() {
        JObject Sized(int chars) => new() { ["text"] = new string('x', chars) };

        Assert.That(() => OwnerBlob.Encode(Owner, Sized(OwnerBlob.MaxBytes)), Throws.InvalidOperationException.With.Message.Contains("cap"));
        Assert.That(System.Text.Encoding.UTF8.GetByteCount(OwnerBlob.Encode(Owner, Sized(OwnerBlob.MaxBytes - 100))), Is.LessThanOrEqualTo(OwnerBlob.MaxBytes));
        // The cap is bytes, not characters: a two-byte character counts twice.
        Assert.That(() => OwnerBlob.Encode(Owner, new JObject { ["text"] = new string('é', OwnerBlob.MaxBytes / 2) }), Throws.InvalidOperationException);
    }

    [Test]
    public void Date_like_text_and_numbers_read_back_exactly() {
        var raw = Stored("""{"at":"2026-10-04T12:00:00+00:00","n":0.1,"big":9007199254740993,"s":"1e5"}""");
        var read = OwnerBlob.Decode(Owner, raw);

        Assert.That(read.Status, Is.EqualTo(OwnerBlobStatus.Ok));
        Assert.That(OwnerBlob.Encode(Owner, read.Data!), Is.EqualTo(raw));
    }

    // ---- the project pointer (freeze shape 4)

    [Test]
    public void The_project_pointer_stores_the_frozen_shape() {
        var (pointer, error) = ProjectHomePointer.Create("Projects/2026-014 Chadds Ford");

        Assert.That(error, Is.Null);
        var text = OwnerBlob.Encode(ProjectHomePointer.Owner, pointer!.ToData());
        Assert.That(text, Is.EqualTo("""{"owner":"project-home","version":1,"data":{"path":"Projects/2026-014 Chadds Ford"}}"""));
        var back = ProjectHomePointer.FromData(OwnerBlob.Decode(ProjectHomePointer.Owner, text).Data!);
        Assert.That(back.Pointer!.Path, Is.EqualTo("Projects/2026-014 Chadds Ford"));
    }

    [TestCase("")]
    [TestCase(null)]
    [TestCase("G:/Projects/Chadds", Description = "a drive letter")]
    [TestCase("/Projects/Chadds", Description = "rooted")]
    [TestCase("Projects/Chadds/", Description = "trailing slash")]
    [TestCase("Projects//Chadds")]
    [TestCase("Projects\\Chadds", Description = "a backslash")]
    [TestCase("../Chadds")]
    [TestCase("Projects/./Chadds")]
    [TestCase("Projects/ Chadds")]
    [TestCase("Projects/Chadds.")]
    [TestCase("Projects/Cha?dds")]
    public void The_project_pointer_refuses_a_path_that_is_not_relative_forward_slash(string? path) {
        var (pointer, error) = ProjectHomePointer.Create(path);

        Assert.That(pointer, Is.Null);
        Assert.That(error, Is.Not.Null.And.Not.Empty);
    }

    [TestCase("""{}""")]
    [TestCase("""{"path":1}""")]
    [TestCase("""{"path":"Projects/Chadds","extra":true}""", Description = "an unknown key is refused, not dropped")]
    [TestCase("""{"path":"C:/Projects"}""")]
    public void The_project_pointer_refuses_data_that_is_not_exactly_a_path(string data) =>
        Assert.That(ProjectHomePointer.FromData(JObject.Parse(data)).Pointer, Is.Null);

    // ---- the keep policy (ADR 0039): one refused blob never throws past its reader

    private static IEnumerable<TestCaseData> OwnerReads() {
        static TestCaseData Case<T>(OwnerDescriptor owner, Func<OwnerBlobRead, OwnerValue<T>> read, string? unparseableData) where T : class =>
            new TestCaseData(owner, (Func<OwnerBlobRead, (bool HasValue, string? Refusal)>)(blob => {
                var value = read(blob);
                return (value.Value is not null, value.Refusal);
            }), unparseableData) { TestName = $"A_refused_{owner.Owner}_blob_is_a_refusal_value_not_an_exception" };

        yield return Case(DuctLossStore.Owner, DuctLossStore.Read, """{"version":2,"workRevision":1}""");
        yield return Case(ParameterLinkProfile.Owner, ParameterLinkProfile.Read, """{"definitions":[]}""");
        yield return Case(ProjectHomePointer.Owner, ProjectHomePointer.Read, """{"path":"C:/Projects"}""");
        yield return Case(SystemRegistry.Owner, SystemRegistry.Read, """{"systems":[{"guid":"not-a-guid","tag":"FC-1"}]}""");
        yield return Case(RegionProvenance.Owner, RegionProvenance.Read, """{"zoneGuid":"not-a-guid"}""");
        yield return Case(Pe.Revit.Partition.EnclosureDeclaration.Owner, Pe.Revit.Partition.EnclosureDeclaration.Parse, """{"solidSources":["Host"]}""");
        // AutoTag's data names Revit categories, so parsing it needs RevitAPI; the envelope refusals do not.
        yield return Case(Pe.Revit.SettingsRuntime.Modules.AutoTag.AutoTagSettings.Owner,
            Pe.Revit.SettingsRuntime.Modules.AutoTag.AutoTagSettings.Read, null);
    }

    [TestCaseSource(nameof(OwnerReads))]
    public void A_refused_blob_is_a_refusal_value_not_an_exception(
        OwnerDescriptor owner, Func<OwnerBlobRead, (bool HasValue, string? Refusal)> read, string? unparseableData) {
        var future = $$$"""{"owner":"{{{owner.Owner}}}","version":{{{owner.Version + 998}}},"data":{"fromTheFuture":true}}""";
        var broken = $$$"""{"owner":"{{{owner.Owner}}}","version":{{{owner.Version}}},"data":[]}""";

        Assert.Multiple(() => {
            foreach (var raw in new[] { future, broken, "not json" }) {
                var blob = OwnerBlob.Decode(owner, raw);
                (bool HasValue, string? Refusal) result = default;
                Assert.That(() => result = read(blob), Throws.Nothing, raw);
                Assert.That(result.HasValue, Is.False, raw);
                Assert.That(result.Refusal, Does.Contain("refused and kept"), raw);
                Assert.That(blob.Raw, Is.EqualTo(raw), "the bytes are handed back unchanged");
            }
            if (unparseableData is null) return;
            var enveloped = OwnerBlob.Decode(owner, $$$"""{"owner":"{{{owner.Owner}}}","version":{{{owner.Version}}},"data":{{{unparseableData}}}}""");
            var validatesData = owner.ValidateData is not null;
            Assert.That(enveloped.Status, Is.EqualTo(validatesData ? OwnerBlobStatus.Invalid : OwnerBlobStatus.Ok));
            Assert.That(enveloped.Replacement is not null, Is.EqualTo(validatesData));
            (bool HasValue, string? Refusal) parsed = default;
            Assert.That(() => parsed = read(enveloped), Throws.Nothing);
            Assert.That(parsed.HasValue, Is.False);
            Assert.That(parsed.Refusal, Does.Contain("refused and kept"));
        });
    }

    [Test]
    public void An_old_unenveloped_blob_gives_every_owner_its_defaults() {
        var old = """{"version":1,"enabled":true,"workRevision":2,"Systems":[]}""";

        Assert.Multiple(() => {
            Assert.That(DuctLossStore.Read(OwnerBlob.Decode(DuctLossStore.Owner, old)), Is.EqualTo(new OwnerValue<DuctLossStore>(null, null)));
            Assert.That(ParameterLinkProfile.Read(OwnerBlob.Decode(ParameterLinkProfile.Owner, old)), Is.EqualTo(new OwnerValue<ParameterLinkProfile>(null, null)));
            Assert.That(SystemRegistry.Read(OwnerBlob.Decode(SystemRegistry.Owner, old)), Is.EqualTo(new OwnerValue<SystemRegistry>(null, null)));
            Assert.That(ProjectHomePointer.Read(OwnerBlob.Decode(ProjectHomePointer.Owner, old)), Is.EqualTo(new OwnerValue<ProjectHomePointer>(null, null)));
            Assert.That(DuctLossResult.Decode("""[{"VelocityPressureInWg":0.5,"Coefficient":1.25}]"""), Is.Null, "an old bare list prices nothing until losses are reapplied");
        });
    }

    [TestCase(null)]
    [TestCase("""{"version":1,"zoneGuid":"6d52156a-3876-4d76-b641-341454252f26","runId":"run-1"}""", Description = "an old un-enveloped region blob")]
    [TestCase("""{"v":1,"view":"L1","name":"Zone","systemTag":"FC-8"}""", Description = "an old un-enveloped zone blob: no envelope, so its v is never read")]
    public void A_region_with_no_envelope_reads_as_the_drawn_default_not_a_refusal(string? stored) {
        var read = RegionProvenance.Read(OwnerBlob.Decode(RegionProvenance.Owner, stored));

        Assert.Multiple(() => {
            Assert.That(read.Refusal, Is.Null);
            Assert.That(read.Value!.RunId, Is.EqualTo(Rooms.RunDrawn));
            Assert.That(read.Value.ZoneGuid, Is.EqualTo(Guid.Empty));
            Assert.That(() => read.OrThrow(), Throws.Nothing, "a write run goes on too");
        });
    }

    [Test]
    public void A_region_blob_holds_no_version_of_its_own() {
        var provenance = new RegionProvenance(Guid.NewGuid(), "run-1", "R01", 100);
        var stored = OwnerBlob.Encode(RegionProvenance.Owner, JObject.Parse(provenance.ToJson()));

        Assert.That(stored, Does.StartWith("""{"owner":"takeoff-region","version":1,"data":{"zoneGuid":"""));
        Assert.That(JObject.Parse(provenance.ToJson()).Properties().Select(property => property.Name), Has.None.EqualTo("version").IgnoreCase);
        Assert.That(RegionProvenance.Read(OwnerBlob.Decode(RegionProvenance.Owner, stored)).Value!.ZoneGuid, Is.EqualTo(provenance.ZoneGuid));
        var withVersion = """{"owner":"takeoff-region","version":1,"data":{"version":1,"zoneGuid":"6d52156a-3876-4d76-b641-341454252f26"}}""";
        Assert.That(RegionProvenance.Read(OwnerBlob.Decode(RegionProvenance.Owner, withVersion)).Refusal, Does.Contain("belongs to the envelope"));
    }

    [TestCase("""{"version":1,"view":"L1","name":"Zone","systemTag":"FC-8"}""")]
    [TestCase("""{"v":1,"view":"L1","name":"Zone","systemTag":"FC-8"}""")]
    [TestCase("""{"Version":1,"zoneGuid":"6d52156a-3876-4d76-b641-341454252f26","runId":"run-1"}""")]
    public void A_blob_with_a_version_inside_its_data_is_refused_as_a_region_and_as_a_zone(string data) {
        var blob = OwnerBlob.Decode(RegionProvenance.Owner, $$$"""{"owner":"takeoff-region","version":1,"data":{{{data}}}}""");

        Assert.That(blob.Status, Is.EqualTo(OwnerBlobStatus.Ok));
        Assert.That(RegionProvenance.Read(blob).Refusal, Does.Contain("belongs to the envelope"));
        Assert.That(RegionProvenance.ReadZone(blob).Refusal, Does.Contain("belongs to the envelope"));
        Assert.That(RegionProvenance.ReadZone(blob).Value, Is.Null);
    }

    [Test]
    public void An_adopted_zone_reads_as_drawn_and_keeps_its_keys() {
        var blob = OwnerBlob.Decode(RegionProvenance.Owner,
            """{"owner":"takeoff-region","version":1,"data":{"view":"L1","name":"Zone","systemTag":"FC-8"}}""");
        var zone = RegionProvenance.ReadZone(blob).Value!;

        Assert.That(zone.RunId, Is.EqualTo(Rooms.RunDrawn));
        Assert.That(zone.Unknown.Keys, Is.EquivalentTo(new[] { "view", "name", "systemTag" }));
        Assert.That(RegionProvenance.ReadZone(OwnerBlob.Decode(RegionProvenance.Owner, null)).Value!.RunId, Is.EqualTo(Rooms.RunDrawn));
    }

    private static readonly JObject NewData = new() { ["a"] = 1 };

    [TestCase("")]
    [TestCase("backup")]
    [TestCase("notice")]
    public void Recovery_is_required_before_replacement_and_retries_are_idempotent(string blockedStep) {
        var state = Directory.CreateTempSubdirectory("pe-model-recovery-").FullName;
        try {
            var notices = Path.Combine(state, ProductPathNames.StoredNoticesFileName);
            var recovery = Path.Combine(state, "model-recovery");
            if (blockedStep == "backup") File.WriteAllText(recovery, "occupied");
            if (blockedStep == "notice") Directory.CreateDirectory(notices);
            var raw = Stored("{\"message\":\"donn\u00e9e\"}", version: 2);
            var modelText = raw;
            var bytes = Encoding.UTF8.GetBytes(raw);
            var hash = Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();
            var decoded = OwnerBlob.Decode(Owner, raw);
            var backup = Path.Combine(recovery, "owner-test-owner", hash + ".txt");
            Assert.That(decoded.Replacement, Is.EqualTo(new OwnerBlobReplacement(Owner.Owner, decoded.Status, decoded.Error!, hash)));
            Assert.That(File.Exists(backup), Is.False, "preview leaves the backup untouched");
            Assert.That(File.Exists(notices), Is.False, "preview posts no notice");

            void Apply() => modelText = OwnerBlob.Replace(OwnerBlob.Decode(Owner, modelText), NewData,
                (replacement, kept) => StoredFile.KeepModelRecord(state, replacement.Owner, "Fixture model",
                    kept, replacement.Reason)) ?? modelText;

            if (blockedStep.Length != 0) {
                Assert.That(Apply, Throws.Exception);
                Assert.That(Encoding.UTF8.GetBytes(modelText), Is.EqualTo(bytes));
                Assert.That(File.Exists(backup), Is.EqualTo(blockedStep == "notice"), "backup precedes the notice");
                if (blockedStep == "backup") File.Delete(recovery);
                else Directory.Delete(notices);
            }

            Apply();
            Assert.That(JToken.DeepEquals(OwnerBlob.Decode(Owner, modelText).Data, NewData), Is.True);
            Assert.That(File.ReadAllBytes(backup), Is.EqualTo(bytes));
            var notice = JObject.Parse(File.ReadLines(notices).Single());
            Assert.That((string?)notice["class"], Is.EqualTo("keep"));
            Assert.That((string?)notice["path"], Is.EqualTo(backup));
            Assert.That((string?)notice["sha256"], Is.EqualTo(hash));
            Assert.That((string?)notice["place"], Does.Contain("Fixture model").And.Contain(Owner.Owner));

            modelText = raw; // The model transaction may have rolled back after backup and notice.
            Apply();
            Assert.That(File.ReadAllLines(notices), Has.Length.EqualTo(1));
            Assert.That(Directory.GetFiles(recovery, "*", SearchOption.AllDirectories), Is.EqualTo(new[] { backup }));
            Assert.That(JToken.DeepEquals(OwnerBlob.Decode(Owner, modelText).Data, NewData), Is.True);
        } finally {
            Directory.Delete(state, recursive: true);
        }
    }

    [TestCase(null)]
    [TestCase("")]
    [TestCase("""{"version":3,"workRevision":1}""", Description = "an old un-enveloped shape")]
    [TestCase("""{"owner":"test-owner","version":3,"data":{"a":0}}""", Description = "this owner's own envelope")]
    public void A_readable_or_absent_value_can_be_written_without_recovery(string? stored) =>
        Assert.That(OwnerBlob.Replace(OwnerBlob.Decode(Owner, stored), NewData, (_, _) => Assert.Fail("no recovery needed")),
            Is.EqualTo("""{"owner":"test-owner","version":3,"data":{"a":1}}"""));

    [Test]
    public void A_write_of_the_stored_value_is_a_no_op() =>
        Assert.That(OwnerBlob.Replace(OwnerBlob.Decode(Owner, OwnerBlob.Encode(Owner, NewData)), NewData,
            (_, _) => Assert.Fail("no recovery needed")), Is.Null);

    // ---- owner shapes

    [Test]
    public void The_duct_results_entity_text_is_a_versioned_envelope() {
        var text = DuctLossResult.Encode([new DuctLossResult(0.5, 1.25), new DuctLossResult(0.25, 0)]);

        Assert.That(text, Is.EqualTo(
            """{"owner":"duct-loss-results","version":1,"data":{"results":[{"velocityPressureInWg":0.5,"coefficient":1.25},{"velocityPressureInWg":0.25,"coefficient":0.0}]}}"""));
        Assert.That(DuctLossResult.Decode(text), Is.EqualTo(new[] { new DuctLossResult(0.5, 1.25), new DuctLossResult(0.25, 0) }));
    }

    [TestCase(null)]
    [TestCase("""[{"VelocityPressureInWg":0.5,"Coefficient":1.25}]""", Description = "the bare list written before the envelope")]
    [TestCase("""{"owner":"duct-loss-results","version":2,"data":{"results":[]}}""")]
    [TestCase("""{"owner":"duct-loss-results","version":1,"data":{"results":[],"extra":1}}""")]
    [TestCase("""{"owner":"duct-loss-results","version":1,"data":{"results":[{"velocityPressureInWg":"x"}]}}""")]
    public void The_duct_results_entity_prices_nothing_from_text_it_cannot_read(string? text) =>
        Assert.That(DuctLossResult.Decode(text), Is.Null);

    [Test]
    public void The_system_registry_stores_the_envelope_with_no_inner_version() {
        var registry = new SystemRegistry();
        var entry = registry.Register("FC-8");

        Assert.That(OwnerBlob.Encode(SystemRegistry.Owner, registry.ToData()), Is.EqualTo(
            $$$"""{"owner":"takeoff-systems","version":1,"data":{"systems":[{"guid":"{{{entry.Guid:D}}}","tag":"FC-8"}]}}"""));
    }

    [Test]
    public void Every_owner_has_its_own_name_parameter_and_guid() {
        OwnerDescriptor[] owners = [
            ProjectHomePointer.Owner, DuctLossStore.Owner, DuctLossResult.Owner, ParameterLinkProfile.Owner, SystemRegistry.Owner,
            RegionProvenance.Owner, Pe.Revit.Partition.EnclosureDeclaration.Owner, Pe.Revit.SettingsRuntime.Modules.AutoTag.AutoTagSettings.Owner
        ];

        Assert.Multiple(() => {
            Assert.That(owners.Select(o => o.Owner), Is.Unique);
            Assert.That(owners.Select(o => o.Guid), Is.Unique);
            Assert.That(owners.Select(o => o.Name), Is.Unique);
            Assert.That(owners.Select(o => o.Version), Is.All.GreaterThan(0));
        });
    }
}
