using Pe.Revit.FamilyFoundry;
using Pe.Revit.FamilyFoundry.Reconcile;
using Pe.Shared.RevitData.Families;

namespace Pe.Revit.Tests.LibraryBehavior.NoDocumentRuntime;

/// <summary>FamilyPlan.IsIdentityOnlyMigration: which source migrations keep the pre-migration residue baseline. No Document.</summary>
[TestFixture]
public sealed class FamilyPlanIdentityMigrationTests {
    private static FamilyModel Model(params string[] names) => FamilyModelJson.Parse(
        """{"family":{"name":"x","category":"GenericModels","template":"Generic Model","placement":"OneLevelBased"},"parameters":{""" +
        string.Join(",", names.Select(name => $"\"{name}\":{{\"dataType\":\"Length\"}}")) + "}}").Value!;

    // The reconciler records one parameters.sources change per target; Before holds the target and every present source it names.
    private static FamilyPlan Plan(string target, params string[] present) {
        var before = Model(present).Parameters.ToDictionary(p => p.Key, p => p.Value);
        return new FamilyPlan([new FamilyChange("parameters.sources", target, ChangeKind.Update, null, before, Model(target).Parameters[target])],
            new OperationQueue(), [], [], "hash");
    }

    [Test]
    public void Existing_target_with_no_present_source_is_identity_only() =>
        Assert.That(Plan("Depth", "Depth").IsIdentityOnlyMigration(Model("Depth", "Keep"), Model("Depth", "Keep")), Is.True);

    [TestCase("Width", TestName = "WasNamed_source_present_is_not_identity_only")]
    [TestCase("Length", TestName = "Built_in_source_present_is_not_identity_only")]
    public void Present_source_is_not_identity_only(string source) =>
        Assert.That(Plan("Depth", "Depth", source).IsIdentityOnlyMigration(Model("Depth", source), Model("Depth", source)), Is.False);

    [Test]
    public void Created_target_is_not_identity_only() =>
        Assert.That(Plan("Depth").IsIdentityOnlyMigration(Model("Keep"), Model("Depth", "Keep")), Is.False);

    [Test]
    public void Created_parameter_is_not_identity_only() =>
        Assert.That(Plan("Depth", "Depth").IsIdentityOnlyMigration(Model("Depth"), Model("Depth", "Route")), Is.False);

    [Test]
    public void Removed_parameter_is_not_identity_only() =>
        Assert.That(Plan("Depth", "Depth").IsIdentityOnlyMigration(Model("Depth", "Old"), Model("Depth")), Is.False);
}
