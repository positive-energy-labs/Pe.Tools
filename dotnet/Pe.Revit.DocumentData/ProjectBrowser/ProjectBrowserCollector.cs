using Pe.Shared.RevitData;

namespace Pe.Revit.DocumentData.ProjectBrowser;

public sealed record ProjectBrowserCollectedIndex(
    string BrowserSnapshotId,
    List<ProjectBrowserOrganizationSummary> Organizations,
    List<ProjectBrowserItem> Items,
    Dictionary<string, List<ProjectBrowserPath>> PathsByElement
) {
    public static readonly ProjectBrowserCollectedIndex Empty = new(string.Empty, [], [], []);

    public List<ProjectBrowserPath> Get(ProjectBrowserSection section, ElementId elementId, bool includePaths) => includePaths && this.PathsByElement.TryGetValue(CreateKey(section, elementId), out var paths)
        ? paths
        : [];

    public static string CreateKey(ProjectBrowserSection section, ElementId elementId) => $"{section}|{elementId.Value()}";
}

public static class ProjectBrowserCollector {
    private static readonly StringComparer IgnoreCase = StringComparer.OrdinalIgnoreCase;

    public static ProjectBrowserData Collect(
        Document document,
        ProjectBrowserRequest? request = null,
        IProjectBrowserIndexProvider? browserIndexProvider = null
    ) {
        request ??= new ProjectBrowserRequest();
        var budget = RevitDataOutputBudgets.WithDefaults(request.Budget, maxEntries: 100, maxSamplesPerEntry: 5);
        var issues = new List<RevitDataIssue>();
        var sections = request.Sections.Count == 0
            ? Enum.GetValues(typeof(ProjectBrowserSection)).Cast<ProjectBrowserSection>().ToHashSet()
            : request.Sections.ToHashSet();
        if (request.Filter?.Section is { } filterSection)
            sections = [filterSection];

        var index = browserIndexProvider?.GetProjectBrowserIndex(document, sections, Math.Max(0, budget.MaxSamplesPerEntry ?? 5), request.View, request.Filter, issues)
                    ?? CollectIndex(document, sections, Math.Max(0, budget.MaxSamplesPerEntry ?? 5), request.View, request.Filter, issues);
        var items = request.View == ProjectBrowserResultView.Items
            ? Page(index.Items, budget.MaxEntries, issues, "ProjectBrowserItemsTruncated")
            : [];
        var folderCount = index.Organizations.Sum(summary => summary.FolderCount);
        var itemCount = request.View == ProjectBrowserResultView.Items ? index.Items.Count : folderCount;
        var returnedCount = request.View == ProjectBrowserResultView.Items ? items.Count : folderCount;
        var nearestMatches = request.Filter == null || HasAnyMatches(index, request.Filter)
            ? []
            : CreateNearestMatches(index, request.Filter, 5);
        if (request.Filter != null && !HasAnyMatches(index, request.Filter)) {
            issues.Add(new RevitDataIssue(
                "ProjectBrowserFilterNoMatch",
                RevitDataIssueSeverity.Warning,
                "Browser filter did not match the current Project Browser organization. Use nearestMatches or call revit.catalog.project-browser in Folders mode to inspect valid paths."
            ));
        }

        return new ProjectBrowserData(
            index.BrowserSnapshotId,
            request.View,
            index.Organizations,
            items,
            nearestMatches,
            RevitDataOutputBudgets.ProjectIssues(issues, budget),
            new RevitDataResultPage(itemCount, returnedCount, request.View == ProjectBrowserResultView.Items && returnedCount < itemCount)
        );
    }

    public static ProjectBrowserCollectedIndex CollectIndex(
        Document document,
        IReadOnlyCollection<ProjectBrowserSection> sections,
        int maxSamples,
        ProjectBrowserResultView view,
        ProjectBrowserFilter? filter,
        List<RevitDataIssue> issues
    ) {
        var organizationsBySection = sections
            .ToDictionary(section => section, section => GetBrowserOrganization(document, section, issues));
        var organizations = new List<ProjectBrowserOrganizationSummary>();
        var items = new List<ProjectBrowserItem>();
        var pathsByElement = new Dictionary<string, List<ProjectBrowserPath>>(StringComparer.OrdinalIgnoreCase);

        foreach (var (section, organization) in organizationsBySection) {
            if (organization == null)
                continue;

            CollectBrowserSection(document, section, organization, CollectElements(document, section), maxSamples, view, filter, organizations, items, pathsByElement, issues);
        }

        return new ProjectBrowserCollectedIndex(CreateSnapshotId(document, organizationsBySection), organizations, items, pathsByElement);
    }

    public static ProjectBrowserCollectedIndex CollectIndex(
        Document document,
        IReadOnlyCollection<ProjectBrowserSection> sections,
        int maxSamples,
        List<RevitDataIssue> issues
    ) => CollectIndex(document, sections, maxSamples, ProjectBrowserResultView.Folders, null, issues);

    private static BrowserOrganization? GetBrowserOrganization(Document document, ProjectBrowserSection section, List<RevitDataIssue> issues) {
        try {
            return section switch {
                ProjectBrowserSection.Views => BrowserOrganization.GetCurrentBrowserOrganizationForViews(document),
                ProjectBrowserSection.Sheets => BrowserOrganization.GetCurrentBrowserOrganizationForSheets(document),
                ProjectBrowserSection.Schedules => BrowserOrganization.GetCurrentBrowserOrganizationForSchedules(document),
                _ => null
            };
        } catch (Exception ex) {
            issues.Add(new RevitDataIssue(
                "ProjectBrowserOrganizationUnavailable",
                RevitDataIssueSeverity.Warning,
                $"Could not read the current Project Browser organization for {section}: {ex.Message}"
            ));
            return null;
        }
    }

    private static IReadOnlyList<Element> CollectElements(Document document, ProjectBrowserSection section) => section switch {
        ProjectBrowserSection.Views => new FilteredElementCollector(document)
            .OfClass(typeof(View))
            .Cast<View>()
            .Where(view => !view.IsTemplate)
            .Where(view => view is not ViewSheet and not ViewSchedule)
            .OrderBy(view => view.Title, IgnoreCase)
            .Cast<Element>()
            .ToList(),
        ProjectBrowserSection.Sheets => new FilteredElementCollector(document)
            .OfClass(typeof(ViewSheet))
            .Cast<ViewSheet>()
            .Where(sheet => !sheet.IsTemplate)
            .OrderBy(sheet => sheet.SheetNumber, IgnoreCase)
            .ThenBy(sheet => sheet.Name, IgnoreCase)
            .Cast<Element>()
            .ToList(),
        ProjectBrowserSection.Schedules => new FilteredElementCollector(document)
            .OfClass(typeof(ViewSchedule))
            .Cast<ViewSchedule>()
            .Where(schedule => !schedule.IsTemplate)
            .Where(schedule => !schedule.Name.Contains("<Revision Schedule>", StringComparison.OrdinalIgnoreCase))
            .OrderBy(schedule => schedule.Name, IgnoreCase)
            .Cast<Element>()
            .ToList(),
        _ => []
    };

    private static void CollectBrowserSection(
        Document document,
        ProjectBrowserSection section,
        BrowserOrganization organization,
        IReadOnlyList<Element> elements,
        int maxSamples,
        ProjectBrowserResultView view,
        ProjectBrowserFilter? filter,
        List<ProjectBrowserOrganizationSummary> organizations,
        List<ProjectBrowserItem> items,
        Dictionary<string, List<ProjectBrowserPath>> pathsByElement,
        List<RevitDataIssue> issues
    ) {
        var allItems = new List<ProjectBrowserItem>();
        foreach (var element in elements) {
            if (!IsBrowserFilterSatisfied(organization, element, issues))
                continue;

            var paths = GetBrowserPaths(document, section, organization, element, issues);
            var matchingPaths = paths.Where(path => MatchesFilter(path, filter)).ToList();
            if (filter != null && matchingPaths.Count == 0)
                continue;
            if (paths.Count == 0)
                continue;

            pathsByElement[ProjectBrowserCollectedIndex.CreateKey(section, element.Id)] = matchingPaths.Count == 0 ? paths : matchingPaths;
            var handle = CreateHandle(document, element, section);
            allItems.AddRange((matchingPaths.Count == 0 ? paths : matchingPaths).Select(path => new ProjectBrowserItem(
                handle,
                path,
                [new RevitAgentContextProvenance(RevitAgentContextProvenanceKind.BrowserIndex, $"Resolved through Project Browser path {path.PathLabel}.")]
            )));
        }

        var folderSummaries = allItems
            .GroupBy(item => item.BrowserPath.PathLabel, IgnoreCase)
            .OrderBy(group => group.Key, IgnoreCase)
            .Select(group => new ProjectBrowserFolderSummary(
                section,
                organization.Name,
                group.Key,
                group.Count(),
                group.Select(item => item.Handle).DistinctByHandle().Take(maxSamples).ToList()
            ))
            .ToList();

        organizations.Add(new ProjectBrowserOrganizationSummary(
            section,
            organization.Name,
            organization.SortingParameterId == ElementId.InvalidElementId ? null : organization.SortingParameterId.Value(),
            organization.SortingParameterId == ElementId.InvalidElementId ? null : document.GetElement(organization.SortingParameterId)?.Name,
            organization.SortingOrder.ToString(),
            allItems.Select(item => $"{item.Handle.Kind}|{item.Handle.ElementId}|{item.Handle.UniqueId}").Distinct(StringComparer.OrdinalIgnoreCase).Count(),
            folderSummaries.Count,
            CreatePathLevels(allItems.Select(item => item.BrowserPath).ToList()),
            view is ProjectBrowserResultView.Folders or ProjectBrowserResultView.Items ? folderSummaries.Take(maxSamples).ToList() : []
        ));

        if (view == ProjectBrowserResultView.Items)
            items.AddRange(allItems.OrderBy(item => item.BrowserPath.PathLabel, IgnoreCase).ThenBy(item => item.Handle.Label, IgnoreCase));
    }

    private static bool IsBrowserFilterSatisfied(BrowserOrganization organization, Element element, List<RevitDataIssue> issues) {
        try {
            return organization.AreFiltersSatisfied(element.Id);
        } catch (Exception ex) {
            issues.Add(new RevitDataIssue(
                "ProjectBrowserFilterReadFailed",
                RevitDataIssueSeverity.Warning,
                $"Could not evaluate Project Browser filter for {element.Name}: {ex.Message}"
            ));
            return false;
        }
    }

    private static List<ProjectBrowserPath> GetBrowserPaths(
        Document document,
        ProjectBrowserSection section,
        BrowserOrganization organization,
        Element element,
        List<RevitDataIssue> issues
    ) {
        try {
            var segments = organization.GetFolderItems(element.Id)
                .Select(item => new ProjectBrowserPathSegment(
                    item.ElementId == ElementId.InvalidElementId ? null : item.ElementId.Value(),
                    item.ElementId == ElementId.InvalidElementId ? null : document.GetElement(item.ElementId)?.Name,
                    item.Name
                ))
                .ToList();
            var pathLabel = CreatePathLabel(segments);
            return [new ProjectBrowserPath(section, organization.Name, pathLabel, segments)];
        } catch (Exception ex) {
            issues.Add(new RevitDataIssue(
                "ProjectBrowserPathReadFailed",
                RevitDataIssueSeverity.Warning,
                $"Could not read Project Browser folder path for {element.Name}: {ex.Message}"
            ));
            return [];
        }
    }

    private static bool MatchesFilter(ProjectBrowserPath path, ProjectBrowserFilter? filter) {
        if (filter == null)
            return true;
        if (filter.Section is { } section && path.Section != section)
            return false;
        if (filter.Path.Count != 0 && !MatchesPath(path, filter.Path, filter.MatchMode))
            return false;
        return filter.Fields.Count == 0 || filter.Fields.All(field => path.Segments.Any(segment =>
            !string.IsNullOrWhiteSpace(segment.ParameterName)
            && string.Equals(segment.ParameterName, field.Key, StringComparison.OrdinalIgnoreCase)
            && string.Equals(segment.FolderName, field.Value, StringComparison.OrdinalIgnoreCase)));
    }

    private static bool MatchesPath(ProjectBrowserPath path, IReadOnlyList<string> filterPath, ProjectBrowserMatchMode matchMode) {
        var actual = path.Segments.Select(segment => segment.FolderName).Where(name => !string.IsNullOrWhiteSpace(name)).ToList();
        if (matchMode == ProjectBrowserMatchMode.Exact && actual.Count != filterPath.Count)
            return false;
        if (actual.Count < filterPath.Count)
            return false;
        return filterPath.Select(value => value.Trim()).Where(value => value.Length != 0).Select((value, index) => (value, index))
            .All(pair => string.Equals(actual[pair.index], pair.value, StringComparison.OrdinalIgnoreCase));
    }

    private static List<ProjectBrowserPathLevel> CreatePathLevels(IReadOnlyList<ProjectBrowserPath> paths) {
        var maxDepth = paths.Count == 0 ? 0 : paths.Max(path => path.Segments.Count);
        return Enumerable.Range(0, maxDepth)
            .Select(index => {
                var segmentsAtIndex = paths.Select(path => path.Segments.ElementAtOrDefault(index)).Where(segment => segment != null).Cast<ProjectBrowserPathSegment>().ToList();
                var first = segmentsAtIndex.FirstOrDefault();
                return new ProjectBrowserPathLevel(
                    index,
                    first?.ParameterName,
                    first?.ParameterId,
                    segmentsAtIndex.Select(segment => segment.FolderName).Where(value => !string.IsNullOrWhiteSpace(value)).Distinct(IgnoreCase).OrderBy(value => value, IgnoreCase).ToList()
                );
            })
            .ToList();
    }

    private static bool HasAnyMatches(ProjectBrowserCollectedIndex index, ProjectBrowserFilter filter) => index.Items.Any(item => MatchesFilter(item.BrowserPath, filter))
                                                                                                       || index.Organizations.Any(organization => organization.Folders.Any(folder => MatchesPathLabel(folder.PathLabel, filter)));

    private static bool MatchesPathLabel(string pathLabel, ProjectBrowserFilter filter) => filter.Path.Count == 0
        || MatchesPath(new ProjectBrowserPath(filter.Section ?? ProjectBrowserSection.Views, null, pathLabel, filter.Path.Select(value => new ProjectBrowserPathSegment(null, null, value)).ToList()), filter.Path, filter.MatchMode);

    private static List<ProjectBrowserNearestMatch> CreateNearestMatches(ProjectBrowserCollectedIndex index, ProjectBrowserFilter filter, int maxMatches) {
        var filterTokens = filter.Path.Concat(filter.Fields.Values).SelectMany(Tokenize).ToHashSet(IgnoreCase);
        if (filterTokens.Count == 0)
            return [];
        return index.Items
            .Select(item => new ProjectBrowserNearestMatch(
                item.BrowserPath.Section,
                item.BrowserPath.PathLabel,
                item.BrowserPath.Segments.Select(segment => segment.FolderName).ToList(),
                Tokenize(item.BrowserPath.PathLabel).Count(filterTokens.Contains)
            ))
            .Where(match => match.Score > 0)
            .GroupBy(match => $"{match.Section}|{match.PathLabel}", StringComparer.OrdinalIgnoreCase)
            .Select(group => group.First())
            .OrderByDescending(match => match.Score)
            .ThenBy(match => match.PathLabel, IgnoreCase)
            .Take(maxMatches)
            .ToList();
    }

    private static List<T> Page<T>(List<T> entries, int? maxEntries, List<RevitDataIssue> issues, string code) {
        if (maxEntries is not > 0 || entries.Count <= maxEntries.Value)
            return entries;
        issues.Add(new RevitDataIssue(
            code,
            RevitDataIssueSeverity.Warning,
            $"Returned {maxEntries.Value} of {entries.Count} Project Browser item(s). Increase budget.maxEntries to expand."
        ));
        return entries.Take(maxEntries.Value).ToList();
    }

    private static RevitAgentContextHandle CreateHandle(Document document, Element element, ProjectBrowserSection section) {
        var kind = section switch {
            ProjectBrowserSection.Sheets => RevitAgentContextHandleKind.Sheet,
            ProjectBrowserSection.Schedules => RevitAgentContextHandleKind.Schedule,
            _ => RevitAgentContextHandleKind.View
        };
        return new RevitAgentContextHandle(kind, document.GetDocumentKey(), element.Id.Value(), element.UniqueId, CreateElementLabel(element), element.Category?.Name);
    }

    private static string CreateElementLabel(Element element) => element switch {
        ViewSheet sheet => $"{sheet.SheetNumber} - {sheet.Name}",
        View view => view.Title,
        _ => element.Name
    };

    private static string CreatePathLabel(IReadOnlyList<ProjectBrowserPathSegment> segments) {
        var path = string.Join(" / ", segments.Select(segment => segment.FolderName).Where(name => !string.IsNullOrWhiteSpace(name)));
        return string.IsNullOrWhiteSpace(path) ? "(root)" : path;
    }

    private static string CreateSnapshotId(Document document, IReadOnlyDictionary<ProjectBrowserSection, BrowserOrganization?> organizations) => string.Join(
        ":",
        [
            document.GetDocumentKey(),
            .. organizations.OrderBy(pair => pair.Key).Select(pair => $"{pair.Key}:{pair.Value?.UniqueId}:{pair.Value?.VersionGuid}")
        ]
    );

    private static IReadOnlyList<string> Tokenize(string? value) => string.IsNullOrWhiteSpace(value)
        ? []
        : value.ToLowerInvariant()
            .Split(value.Select(character => char.IsLetterOrDigit(character) ? ' ' : character).Distinct().Where(character => !char.IsLetterOrDigit(character)).ToArray(), StringSplitOptions.RemoveEmptyEntries)
            .Select(token => token.Trim())
            .Where(token => token.Length > 1)
            .Where(token => token is not "the" and not "this" and not "that" and not "with" and not "from" and not "for" and not "and")
            .ToList();

    private static IEnumerable<RevitAgentContextHandle> DistinctByHandle(this IEnumerable<RevitAgentContextHandle> handles) => handles
        .GroupBy(handle => $"{handle.Kind}|{handle.DocumentKey}|{handle.ElementId}|{handle.UniqueId}", StringComparer.OrdinalIgnoreCase)
        .Select(group => group.First());
}
