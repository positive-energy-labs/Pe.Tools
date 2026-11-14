using NUnit.Framework;
using Pe.Shared.RevitData;

namespace Pe.Shared.Tests.RevitData;

[TestFixture]
public class ViewImageVisibilityTests {
    [Test]
    public void Latest_phase_follows_document_order_not_ids_or_request_order() {
        Assert.That(RevitViewImageVisibility.LatestPhase([90, 2, 17], [2, 90, 17, 999]), Is.EqualTo(17));
        Assert.That(RevitViewImageVisibility.LatestPhase([90, 2, 17], [90, 2]), Is.EqualTo(2));
        Assert.That(RevitViewImageVisibility.LatestPhase([90, 2, 17], [-1]), Is.Null);
    }

    [Test]
    public void Reasons_disclose_every_exclusion_and_do_not_call_missing_geometry_visible() {
        Assert.That(RevitViewImageVisibility.Reasons(true, true, true, true, true, true, true),
            Is.EqualTo(new[] { RevitViewImageNotDrawnReason.PhaseHidden, RevitViewImageNotDrawnReason.ElementHidden,
                RevitViewImageNotDrawnReason.CategoryHidden, RevitViewImageNotDrawnReason.OutsideCrop,
                RevitViewImageNotDrawnReason.OutsideSectionBox }));
        Assert.That(RevitViewImageVisibility.Reasons(false, false, false, false, false, false, false),
            Is.EqualTo(new[] { RevitViewImageNotDrawnReason.ElementMissing }));
        Assert.That(RevitViewImageVisibility.Reasons(true, false, false, false, false, false, false),
            Is.EqualTo(new[] { RevitViewImageNotDrawnReason.NoBoundingBox }));
        Assert.That(RevitViewImageVisibility.Reasons(true, false, false, false, true, false, false), Is.Empty);
    }
}
