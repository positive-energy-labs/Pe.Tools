using System.Reflection;
using Pe.Revit.Operations;
using Pe.Shared.HostContracts.Operations;
using Pe.Shared.HostContracts.SettingsStorage;

namespace Pe.Revit.Tests;

[TestFixture]
public sealed class OpRegistryTests {
    private sealed class BrokenAssembly : Assembly {
        public override Type[] GetTypes() =>
            throw new ReflectionTypeLoadException(Array.Empty<Type?>(), Array.Empty<Exception?>());
    }

    [Op(
        "test.registry.probe",
        Does = "Prove attributed handlers are discovered.",
        Title = "Registry Probe",
        IsPublic = false
    )]
    private static SchemaData Handle(NoRequest _) => null!;

    [Op("test.revit-document", Does = "Prove presence-based Revit document needs.", IsPublic = false)]
    private static SchemaData HandleRevitDocument(NoRequest _, RevitDocument document) => null!;

    [Op("test.project-document", Does = "Prove presence-based project document needs.", IsPublic = false)]
    private static SchemaData HandleProjectDocument(NoRequest _, ProjectDocument document) => null!;

    [Op("test.family-document", Does = "Prove presence-based family document needs.", IsPublic = false)]
    private static SchemaData HandleFamilyDocument(NoRequest _, FamilyDocument document) => null!;

    [Test]
    public void Discovers_attributed_handlers_and_registration_is_idempotent() {
        var assembly = typeof(OpRegistryTests).Assembly;

        OpRegistry.RegisterFrom(assembly);
        Assert.DoesNotThrow(() => OpRegistry.RegisterFrom(assembly));
        Assert.That(OpRegistry.TryGet("test.registry.probe", out var op), Is.True);
        Assert.That(op.Definition.DisplayName, Is.EqualTo("Registry Probe"));
        Assert.That(op.Definition.IsPublic, Is.False);
        Assert.That(op.Thread, Is.EqualTo(OpThread.Any));
        Assert.That(OpRegistry.TryGet("test.revit-document", out var revitOp), Is.True);
        Assert.That(revitOp.Definition.Needs, Is.EqualTo(OpNeeds.Document));
        Assert.That(revitOp.Thread, Is.EqualTo(OpThread.Revit));
        Assert.That(OpRegistry.TryGet("test.project-document", out var projectOp), Is.True);
        Assert.That(projectOp.Definition.Needs, Is.EqualTo(OpNeeds.ProjectDocument));
        Assert.That(projectOp.Thread, Is.EqualTo(OpThread.Revit));
        Assert.That(OpRegistry.TryGet("test.family-document", out var familyOp), Is.True);
        Assert.That(familyOp.Definition.Needs, Is.EqualTo(OpNeeds.FamilyDocument));
        Assert.That(familyOp.Thread, Is.EqualTo(OpThread.Revit));
    }

    [Test]
    public void Registration_does_not_hide_incomplete_type_discovery() {
        Assert.Throws<ReflectionTypeLoadException>(() => OpRegistry.RegisterFrom(new BrokenAssembly()));
    }

    [Test]
    public void Registration_rejects_request_examples_that_drifted_from_the_request_type() {
        var attribute = new OpAttribute("test.stale.example") {
            Does = "Example JSON with a member the DTO no longer has.",
            Example = """{ "schemaUri": "/schemas/settings/M/r.json" }"""
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
