using Pe.Shared.RevitData;

namespace Pe.Revit.Global.Lib;

// ducts.heal and ducts.assign-fan rehearsals refuse a workshared model before any transaction (RevitDataRequestService.RefuseWorksharedRehearsal); only ducts.apply.plan discloses here (Manual D defect 8).
/// <summary>Document-owned: read checkout status for the elements a write will change. Null when not workshared.</summary>
public static class WorksharingDisclosures {
    public static WorksharingDisclosure? Disclose(Document doc, IEnumerable<long> ids, IEnumerable<string>? creates = null) {
        if (!doc.IsWorkshared) return null;
        var elements = ids.Distinct().Select(id => {
            var eid = id.ToElementId();
            var status = WorksharingUtils.GetCheckoutStatus(doc, eid, out var owner);
            return new WorksharedElement(
                id,
                doc.GetElement(eid)?.Name is { Length: > 0 } name ? name : $"element {id}",
                status switch {
                    CheckoutStatus.OwnedByCurrentUser => "owned",
                    CheckoutStatus.OwnedByOtherUser => "blocked",
                    _ => "borrows"
                },
                status == CheckoutStatus.OwnedByOtherUser ? owner : null);
        }).ToList();
        return new WorksharingDisclosure(doc.IsModelInCloud, elements, creates?.ToList() ?? []);
    }
}
