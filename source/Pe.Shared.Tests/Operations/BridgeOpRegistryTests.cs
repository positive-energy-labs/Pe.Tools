using Pe.Shared.HostContracts.Operations;
using Pe.Shared.HostContracts.SettingsStorage;

namespace Pe.Revit.Tests;

[TestFixture]
public sealed class OpRegistryTests {
    [Op(
        "test.registry.probe",
        Does = "Prove attributed handlers are discovered.",
        Title = "Registry Probe",
        IsPublic = false
    )]
    private static SchemaData Handle(NoRequest _) => null!;

    [Test]
    public void Discovers_attributed_handlers_and_registration_is_idempotent() {
        var assembly = typeof(OpRegistryTests).Assembly;

        OpRegistry.RegisterFrom(assembly);
        Assert.DoesNotThrow(() => OpRegistry.RegisterFrom(assembly));
        Assert.That(OpRegistry.TryGet("test.registry.probe", out var op), Is.True);
        Assert.That(op.Definition.DisplayName, Is.EqualTo("Registry Probe"));
        Assert.That(op.Definition.IsPublic, Is.False);
    }

    [Test]
    public void Registration_rejects_request_examples_that_drifted_from_the_request_type() {
        var attribute = new OpAttribute("test.stale.example") {
            Does = "Example JSON with a member the DTO no longer has.",
            Example = """{ "moduleKey": "M", "rootKys": "r" }"""
        };

        var exception = Assert.Throws<InvalidOperationException>(() =>
            OpRegistry.Define(attribute, typeof(SchemaRequest), typeof(SchemaData)));
        Assert.That(exception!.Message, Does.Contain("does not deserialize"));
    }

    [Test]
    public void Registration_enforces_public_revit_key_taxonomy() {
        var attribute = new OpAttribute("revit.bogus-layer.thing") { Does = "Invalid public key." };

        Assert.Throws<InvalidOperationException>(() =>
            OpRegistry.Define(attribute, typeof(NoRequest), typeof(SchemaData)));
    }
}
