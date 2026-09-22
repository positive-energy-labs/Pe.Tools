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

        var parameters = ParameterReferenceResolver.Resolve(request.Parameters);
        if (parameters.Count == 0) {
            issues.Add(new RevitDataIssue(
                "ParameterCoverageNoParametersRequested",
                RevitDataIssueSeverity.Warning,
                "Request at least one parameter reference to compute parameter coverage."
            ));
        }

        var maxSamples = budget.MaxSamplesPerEntry ?? 5;
        var defaultValues = request.DefaultValues
            .Where(value => value != null)
            .ToHashSet(StringComparer.OrdinalIgnoreCase);
        var entries = new List<ParameterCoverageParameterEntry>();
        foreach (var categoryGroup in elements.GroupBy(element => element.Category?.Name ?? string.Empty)) {
            foreach (var parameter in parameters) {
                entries.Add(CollectParameterCoverage(doc, categoryGroup.Key, categoryGroup.ToList(), parameter, request, defaultValues, maxSamples));
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

    private static ParameterCoverageParameterEntry CollectParameterCoverage(
        Document doc,
        string? categoryName,
        IReadOnlyList<Element> elements,
        ResolvedParameterReference parameter,
        ParameterCoverageRequest request,
        HashSet<string> defaultValues,
        int maxSamples
    ) => CollectCoverage(
        doc,
        categoryName,
        elements,
        parameter.Identity,
        element => ParameterReferenceLookup.Find(doc, element, parameter, request.LookupPreference),
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
            BuildDefinition(identity, elements, lookup),
            string.IsNullOrWhiteSpace(categoryName) ? null : categoryName,
            elements.Count,
            present,
            elements.Count - present,
            blank,
            defaultCount,
            samples
        );
    }

    private static ParameterDefinitionDescriptor BuildDefinition(
        ParameterIdentity requestedIdentity,
        IReadOnlyList<Element> elements,
        Func<Element, Parameter?> lookup
    ) {
        var firstParameter = elements
            .Select(lookup)
            .FirstOrDefault(parameter => parameter?.Definition != null);
        if (firstParameter == null) {
            return new ParameterDefinitionDescriptor(
                requestedIdentity,
                null,
                null,
                null,
                null,
                null
            );
        }

        var definition = firstParameter.Definition;
        return new ParameterDefinitionDescriptor(
            ParameterIdentityEngine.FromCanonical(ParameterIdentityFactory.FromParameter(firstParameter)),
            null,
            NormalizeForgeTypeId(definition.GetDataType()),
            null,
            NormalizeForgeTypeId(definition.GetGroupTypeId()),
            null
        );
    }

    private static string? NormalizeForgeTypeId(ForgeTypeId forgeTypeId) =>
        string.IsNullOrWhiteSpace(forgeTypeId?.TypeId) ? null : forgeTypeId.TypeId;

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
                .Select(id => doc.GetElement(id.ToElementId()))
                .Where(element => element != null)
                .Cast<Element>();
            var byUniqueId = request.ElementUniqueIds
                .Select(doc.GetElement)
                .Where(element => element != null)
                .Cast<Element>();
            return byId.Concat(byUniqueId)
                .GroupBy(element => element.Id.Value())
                .Select(group => group.First())
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
