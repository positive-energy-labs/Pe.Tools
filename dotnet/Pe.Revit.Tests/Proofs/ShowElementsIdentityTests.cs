using Autodesk.Revit.DB;
using Autodesk.Revit.UI;
using NUnit.Framework;
using Pe.Revit.Extensions.ProjDocument;

namespace Pe.Revit.Tests.Proofs;

/// <summary>Native identity and unavailable-geometry behavior. Window activation and undo require a windowed session proof.</summary>
[TestFixture]
public class ShowElementsIdentityTests {
    [Test]
    public void Paired_identity_never_resolves_the_unique_id_as_an_additional_element(UIApplication uiapp) {
        using var document = uiapp.Application.NewProjectDocument(UnitSystem.Imperial);
        try {
            Level first;
            Level second;
            using (var transaction = new Transaction(document, "Identity proof")) {
                transaction.Start();
                first = Level.Create(document, 0);
                second = Level.Create(document, 10);
                transaction.Commit();
            }
            var ids = new[] { first.Id.Value(), second.Id.Value(), 9007199254740991L, -1L };
            var result = document.ResolveShowTargets(ids, new Dictionary<long, string> {
                [first.Id.Value()] = second.UniqueId,
                [second.Id.Value()] = second.UniqueId
            });
            Assert.That(result.Resolved, Is.EqualTo(new[] { second.Id }));
            Assert.That(result.IdentityVerified, Is.EqualTo(new[] { second.Id.Value() }));
            Assert.That(result.Missing, Does.Contain(9007199254740991L));
            Assert.That(result.Issues.Select(issue => issue.Code), Is.EquivalentTo(new[] { "IdentityMismatch", "ElementIdInvalid" }));
            var idOnly = document.ResolveShowTargets(new[] { first.Id.Value() });
            Assert.That(idOnly.Resolved, Is.EqualTo(new[] { first.Id }));
            Assert.That(idOnly.IdentityVerified, Is.Empty, "ID-only does not verify stale identity.");
        } finally {
            document.Close(false);
        }
    }

    [Test]
    public void A_view_target_cannot_report_selection_box_success_or_create_a_view(UIApplication uiapp) {
        using var document = uiapp.Application.NewProjectDocument(UnitSystem.Imperial);
        try {
            View3D view;
            using (var transaction = new Transaction(document, "View target proof")) {
                transaction.Start();
                var family = new FilteredElementCollector(document).OfClass(typeof(ViewFamilyType)).Cast<ViewFamilyType>()
                    .First(type => type.ViewFamily == ViewFamily.ThreeDimensional);
                view = View3D.CreateIsometric(document, family.Id);
                transaction.Commit();
            }
            var count = new FilteredElementCollector(document).OfClass(typeof(View3D)).GetElementCount();
            var result = new UIDocument(document).BoxInThreeD(new[] { view.Id });
            Assert.That(result.View, Is.Null);
            Assert.That(result.BoxedIds, Is.Empty);
            Assert.That(result.Issues.Single().Code, Is.EqualTo("BoxUnavailable"));
            Assert.That(new FilteredElementCollector(document).OfClass(typeof(View3D)).GetElementCount(), Is.EqualTo(count));
        } finally {
            document.Close(false);
        }
    }
}
