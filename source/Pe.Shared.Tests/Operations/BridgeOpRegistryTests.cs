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
