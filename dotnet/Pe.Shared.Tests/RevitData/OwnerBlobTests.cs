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
    // The envelope tests deliberately use arbitrary owner data.
    private static readonly OwnerDescriptor Owner = new("test-owner", 3, new Guid("00000000-0000-0000-0000-0000000000a1"), "_PE_Test", "test", static _ => null);

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
            Assert.That(OwnerBlob.Encode(Owner, read.Data!), Is.EqualTo(text), "decode then encode returns the same bytes");
        });
    }

    [TestCase(null)]
    [TestCase("")]
    [TestCase("  \n")]
    public void An_empty_value_is_absent_and_may_be_written(string? raw) {
        var read = OwnerBlob.Decode(Owner, raw);

        Assert.That(read.Status, Is.EqualTo(OwnerBlobStatus.Absent));
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
            Assert.That(read.Error, Does.Contain("unreadable"));
            Assert.That(read.Parse(data => data).Refusal, Is.EqualTo(read.Error), "a read hands the refusal back as a value");
            Assert.That(() => read.Parse(data => data).OrThrow(), Throws.InvalidOperationException, "only a write door throws it");
        });
    }

    [TestCase(2, Description = "an older version: there is no migration")]
    [TestCase(0)]
    public void An_older_version_can_be_replaced_after_keeping_its_bytes(int version) {
        var raw = Stored("""{"future":true}""", version);
        var read = OwnerBlob.Decode(Owner, raw);

        Assert.Multiple(() => {
            Assert.That(read.Status, Is.EqualTo(OwnerBlobStatus.UnknownVersion));
            Assert.That(read.Raw, Is.EqualTo(raw));
            Assert.That(read.Error, Does.Contain($"version {version}").And.Contain("version 3"));
        });
        var kept = new List<string>();
        var updated = OwnerBlob.Replace(read, new JObject(), (_, bytes) => kept.Add(bytes), read.Replacement);
        Assert.That(kept, Is.EqualTo(new[] { raw }));
        Assert.That(OwnerBlob.Decode(Owner, updated).Status, Is.EqualTo(OwnerBlobStatus.Ok));
    }

    [TestCase("4")]
    [TestCase("9223372036854775808")]
    public void A_newer_version_refuses_even_with_matching_replacement_evidence(string version) {
        var raw = $$$"""{"owner":"{{{Owner.Owner}}}","version":{{{version}}},"data":{"future":true}}""";
        var read = OwnerBlob.Decode(Owner, raw);
        var evidence = OwnerBlob.Decode(Owner with { Owner = "another-owner" }, raw).Replacement! with { Owner = Owner.Owner };

        Assert.That((read.Status, read.Newer), Is.EqualTo((OwnerBlobStatus.UnknownVersion, true)));
        Assert.That(read.Raw, Is.EqualTo(raw));
        Assert.That(read.Replacement, Is.Null);
        foreach (var replacing in new[] { null, evidence })
            Assert.That(() => OwnerBlob.Replace(read, new JObject(), (_, _) => Assert.Fail("Recovery must not run"), replacing),
                Throws.InvalidOperationException.With.Message.Contains("a newer Pe wrote").And.Message.Contains("update Pe"));
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
        yield return Case(RoomsRegionRecord.Owner, RoomsRegionRecord.Decode, """{"regions":[]}""");
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
                Assert.That(result.Refusal, Does.Contain("unreadable"), raw);
                Assert.That(blob.Raw, Is.EqualTo(raw), "the bytes are handed back unchanged");
            }
            if (unparseableData is null) return;
            var enveloped = OwnerBlob.Decode(owner, $$$"""{"owner":"{{{owner.Owner}}}","version":{{{owner.Version}}},"data":{{{unparseableData}}}}""");
            Assert.That(enveloped.Status, Is.EqualTo(OwnerBlobStatus.Invalid));
            Assert.That(enveloped.Replacement, Is.Not.Null);
            (bool HasValue, string? Refusal) parsed = default;
            Assert.That(() => parsed = read(enveloped), Throws.Nothing);
            Assert.That(parsed.HasValue, Is.False);
            Assert.That(parsed.Refusal, Does.Contain("unreadable"));
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
                    kept, replacement.Reason), decoded.Replacement) ?? modelText;

            Assert.That(() => OwnerBlob.Replace(decoded, NewData, (_, _) => Assert.Fail("must not recover")),
                Throws.InvalidOperationException.With.Message.Contains("Preview before replacing"));
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

    [Test]
    public void A_lone_surrogate_has_an_exact_recovery_file_and_two_documents_have_two_notices() {
        var root = Directory.CreateTempSubdirectory("pe-model-surrogate-").FullName;
        try {
            var read = OwnerBlob.Decode(Owner, new string('\ud800', 1));
            var seal = read.Replacement!;
            foreach (var key in new[] { "project:a", "project:b", "project:a" })
                Assert.That(OwnerBlob.Replace(read, NewData, (evidence, kept) =>
                    StoredFile.KeepModelRecord(root, evidence.Owner, key, kept, evidence.Reason), seal), Is.Not.Null);
            var backup = Directory.GetFiles(root, "*.utf16le", SearchOption.AllDirectories).Single();
            Assert.That(File.ReadAllBytes(backup), Is.EqualTo(new byte[] { 0xff, 0xfe, 0, 0xd8 }));
            var rows = File.ReadLines(Path.Combine(root, ProductPathNames.StoredNoticesFileName)).Select(JObject.Parse).ToList();
            Assert.That(rows.Select(row => (string?)row["place"]), Is.EquivalentTo(new[] { "project:a / test-owner", "project:b / test-owner" }));
            Assert.That(rows.Select(row => (string?)row["sha256"]), Is.All.EqualTo(seal.RawUtf8Sha256));
        } finally {
            Directory.Delete(root, recursive: true);
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

    [Test]
    public void A_matching_seal_cannot_recover_a_readable_record() {
        var raw = OwnerBlob.Encode(Owner, NewData);
        var stored = OwnerBlob.Decode(Owner, raw);
        var evidence = OwnerBlob.Decode(Owner with { Version = Owner.Version + 1 }, raw).Replacement!;
        Assert.That(() => OwnerBlob.Replace(stored, new JObject { ["a"] = 2 },
                (_, _) => Assert.Fail("a readable record must not be backed up or noticed"), evidence),
            Throws.InvalidOperationException.With.Message.Contains("is readable"));
    }

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

    [TestCase("""{"results":[null]}""")]
    [TestCase("""{"results":[{"velocityPressureInWg":0.5}]}""")]
    [TestCase("""{"results":[{"velocityPressureInWg":"x","coefficient":1.25}]}""")]
    public void The_duct_results_descriptor_seals_unparseable_owner_data(string data) {
        var raw = $$"""{"owner":"duct-loss-results","version":1,"data":{{data}}}""";
        var read = OwnerBlob.Decode(DuctLossResult.Owner, raw);
        Assert.That(read.Status, Is.EqualTo(OwnerBlobStatus.Invalid));
        Assert.That(read.Replacement, Is.Not.Null);
        Assert.That(read.Raw, Is.EqualTo(raw));
    }

    [Test]
    public void The_system_registry_stores_the_envelope_with_no_inner_version() {
        var registry = new SystemRegistry();
        var entry = registry.Register("FC-8");

        Assert.That(OwnerBlob.Encode(SystemRegistry.Owner, registry.ToData()), Is.EqualTo(
            $$$"""{"owner":"takeoff-systems","version":1,"data":{"systems":[{"guid":"{{{entry.Guid:D}}}","tag":"FC-8"}]}}"""));
    }

    [Test]
    public void The_owner_constructor_requires_a_validator() {
        Assert.That(typeof(OwnerDescriptor).GetConstructors().All(ctor => ctor.GetParameters().Any(parameter =>
            parameter.ParameterType == typeof(Func<OwnerBlobRead, string>) && !parameter.IsOptional)), Is.True);
        Assert.Throws<ArgumentNullException>(() => new OwnerDescriptor("test", 1, Guid.Empty, "_PE_Test", "test", null!));
    }

    [Test]
    public void Every_owner_has_its_own_name_parameter_and_guid() {
        OwnerDescriptor[] owners = [
            ProjectHomePointer.Owner, DuctLossStore.Owner, DuctLossResult.Owner, ParameterLinkProfile.Owner, SystemRegistry.Owner,
            RoomsRegionRecord.Owner, Pe.Revit.Partition.EnclosureDeclaration.Owner, Pe.Revit.SettingsRuntime.Modules.AutoTag.AutoTagSettings.Owner
        ];

        Assert.Multiple(() => {
            Assert.That(owners.Select(o => o.Owner), Is.Unique);
            Assert.That(owners.Select(o => o.Guid), Is.Unique);
            Assert.That(owners.Select(o => o.Name), Is.Unique);
            Assert.That(owners.Select(o => o.Version), Is.All.GreaterThan(0));
            Assert.That(owners.Select(o => o.ValidateData), Is.All.Not.Null);
        });
    }
}
