using Pe.Shared.HostContracts.Operations;
using Pe.Shared.HostContracts.SettingsStorage;

namespace Pe.Revit.Tests;

[TestFixture]
public sealed class OpRegistryTests {
    private readonly record struct ProjectDocument(object Value);

    [Op(
        "test.registry.probe",
        Does = "Prove attributed handlers are discovered.",
        Title = "Registry Probe",
        IsPublic = false
    )]
    private static SchemaData Handle(NoRequest _) => null!;

    [Op("test.project-document", Does = "Prove presence-based project document needs.", IsPublic = false)]
    private static SchemaData HandleProject(NoRequest _, ProjectDocument __) => null!;

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

    [Test]
    public void A_ProjectDocument_op_refuses_a_family_document_as_an_invalid_request() {
        OpRegistry.RegisterFrom(typeof(OpRegistryTests).Assembly);
        Assert.That(OpRegistry.TryGet("test.project-document", out var op), Is.True);
        Assert.That(op.Definition.Needs, Is.EqualTo(OpNeeds.ProjectDocument));

        var exception = Assert.Throws<BridgeOperationException>(() =>
            OpDocumentGate.Require(op.Definition.Needs, hasDocument: true, isFamilyDocument: true));
        Assert.That(exception!.StatusCode, Is.EqualTo(BridgeOperationExceptions.BadRequestStatusCode));
        Assert.That(exception.Message, Does.Contain("project document"));
        Assert.That(exception.Message, Does.Contain("family document"));
        Assert.That(exception.Issues.Single().Code, Is.EqualTo("InvalidRequest"));
    }
}
