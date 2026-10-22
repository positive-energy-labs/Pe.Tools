using Pe.Shared.RevitData.Families;

namespace Pe.Revit.DocumentData.Families.Loaded.Collectors;

public static class FamilyInstanceReferenceCollector {
    public static FamilyInstanceReferencesData ResolveFamilyInstances(
        this Document document,
        FamilyInstanceReferencesRequest request
    ) {
        FamilyInstanceReferencesData Refuse(string code, string message) => new(
            request.FamilyId,
            request.FamilyUniqueId ?? string.Empty,
            [],
            new RevitDataResultPage(0, 0, false),
            [new RevitDataIssue(code, RevitDataIssueSeverity.Error, message)]
        );

        if (request.FamilyId is < 1 or > 9007199254740991)
            return Refuse("FamilyIdInvalid", "familyId must be a positive integer representable exactly in JavaScript.");
        if (string.IsNullOrWhiteSpace(request.FamilyUniqueId))
            return Refuse("FamilyUniqueIdRequired", "Supply the captured family UniqueId paired with familyId.");
        if (request.MaxResults is < 1 or > 1000)
            return Refuse("FamilyInstancesLimitInvalid", "maxResults must be between 1 and 1000.");
        if (document.IsFamilyDocument)
            return Refuse("FamilyInstancesProjectRequired", "Resolve placed family instances in their project document, not a family editor.");

        var element = document.GetElement(request.FamilyId.ToElementId());
        if (element == null)
            return Refuse("FamilyNotFound", $"No family exists at element id {request.FamilyId} in this document.");
        if (element is not Family family)
            return Refuse("FamilyIdentityKindMismatch", $"Element {request.FamilyId} is {element.GetType().Name}, not a Family definition.");
        if (!string.Equals(family.UniqueId, request.FamilyUniqueId, StringComparison.Ordinal))
            return Refuse("FamilyIdentityMismatch", $"Family {request.FamilyId} no longer has the captured UniqueId.");

        var instances = new List<ElementContextElementRef>();
        var total = 0;
        using var collector = new FilteredElementCollector(document);
        foreach (var instance in collector.OfClass(typeof(FamilyInstance)).Cast<FamilyInstance>()) {
            var symbol = instance.Symbol;
            if (symbol?.Family?.Id.Value() != request.FamilyId)
                continue;
            total++;
            if (instances.Count == request.MaxResults)
                continue;
            instances.Add(new ElementContextElementRef(
                instance.Id.Value(),
                instance.UniqueId,
                instance.GetType().Name,
                instance.Category?.Name,
                instance.Name,
                family.Name,
                symbol.Name,
                null
            ));
        }

        var issues = new List<RevitDataIssue>();
        var truncated = total > instances.Count;
        if (total == 0)
            issues.Add(new RevitDataIssue("FamilyHasNoPlacedInstances", RevitDataIssueSeverity.Warning,
                "This family has no placed instances in this document; there is nothing to select or box."));
        if (truncated)
            issues.Add(new RevitDataIssue("FamilyInstancesTruncated", RevitDataIssueSeverity.Warning,
                $"Returned {instances.Count} of {total} placements. Do not select or box this incomplete set."));

        return new FamilyInstanceReferencesData(
            request.FamilyId,
            request.FamilyUniqueId,
            instances.OrderBy(instance => instance.ElementId).ToList(),
            new RevitDataResultPage(total, instances.Count, truncated),
            issues
        );
    }
}
