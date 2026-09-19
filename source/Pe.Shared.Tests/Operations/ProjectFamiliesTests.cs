using Pe.Revit.Extensions.ProjDocument;

namespace Pe.Shared.Tests.Operations;

/// <summary>families.plan names its families (seam-domains-families-plan-by-name): the request refusals and the per-name resolution, without Revit.</summary>
[TestFixture]
public sealed class ProjectFamiliesTests {
    private static readonly LoadedFamily[] Loaded = [
        new("Damper", 10, true, "Duct Accessories"),
        new("Twin", 20, true, "Generic Models"),
        new("Twin", 21, true, "Mechanical Equipment"),
        new("Wall Room", 30, false, "Generic Models")
    ];

    [Test]
    public void An_empty_name_list_is_refused() =>
        Assert.That(ProjectFamilies.RequestRefusals([]).Single().Code, Is.EqualTo("family-names-empty"));

    [Test]
    public void A_duplicate_name_is_refused_by_name() {
        var refusal = ProjectFamilies.RequestRefusals(["Damper", "Twin", "Damper"]).Single();
        Assert.That(refusal.Code, Is.EqualTo("family-name-duplicate"));
        Assert.That(refusal.Message, Is.EqualTo("'Damper' is named more than once."));
    }

    [Test]
    public void Distinct_names_pass() => Assert.That(ProjectFamilies.RequestRefusals(["Damper", "damper"]), Is.Empty);

    [Test]
    public void Each_name_resolves_to_one_id_or_one_refusal() {
        var resolved = ProjectFamilies.Resolve(Loaded, ["Damper", "damper", "Twin", "Wall Room"]);
        Assert.Multiple(() => {
            Assert.That(resolved[0], Is.EqualTo(new FamilyNameResolution("Damper", 10)));
            Assert.That(resolved[1], Is.EqualTo(new FamilyNameResolution("damper", null, "family-not-found", "No loaded family named 'damper'.")), "names are case-sensitive");
            Assert.That(resolved[2], Is.EqualTo(new FamilyNameResolution("Twin", null, "family-name-ambiguous", "'Twin' matches 2 families (Generic Models, Mechanical Equipment).")));
            Assert.That(resolved[3], Is.EqualTo(new FamilyNameResolution("Wall Room", null, "family-not-editable", "'Wall Room' cannot be edited (in-place/system).")));
        });
    }
}
