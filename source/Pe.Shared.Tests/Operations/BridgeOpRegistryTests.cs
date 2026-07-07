using Pe.Shared.HostContracts.Operations;
using Pe.Shared.HostContracts.SettingsStorage;

namespace Pe.Revit.Tests;

[TestFixture]
public sealed class BridgeOpRegistryTests {
    [Test]
    public void Discovers_static_bridge_op_fields_from_the_contracts_assembly() {
        BridgeOpRegistry.RegisterFrom(typeof(RevitBridgeOps).Assembly);

        Assert.That(BridgeOpRegistry.TryGet("revit.catalog.loaded-families", out var catalogOp), Is.True);
        Assert.That(catalogOp.Definition.DisplayName, Is.EqualTo("Get Loaded Families Catalog"));
        Assert.That(BridgeOpRegistry.TryGet("settings.schema", out _), Is.True);
        Assert.That(BridgeOpRegistry.TryGet("scripting.execute", out _), Is.True);
        Assert.That(BridgeOpRegistry.TryGet("settings.module-catalog", out var internalOp), Is.True);
        Assert.That(internalOp.Definition.IsPublic, Is.False);
        Assert.That(BridgeOpRegistry.All.Count(), Is.GreaterThanOrEqualTo(35));
    }

    [Test]
    public void Registration_is_idempotent_and_rejects_conflicting_reuse_of_a_key() {
        BridgeOpRegistry.RegisterFrom(typeof(RevitBridgeOps).Assembly);
        // Same op instance again: fine.
        Assert.DoesNotThrow(() => BridgeOpRegistry.Register(RevitBridgeOps.ScheduleCatalog));

        var conflicting = BridgeOp.Create<NoRequest, SchemaData>(
            "revit.catalog.schedules",
            "Imposter",
            null,
            static (_, _, _) => Task.FromResult<SchemaData>(null!)
        );
        Assert.Throws<InvalidOperationException>(() => BridgeOpRegistry.Register(conflicting));
    }

    [Test]
    public void A_failed_scan_leaves_the_registry_untouched_and_a_retry_surfaces_the_same_error() {
        // First scan fails validation (3 CallGuidance entries) — nothing may be committed.
        var first = Assert.Throws<InvalidOperationException>(
            () => BridgeOpRegistry.RegisterFrom(typeof(BrokenScanFixture).Assembly));
        Assert.That(first!.Message, Does.Contain("CallGuidance"));
        Assert.That(BridgeOpRegistry.TryGet("test.fresh.op", out _), Is.False);
        Assert.That(BridgeOpRegistry.TryGet("test.invalid.op", out _), Is.False);

        // Retry (supervisor re-scans every 30s) must re-throw the real validation
        // error, not "registered twice" from a fresh-instance op left half-registered.
        var second = Assert.Throws<InvalidOperationException>(
            () => BridgeOpRegistry.RegisterFrom(typeof(BrokenScanFixture).Assembly));
        Assert.That(second!.Message, Does.Contain("CallGuidance"));
        Assert.That(second.Message, Does.Not.Contain("registered twice"));
    }

    // Mirrors the live failure: a property op produces a fresh BridgeOp per scan
    // (like CreateOpFromMethod does), alongside an op that fails validation.
    private static class BrokenScanFixture {
        public static BridgeOp Fresh => BridgeOp.Create<NoRequest, SchemaData>(
            "test.fresh.op",
            "Fresh Per Scan",
            null,
            static (_, _, _) => Task.FromResult<SchemaData>(null!)
        );

        // Property (not field) declared after Fresh, so a non-atomic scan commits
        // Fresh before this throws — the exact shape of the live failure.
        public static BridgeOp Invalid => BridgeOp.Create<NoRequest, SchemaData>(
            "test.invalid.op",
            "Too Much Guidance",
            HostOperationAgentMetadata.Create("bad", callGuidance: ["one", "two", "three"]),
            static (_, _, _) => Task.FromResult<SchemaData>(null!)
        );
    }

    [Test]
    public void Registration_rejects_request_examples_that_drifted_from_the_request_type() {
        var stale = BridgeOp.Create<SchemaRequest, SchemaData>(
            "test.stale.example",
            "Stale Example",
            HostOperationAgentMetadata.Create(
                "example JSON with a member the DTO no longer has",
                requestExamples: [
                    new HostOperationRequestExample(
                        "stale",
                        "rootKey was renamed",
                        """{ "moduleKey": "M", "rootKys": "r" }"""
                    )
                ]
            ),
            static (_, _, _) => Task.FromResult<SchemaData>(null!)
        );
        var ex = Assert.Throws<InvalidOperationException>(() => BridgeOpRegistry.Register(stale));
        Assert.That(ex!.Message, Does.Contain("does not deserialize"));
    }

    [Test]
    public void Registration_enforces_public_revit_key_taxonomy() {
        var invalid = BridgeOp.Create<NoRequest, SchemaData>(
            "revit.bogus-layer.thing",
            "Bad Key",
            null,
            static (_, _, _) => Task.FromResult<SchemaData>(null!)
        );
        Assert.Throws<InvalidOperationException>(() => BridgeOpRegistry.Register(invalid));
    }
}
