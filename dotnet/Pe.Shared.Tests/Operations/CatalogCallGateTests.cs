using Pe.Shared.HostContracts.Operations;
namespace Pe.Revit.Tests;
[TestFixture]
public sealed class CatalogCallGateTests {
    private static HostOperationDefinition Leaf(OpSubject subject, OpEffect effect = OpEffect.Read, bool internalLeaf = false, bool rollback = false) =>
        new("test.leaf", typeof(NoRequest), typeof(NoRequest), Subject: subject, Touches: OpTouches.Geometry,
            Effect: effect, Internal: internalLeaf, RollsBack: rollback);
    [TestCase("ducts.snapshot", "{\"selector\":{\"kind\":\"ids\",\"ids\":[1]}}")]
    [TestCase("revit.catalog.electrical-circuits", "{\"options\":{\"includeNearbyProxyContext\":false}}")]
    public void Request_strings_cannot_override_declared_document_geometry(string key, string payload) {
        var definition = Leaf(OpSubject.Document) with { Key = key };
        Assert.Catch(() => OpCallGate.Require(definition, null, payload));
    }
    [Test]
    public void Direct_internal_write_is_refused_but_a_derived_command_reaches_it() {
        var leaf = Leaf(OpSubject.Elements, OpEffect.ModelWrite, internalLeaf: true);
        Assert.Catch(() => OpCallGate.Require(leaf, null));
        Assert.DoesNotThrow(() => OpCallGate.Require(leaf, "ducts.apply-heal"));
    }
    [Test]
    public void Whole_project_geometry_is_refused_but_a_family_or_bounded_subject_is_allowed() {
        Assert.Catch(() => OpCallGate.Require(Leaf(OpSubject.Document), null));
        Assert.DoesNotThrow(() => OpCallGate.Require(Leaf(OpSubject.FamilyDocument), null));
        Assert.DoesNotThrow(() => OpCallGate.Require(Leaf(OpSubject.Elements), null));
    }
    [Test]
    public void Transactional_reads_must_declare_rollback() {
        Assert.Catch(() => OpCallGate.Require(Leaf(OpSubject.Elements, OpEffect.TransactRead), null));
        Assert.DoesNotThrow(() => OpCallGate.Require(Leaf(OpSubject.Elements, OpEffect.TransactRead, rollback: true), null));
    }
}
