namespace Pe.Shared.RevitData;

/// <summary>Pure capture policy; phase order is the document's sequence, never numeric id order.</summary>
public static class RevitViewImageVisibility {
    public static long? LatestPhase(IEnumerable<long> phaseOrder, IEnumerable<long> createdPhaseIds) {
        var created = new HashSet<long>(createdPhaseIds);
        return phaseOrder.Where(created.Contains).Select(id => (long?)id).LastOrDefault();
    }

    public static IReadOnlyList<RevitViewImageNotDrawnReason> Reasons(
        bool exists, bool phaseHidden, bool individuallyHidden, bool categoryHidden,
        bool hasBounds, bool outsideCrop, bool outsideSectionBox) {
        if (!exists) return [RevitViewImageNotDrawnReason.ElementMissing];
        var reasons = new List<RevitViewImageNotDrawnReason>();
        if (phaseHidden) reasons.Add(RevitViewImageNotDrawnReason.PhaseHidden);
        if (individuallyHidden) reasons.Add(RevitViewImageNotDrawnReason.ElementHidden);
        if (categoryHidden) reasons.Add(RevitViewImageNotDrawnReason.CategoryHidden);
        if (!hasBounds) reasons.Add(RevitViewImageNotDrawnReason.NoBoundingBox);
        if (outsideCrop) reasons.Add(RevitViewImageNotDrawnReason.OutsideCrop);
        if (outsideSectionBox) reasons.Add(RevitViewImageNotDrawnReason.OutsideSectionBox);
        return reasons;
    }
}
