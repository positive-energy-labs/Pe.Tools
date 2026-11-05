using NUnit.Framework;

using Pe.Revit.Takeoff;

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

    [Test]
    public void Codec_round_trips_and_preserves_identity()
    {
        var registry = Registry("FC-8", "FC-13", "UH-1");
        var loaded = SystemRegistry.Deserialize(registry.Serialize());
        Assert.That(loaded.Systems.Select(s => (s.Guid, s.Tag)),
            Is.EqualTo(registry.Systems.Select(s => (s.Guid, s.Tag))));
    }

    [TestCase("not json at all")]
    [TestCase("null")]
    [TestCase("{\"Version\":99,\"Systems\":[]}")]
    [TestCase("{\"Version\":1,\"Systems\":[{\"Guid\":\"00000000-0000-0000-0000-000000000000\",\"Tag\":\"FC-1\"}]}")]
    public void Codec_fails_closed_on_bad_blobs(string blob)
    {
        Assert.Throws<InvalidOperationException>(() => SystemRegistry.Deserialize(blob));
    }

    [Test]
    public void Duplicate_tags_and_guids_are_rejected()
    {
        var registry = Registry("FC-8");
        Assert.Throws<InvalidOperationException>(() => registry.Register("fc-8"));
        string forged = registry.Serialize().Replace("]", $",{{\"Guid\":\"{registry.Systems[0].Guid}\",\"Tag\":\"FC-9\"}}]");
        Assert.Throws<InvalidOperationException>(() => SystemRegistry.Deserialize(forged));
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
