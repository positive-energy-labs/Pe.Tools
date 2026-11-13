using System.Reflection;
using Pe.Revit.Operations;
using Pe.Shared.HostContracts.Operations;
using Pe.Shared.HostContracts.SettingsStorage;

namespace Pe.Revit.Tests;

[TestFixture]
public sealed class OpRegistryTests {
    [TestCase("revit.detail.space-build")]
    [TestCase("revit.detail.space-scene")]
    public void Declared_expensive_cost_survives_key_inference_in_the_public_catalog(string key) {
        var definition = OpRegistry.Define(new OpAttribute(key, OpSubject.Region, OpTouches.Geometry) {
            Does = "Expensive spatial ingest", Cost = OpCost.Expensive
        }, typeof(NoRequest), typeof(SchemaData));
        Assert.That(HostOpsCatalogEntry.FromDefinition(definition).CostTier, Is.EqualTo("Expensive"));
    }

    [Test]
    public void Mutation_requires_an_explicit_actor() {
        Assert.Throws<InvalidOperationException>(() => OpRegistry.Define(
            new OpAttribute("test.mutation", OpSubject.None, OpTouches.Metadata) { Does = "Mutate" }, typeof(NoRequest), typeof(SchemaData), effect: OpEffect.ModelWrite));
        foreach (var actor in Enum.GetValues<OpActor>()) {
            var definition = OpRegistry.Define(new OpAttribute("test.mutation", OpSubject.None, OpTouches.Metadata) {
                Does = "Mutate", Actor = actor
            }, typeof(NoRequest), typeof(SchemaData), effect: OpEffect.ModelWrite);
            Assert.That(HostOpsCatalogEntry.FromDefinition(definition).Actor, Is.EqualTo(actor.ToString().ToLowerInvariant()));
        }
    }

    private sealed record ProbeArtifact(IReadOnlyList<string> Elements);
    private sealed class BrokenAssembly : Assembly {
        public override Type[] GetTypes() =>
            throw new ReflectionTypeLoadException(Array.Empty<Type?>(), Array.Empty<Exception?>());
    }

    [Op(
        "test.registry.probe", OpSubject.None, OpTouches.Metadata,
        Does = "Prove attributed handlers are discovered.",
        Title = "Registry Probe",
        ArtifactMetadata = typeof(ProbeArtifact),
        IsPublic = false
    )]
    private static SchemaData Handle(NoRequest _) => null!;

    [Op("test.revit-document", OpSubject.None, OpTouches.Metadata, Does = "Prove presence-based Revit document needs.", IsPublic = false)]
    private static SchemaData HandleRevitDocument(NoRequest _, RevitDocument document) => null!;

    [Op("test.project-document", OpSubject.None, OpTouches.Metadata, Does = "Prove presence-based project document needs.", IsPublic = false)]
    private static SchemaData HandleProjectDocument(NoRequest _, ProjectDocument document) => null!;

    [Op("test.family-document", OpSubject.None, OpTouches.Metadata, Does = "Prove presence-based family document needs.", IsPublic = false)]
    private static SchemaData HandleFamilyDocument(NoRequest _, FamilyDocument document) => null!;

    [Op("test.human-verb", OpSubject.None, OpTouches.Metadata, Does = "Prove a human-only verb is declared on the catalog.", Actor = OpActor.Human, IsPublic = false)]
    private static SchemaData HandleHumanVerb(NoRequest _) => null!;

    // Effect is the scope (ADR 0042): the handler's signature is the only place an effect is stated.
    [Op("test.scope.transact-read", OpSubject.None, OpTouches.Metadata, Does = "A rollback preview.", IsPublic = false)]
    private static SchemaData HandleTransactRead(NoRequest _, ProjectDocument document, TransactRead scope) => null!;

    [Op("test.scope.session-write", OpSubject.None, OpTouches.Metadata, Does = "A view change.", Actor = OpActor.Any, IsPublic = false)]
    private static SchemaData HandleSessionWrite(NoRequest _, SessionWrite scope, CancellationToken cancellationToken) => null!;

    [Op("test.scope.model-write", OpSubject.None, OpTouches.Metadata, Does = "A model write.", Actor = OpActor.Any, IsPublic = false)]
    private static SchemaData HandleModelWrite(NoRequest _, RevitDocument document, ModelWrite scope, CancellationToken cancellationToken) => null!;

    private static SchemaData ScopeBeforeDocument(NoRequest _, ModelWrite scope, RevitDocument document) => null!;
    private static SchemaData WriteWithNoActor(NoRequest _, ModelWrite scope) => null!;

    [TestCase("test.registry.probe", "Read", "Read", false, false, "nothing")]
    [TestCase("test.scope.transact-read", "TransactRead", "Read", true, true, "project-document")]
    [TestCase("test.scope.session-write", "SessionWrite", "Mutate", false, true, "nothing")]
    [TestCase("test.scope.model-write", "ModelWrite", "Mutate", false, true, "document")]
    public void The_effect_and_its_four_catalog_columns_come_from_the_scope_in_the_signature(
        string key, string effect, string intent, bool rollsBack, bool usesTransactions, string needs) {
        OpRegistry.RegisterFrom(typeof(OpRegistryTests).Assembly);
        Assert.That(OpRegistry.TryGet(key, out var op), Is.True);
        var entry = HostOpsCatalogEntry.FromOp(op);
        Assert.That((entry.Effect, entry.Intent, entry.RollsBack, entry.UsesTransactions, entry.Needs),
            Is.EqualTo((effect, intent, rollsBack, usesTransactions, needs)));
    }

    [Test]
    public void A_scope_comes_after_the_document_and_a_write_names_its_actor() {
        MethodInfo Method(string name) => typeof(OpRegistryTests).GetMethod(name, BindingFlags.NonPublic | BindingFlags.Static)!;
        OpAttribute Attribute(OpActor? actor = null) => actor is { } named
            ? new("test.scope.invalid", OpSubject.None, OpTouches.Metadata) { Does = "Invalid.", IsPublic = false, Actor = named }
            : new("test.scope.invalid", OpSubject.None, OpTouches.Metadata) { Does = "Invalid.", IsPublic = false };
        Assert.That(Assert.Throws<InvalidOperationException>(() => OpRegistry.Define(Attribute(OpActor.Any), Method(nameof(ScopeBeforeDocument))))!.Message,
            Does.Contain("in that order"));
        Assert.That(Assert.Throws<InvalidOperationException>(() => OpRegistry.Define(Attribute(), Method(nameof(WriteWithNoActor))))!.Message,
            Does.Contain("must declare Actor"));
        Assert.DoesNotThrow(() => OpRegistry.Define(Attribute(OpActor.Any), Method(nameof(WriteWithNoActor))));
    }

    [Test]
    public void A_write_handed_no_scope_does_not_run() {
        OpRegistry.RegisterFrom(typeof(OpRegistryTests).Assembly);
        Assert.That(OpRegistry.TryGet("test.scope.session-write", out var op), Is.True);
        Assert.ThrowsAsync<InvalidOperationException>(() => op.ExecuteAsync("{}", null, null, CancellationToken.None));
    }

    [Test]
    public void The_catalog_names_who_may_run_an_op() {
        OpRegistry.RegisterFrom(typeof(OpRegistryTests).Assembly);
        Assert.That(OpRegistry.TryGet("test.human-verb", out var human), Is.True);
        Assert.That(OpRegistry.TryGet("test.registry.probe", out var any), Is.True);
        Assert.That(HostOpsCatalogEntry.FromOp(human).Actor, Is.EqualTo("human"));
        Assert.That(HostOpsCatalogEntry.FromOp(any).Actor, Is.EqualTo("any"));
    }

    [Test]
    public void Discovers_attributed_handlers_and_registration_is_idempotent() {
        var assembly = typeof(OpRegistryTests).Assembly;

        OpRegistry.RegisterFrom(assembly);
        Assert.DoesNotThrow(() => OpRegistry.RegisterFrom(assembly));
        Assert.That(OpRegistry.TryGet("test.registry.probe", out var op), Is.True);
        Assert.That(op.Definition.DisplayName, Is.EqualTo("Registry Probe"));
        Assert.That(op.Definition.IsPublic, Is.False);
        Assert.That((op.Definition.Effect, op.Definition.UsesTransactions), Is.EqualTo((OpEffect.Read, false)));
        Assert.That(op.Definition.ArtifactMetadataType, Is.EqualTo(typeof(ProbeArtifact)));
        Assert.That(HostOpsCatalogEntry.FromOp(op).ArtifactSchemaJson, Does.Contain("\"elements\""));
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
        var attribute = new OpAttribute("test.stale.example", OpSubject.None, OpTouches.Metadata) {
            Does = "Example JSON with a member the DTO no longer has.",
            Example = """{ "schemaUri": "/schemas/settings/M/r.json" }"""
        };

        var exception = Assert.Throws<InvalidOperationException>(() =>
            OpRegistry.Define(attribute, typeof(SchemaRequest), typeof(SchemaData)));
        Assert.That(exception!.Message, Does.Contain("does not deserialize"));
    }

    [Test]
    public void Registration_enforces_public_revit_key_taxonomy() {
        var attribute = new OpAttribute("revit.bogus-layer.thing", OpSubject.None, OpTouches.Metadata) { Does = "Invalid public key." };

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
