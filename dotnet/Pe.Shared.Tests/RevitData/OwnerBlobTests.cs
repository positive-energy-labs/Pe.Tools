using Newtonsoft.Json.Linq;
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
        Assert.That(read.DataOrThrow(), Is.Null);
    }

    [TestCase("not json at all")]
    [TestCase("null")]
    [TestCase("[]")]
    [TestCase("""{"version":3,"workRevision":1}""", Description = "an old flat shape")]
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
            Assert.That(() => read.DataOrThrow(), Throws.InvalidOperationException);
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

        Assert.That(registry.Serialize(), Is.EqualTo(
            $$$"""{"owner":"takeoff-systems","version":1,"data":{"systems":[{"guid":"{{{entry.Guid:D}}}","tag":"FC-8"}]}}"""));
    }

    [Test]
    public void Every_owner_has_its_own_name_parameter_and_guid() {
        OwnerDescriptor[] owners = [ProjectHomePointer.Owner, DuctLossStore.Owner, DuctLossResult.Owner, ParameterLinkProfile.Owner, SystemRegistry.Owner];

        Assert.Multiple(() => {
            Assert.That(owners.Select(o => o.Owner), Is.Unique);
            Assert.That(owners.Select(o => o.Guid), Is.Unique);
            Assert.That(owners.Select(o => o.Name), Is.Unique);
            Assert.That(owners.Select(o => o.Version), Is.All.GreaterThan(0));
        });
    }
}
