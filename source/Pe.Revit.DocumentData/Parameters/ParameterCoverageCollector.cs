using Pe.Shared.RevitData;

namespace Pe.Revit.DocumentData.Parameters;

public static class ParameterCoverageCollector {
    public static ParameterCoverageData Collect(Document doc, ParameterCoverageRequest request, IReadOnlyCollection<ElementId>? selectionIds = null) {
        var issues = new List<RevitDataIssue>();
        var budget = RevitDataOutputBudgets.WithDefaults(request.Budget, maxEntries: 50, maxSamplesPerEntry: 5);
        var elements = ResolveElements(doc, request, selectionIds, issues);
        var categoryNames = request.CategoryNames
            .Where(name => !string.IsNullOrWhiteSpace(name))
            .Select(name => name.Trim())
            .ToHashSet(StringComparer.OrdinalIgnoreCase);
        if (categoryNames.Count != 0) {
            elements = elements
                .Where(element => element.Category != null && categoryNames.Contains(element.Category.Name))
                .ToList();
        }

        var parameterNames = request.ParameterNames
            .Where(name => !string.IsNullOrWhiteSpace(name))
            .Select(name => name.Trim())
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();
        var sharedGuids = request.SharedGuids
            .Select(value => Guid.TryParse(value, out var guid) ? guid : (Guid?)null)
            .Where(value => value != null)
            .Select(value => value!.Value)
            .Distinct()
            .ToList();
        if (parameterNames.Count == 0 && sharedGuids.Count == 0) {
            issues.Add(new RevitDataIssue(
                "ParameterCoverageNoParametersRequested",
                RevitDataIssueSeverity.Warning,
                "Request at least one parameter name or shared GUID to compute parameter coverage."
            ));
        }

        var maxSamples = budget.MaxSamplesPerEntry ?? 5;
        var defaultValues = request.DefaultValues
            .Where(value => value != null)
            .ToHashSet(StringComparer.OrdinalIgnoreCase);
        var entries = new List<ParameterCoverageParameterEntry>();
        foreach (var categoryGroup in elements.GroupBy(element => element.Category?.Name ?? string.Empty)) {
            foreach (var parameterName in parameterNames) {
                entries.Add(CollectParameterNameCoverage(doc, categoryGroup.Key, categoryGroup.ToList(), parameterName, request, defaultValues, maxSamples));
            }
            foreach (var sharedGuid in sharedGuids) {
                entries.Add(CollectSharedGuidCoverage(doc, categoryGroup.Key, categoryGroup.ToList(), sharedGuid, request, defaultValues, maxSamples));
            }
        }

        var maxEntries = budget.MaxEntries;
        var truncated = maxEntries is > 0 && entries.Count > maxEntries.Value;
        var returned = truncated ? entries.Take(maxEntries!.Value).ToList() : entries;
        if (truncated) {
            issues.Add(new RevitDataIssue(
                "ParameterCoverageTruncated",
                RevitDataIssueSeverity.Warning,
                $"Returned {returned.Count} of {entries.Count} parameter coverage row(s). Increase budget.maxEntries to expand."
            ));
        }

        return new ParameterCoverageData(
            elements.Count,
            returned,
            RevitDataOutputBudgets.ProjectIssues(issues, budget),
            new RevitDataResultPage(entries.Count, returned.Count, truncated)
        );
    }

    private static ParameterCoverageParameterEntry CollectParameterNameCoverage(
        Document doc,
        string? categoryName,
        IReadOnlyList<Element> elements,
        string parameterName,
        ParameterCoverageRequest request,
        HashSet<string> defaultValues,
        int maxSamples
    ) => CollectCoverage(
        doc,
        categoryName,
        elements,
        ParameterIdentityEngine.FromRaw(parameterName, null, null, null),
        element => FindParameterByName(doc, element, parameterName, request.LookupPreference),
        request,
        defaultValues,
        maxSamples
    );

    private static ParameterCoverageParameterEntry CollectSharedGuidCoverage(
        Document doc,
        string? categoryName,
        IReadOnlyList<Element> elements,
        Guid sharedGuid,
        ParameterCoverageRequest request,
        HashSet<string> defaultValues,
        int maxSamples
    ) => CollectCoverage(
        doc,
        categoryName,
        elements,
        ParameterIdentityEngine.FromRaw(sharedGuid.ToString("D"), null, sharedGuid.ToString("D"), null),
        element => FindParameterByGuid(doc, element, sharedGuid, request.LookupPreference),
        request,
        defaultValues,
        maxSamples
    );

    private static ParameterCoverageParameterEntry CollectCoverage(
        Document doc,
        string? categoryName,
        IReadOnlyList<Element> elements,
        ParameterIdentity identity,
        Func<Element, Parameter?> lookup,
        ParameterCoverageRequest request,
        HashSet<string> defaultValues,
        int maxSamples
    ) {
        var present = 0;
        var blank = 0;
        var defaultCount = 0;
        var samples = new List<RevitElementHandle>();
        foreach (var element in elements) {
            var parameter = lookup(element);
            if (parameter == null) {
                AddSample(doc, element, samples, maxSamples);
                continue;
            }
            present++;
            var value = parameter.AsValueString() ?? parameter.AsString() ?? string.Empty;
            var isBlank = request.TreatWhitespaceAsBlank
                ? string.IsNullOrWhiteSpace(value)
                : value.Length == 0;
            if (isBlank) {
                blank++;
                AddSample(doc, element, samples, maxSamples);
            } else if (defaultValues.Contains(value)) {
                defaultCount++;
                AddSample(doc, element, samples, maxSamples);
            }
        }

        return new ParameterCoverageParameterEntry(
            identity,
            string.IsNullOrWhiteSpace(categoryName) ? null : categoryName,
            elements.Count,
            present,
            elements.Count - present,
            blank,
            defaultCount,
            samples
        );
    }

    private static List<Element> ResolveElements(
        Document doc,
        ParameterCoverageRequest request,
        IReadOnlyCollection<ElementId>? selectionIds,
        List<RevitDataIssue> issues
    ) {
        if (request.Scope == RevitElementScope.CurrentSelection) {
            return (selectionIds ?? [])
                .Select(doc.GetElement)
                .Where(element => element != null)
                .Cast<Element>()
                .Where(element => element.Category != null)
                .ToList();
        }
        if (request.Scope == RevitElementScope.ExplicitHandles) {
            var byId = request.ElementIds
                .Select(id => doc.GetElement(new ElementId(id)))
                .Where(element => element != null)
                .Cast<Element>();
            var byUniqueId = request.ElementUniqueIds
                .Select(doc.GetElement)
                .Where(element => element != null)
                .Cast<Element>();
            return byId.Concat(byUniqueId)
                .DistinctBy(element => element.Id.Value())
                .Where(element => element.Category != null)
                .ToList();
        }
        if (request.Scope == RevitElementScope.ActiveViewVisible) {
            var activeView = doc.ActiveView;
            if (activeView == null) {
                issues.Add(new RevitDataIssue(
                    "ParameterCoverageNoActiveView",
                    RevitDataIssueSeverity.Warning,
                    "No active view was available; falling back to all document elements."
                ));
            } else {
                return new FilteredElementCollector(doc, activeView.Id)
                    .WhereElementIsNotElementType()
                    .Where(element => element.Category != null)
                    .ToList();
            }
        }
        return new FilteredElementCollector(doc)
            .WhereElementIsNotElementType()
            .Where(element => element.Category != null)
            .ToList();
    }

    private static Parameter? FindParameterByName(
        Document doc,
        Element element,
        string parameterName,
        RevitParameterLookupPreference preference
    ) => preference switch {
        RevitParameterLookupPreference.InstanceOnly => element.LookupParameter(parameterName),
        RevitParameterLookupPreference.TypeOnly => (doc.GetElement(element.GetTypeId()) as ElementType)?.LookupParameter(parameterName),
        _ => element.LookupParameter(parameterName)
             ?? (doc.GetElement(element.GetTypeId()) as ElementType)?.LookupParameter(parameterName)
    };

    private static Parameter? FindParameterByGuid(
        Document doc,
        Element element,
        Guid sharedGuid,
        RevitParameterLookupPreference preference
    ) => preference switch {
        RevitParameterLookupPreference.InstanceOnly => element.get_Parameter(sharedGuid),
        RevitParameterLookupPreference.TypeOnly => (doc.GetElement(element.GetTypeId()) as ElementType)?.get_Parameter(sharedGuid),
        _ => element.get_Parameter(sharedGuid)
             ?? (doc.GetElement(element.GetTypeId()) as ElementType)?.get_Parameter(sharedGuid)
    };

    private static void AddSample(Document doc, Element element, List<RevitElementHandle> samples, int maxSamples) {
        if (samples.Count >= maxSamples)
            return;
        var type = doc.GetElement(element.GetTypeId()) as ElementType;
        var familyName = element is FamilyInstance familyInstance
            ? familyInstance.Symbol?.FamilyName
            : type?.FamilyName;
        samples.Add(new RevitElementHandle(
            element.Id.Value(),
            element.UniqueId,
            string.IsNullOrWhiteSpace(element.Name) ? $"Element {element.Id.Value()}" : element.Name,
            element.Category?.Name,
            familyName,
            type?.Name
        ));
    }
}
