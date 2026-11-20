
using Newtonsoft.Json.Linq;
using Pe.Revit.Takeoff;
using Pe.Shared.Product;
using Pe.Shared.StorageRuntime;
using System.Text;
using Pe.Shared.RevitData.Serialization;

namespace Pe.Takeoff.Tests;

// The identity spine's root, exercised on project-a-shaped scenarios: the IU->WS mid-project rename,
// the phantom dangling tag, the multi-tag zone, and the UH-2-4 range trap.
public sealed class SystemRegistryTests
{
    private static SystemRegistry Registry(params string[] tags)
    {
        var registry = new SystemRegistry();
        foreach (string tag in tags) registry.Register(tag);
        return registry;
    }

    private static string Stored(SystemRegistry registry) => OwnerBlob.Encode(SystemRegistry.Owner, registry.ToData());

    private static OwnerValue<SystemRegistry> Read(string? stored) => SystemRegistry.Read(OwnerBlob.Decode(SystemRegistry.Owner, stored));

    [Test]
    public void Codec_round_trips_and_preserves_identity()
    {
        var registry = Registry("FC-8", "FC-13", "UH-1");
        var loaded = Read(Stored(registry)).Value!;
        Assert.That(loaded.Systems.Select(s => (s.Guid, s.Tag)),
            Is.EqualTo(registry.Systems.Select(s => (s.Guid, s.Tag))));
    }

    [TestCase("not json at all")]
    [TestCase("{\"owner\":\"takeoff-systems\",\"version\":99,\"data\":{\"systems\":[]}}")]
    [TestCase("{\"owner\":\"takeoff-systems\",\"version\":1,\"data\":{\"systems\":[],\"extra\":1}}")]
    [TestCase("{\"owner\":\"takeoff-systems\",\"version\":1,\"data\":{\"systems\":[{\"guid\":\"00000000-0000-0000-0000-000000000000\",\"tag\":\"FC-1\"}]}}")]
    public void A_bad_blob_is_a_refusal_with_no_registry(string blob)
    {
        var read = Read(blob);
        Assert.That(read.Value, Is.Null);
        Assert.That(read.Refusal, Does.Contain("unreadable"));
    }

    [Test]
    public void Sealed_registry_apply_preserves_bytes_and_posts_one_notice()
    {
        const string raw = """{"owner":"takeoff-systems","version":1,"data":{"systems":{"tag":"?tage"}}}""";
        const string document = "registry-fixture.rvt";
        var stored = OwnerBlob.Decode(SystemRegistry.Owner, raw);
        var preview = stored.Replacement!;
        var registry = Registry("FC-8");
        var root = Directory.CreateTempSubdirectory("pe-takeoff-registry-recovery-");
        try
        {
            void Keep(OwnerBlobReplacement evidence, string bytes) =>
                StoredFile.KeepModelRecord(root.FullName, evidence.Owner, document, bytes, evidence.Reason);

            Assert.That(stored.Status, Is.EqualTo(OwnerBlobStatus.Invalid));
            Assert.That(preview.Reason, Does.Contain("systems"));
            Assert.That(() => OwnerBlob.Replace(stored, registry.ToData(), Keep),
                Throws.InvalidOperationException.With.Message.Contains("Preview before"));
            Assert.That(root.EnumerateFileSystemInfos(), Is.Empty);

            var updated = OwnerBlob.Replace(stored, registry.ToData(), Keep, preview);
            var backup = Path.Combine(root.FullName, "model-recovery", "owner-takeoff-systems", preview.RawUtf8Sha256 + ".txt");
            Assert.That(File.ReadAllBytes(backup), Is.EqualTo(Encoding.UTF8.GetBytes(raw)));
            var notices = Path.Combine(root.FullName, ProductPathNames.StoredNoticesFileName);
            var notice = JObject.Parse(File.ReadLines(notices).Single());
            Assert.That(notice.Value<string>("documentKey"), Is.EqualTo(document));
            Assert.That(notice.Value<string>("reason"), Does.Contain("replacing the model record"));
            Assert.That(Read(updated).OrThrow()!.Systems.Single().Guid, Is.EqualTo(registry.Systems.Single().Guid));
        }
        finally { root.Delete(true); }
    }

    [TestCase(null)]
    [TestCase("null")]
    [TestCase("{\"Version\":1,\"Systems\":[]}")]
    public void No_envelope_is_an_empty_registry(string? blob) =>
        Assert.That(Read(blob), Is.EqualTo(new OwnerValue<SystemRegistry>(null, null)));

    [Test]
    public void Duplicate_tags_and_guids_are_rejected()
    {
        var registry = Registry("FC-8");
        Assert.Throws<InvalidOperationException>(() => registry.Register("fc-8"));
        string forged = Stored(registry).Replace("]", $",{{\"guid\":\"{registry.Systems[0].Guid}\",\"tag\":\"FC-9\"}}]");
        Assert.That(Read(forged).Refusal, Does.Contain("duplicate system GUID"));
    }

    [Test]
    public void Rename_keeps_guid_and_blocks_collisions()
    {
        var registry = Registry("IU-1", "FC-8");
        var guid = registry.FindByTag("IU-1")!.Guid;
        registry.Rename(guid, "WS-1");
        Assert.Multiple(() => {
            Assert.That(registry.FindByTag("WS-1")!.Guid, Is.EqualTo(guid));
            Assert.That(registry.FindByTag("IU-1"), Is.Null);
            Assert.Throws<InvalidOperationException>(() => registry.Rename(guid, "FC-8"));
        });
    }

    [Test]
    public void Reconcile_resolves_matches_and_asks_about_rename_pairs()
    {
        var registry = Registry("IU-1", "FC-8");
        var report = registry.Reconcile(new[] { "WS-1", "fc-8" });
        Assert.Multiple(() => {
            Assert.That(report.Resolved["fc-8"], Is.EqualTo(registry.FindByTag("FC-8")!.Guid));
            Assert.That(report.Appeared, Is.EqualTo(new[] { "WS-1" }));
            Assert.That(report.Vanished.Single().Tag, Is.EqualTo("IU-1"));
            Assert.That(report.RenameCandidates.Single(),
                Is.EqualTo((registry.FindByTag("IU-1")!, "WS-1")));
            Assert.That(report.NeedsHuman, Is.True);
        });
    }

    [Test]
    public void Reconcile_in_sync_needs_no_human()
    {
        var registry = Registry("FC-8", "FC-13");
        var report = registry.Reconcile(new[] { "FC-8", "FC-13", "FC-8" });
        Assert.Multiple(() => {
            Assert.That(report.NeedsHuman, Is.False);
            Assert.That(report.RenameCandidates, Is.Empty);
        });
    }

    [Test]
    public void Tag_parse_splits_lists_and_flags_range_forms()
    {
        var (tags, warnings) = SystemTags.Parse(" FC-8, FC-13; UH-2-4 ,");
        Assert.Multiple(() => {
            Assert.That(tags, Is.EqualTo(new[] { "FC-8", "FC-13", "UH-2-4" }));
            Assert.That(warnings.Single(), Does.Contain("UH-2-4").And.Contain("range"));
        });
    }
}
