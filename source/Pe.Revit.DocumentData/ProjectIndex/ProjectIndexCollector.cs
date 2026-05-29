using Pe.Revit.DocumentData.Families.Loaded.Collectors;
using Pe.Revit.DocumentData.ProjectBrowser;
using Pe.Revit.DocumentData.Schedules.Collect;
using Pe.Shared.RevitData;
using Pe.Shared.RevitData.Schedules;
using Serilog;
using System.Diagnostics;

namespace Pe.Revit.DocumentData.ProjectIndex;

public static class ProjectIndexCollector {
    private static readonly StringComparer IgnoreCase = StringComparer.OrdinalIgnoreCase;

    public static ProjectIndexData Collect(
        Document document,
        ProjectIndexRequest? request = null,
        IProjectBrowserIndexProvider? browserIndexProvider = null
    ) {
        request ??= new ProjectIndexRequest();
        var projection = request.Projection ?? new RevitDataProjectionRequest();
        var budget = RevitDataOutputBudgets.WithDefaults(request.Budget, maxEntries: 25, maxSamplesPerEntry: 8);
        var issues = new List<RevitDataIssue>();
        var sections = request.Sections.Count == 0
            ? Enum.GetValues(typeof(ProjectIndexSection)).Cast<ProjectIndexSection>().ToHashSet()
            : request.Sections.ToHashSet();
        var view = projection.View;
        var includeHandles = view is RevitDataResultView.Handles or RevitDataResultView.Rows or RevitDataResultView.Full;
        var includeSamples = view is RevitDataResultView.Rows or RevitDataResultView.Full;
        var maxEntries = budget.MaxEntries;
        var maxSamples = Math.Max(0, budget.MaxSamplesPerEntry ?? 8);
        var browserSections = request.BrowserSections.Count == 0
            ? Enum.GetValues(typeof(ProjectBrowserSection)).Cast<ProjectBrowserSection>().ToHashSet()
            : request.BrowserSections.ToHashSet();
        if (request.BrowserFilter?.Section is { } browserFilterSection)
            browserSections = [browserFilterSection];
        var totalStopwatch = Stopwatch.StartNew();
        var browserIndex = TimePhase(
            "browser-index",
            () => request.IncludeBrowserProvenance
                ? browserIndexProvider?.GetProjectBrowserIndex(document, browserSections, maxSamples, ProjectBrowserResultView.Folders, request.BrowserFilter, issues)
                  ?? ProjectBrowserCollector.CollectIndex(document, browserSections, maxSamples, ProjectBrowserResultView.Folders, request.BrowserFilter, issues)
                : ProjectBrowserCollectedIndex.Empty
        );

        var levelNames = ToFilterSet(request.LevelNames);
        var categoryNames = ToFilterSet(request.CategoryNames);
        var searchTokens = Tokenize(request.SearchText);
        var sheetNumberFilters = ToTrimmedList(request.SheetNumberContains);
        var sheetNameFilters = ToTrimmedList(request.SheetNameContains);
        var familyNameFilters = ToTrimmedList(request.FamilyNameContains);
        var scheduleNameFilters = ToTrimmedList(request.ScheduleNameContains);

        var levels = TimePhase("levels", () => new FilteredElementCollector(document)
            .OfClass(typeof(Level))
            .Cast<Level>()
            .OrderBy(level => level.Elevation)
            .ThenBy(level => level.Name, IgnoreCase)
            .ToList());
        var placementIndex = TimePhase("placement-index", () => CreatePlacementIndex(document));
        var views = TimePhase("views", () => new FilteredElementCollector(document)
            .OfClass(typeof(View))
            .Cast<View>()
            .Where(candidate => !candidate.IsTemplate)
            .Where(candidate => candidate is not ViewSheet and not ViewSchedule)
            .Where(candidate => request.IncludeUnplacedViews || placementIndex.IsViewPlaced(candidate.Id))
            .Where(candidate => MatchesLevelFilter(candidate.GenLevel?.Name, levelNames))
            .Where(candidate => MatchesSearch(candidate.Name, searchTokens))
            .OrderBy(candidate => candidate.Name, IgnoreCase)
            .ToList());
        var sheets = TimePhase("sheets", () => new FilteredElementCollector(document)
            .OfClass(typeof(ViewSheet))
            .Cast<ViewSheet>()
            .Where(sheet => !sheet.IsTemplate)
            .Where(sheet => MatchesAnyContains(sheet.SheetNumber, sheetNumberFilters))
            .Where(sheet => MatchesAnyContains(sheet.Name, sheetNameFilters))
            .Where(sheet => MatchesSearch($"{sheet.SheetNumber} {sheet.Name}", searchTokens))
            .OrderBy(sheet => sheet.SheetNumber, IgnoreCase)
            .ThenBy(sheet => sheet.Name, IgnoreCase)
            .ToList());
        var scheduleRequest = new ScheduleCatalogRequest {
            IncludeTemplates = false,
            Projection = new ScheduleCatalogProjection {
                View = RevitDataResultView.Handles,
                IncludeParameterUsages = includeSamples,
                IncludeSheetPlacements = true
            },
            Budget = new RevitDataOutputBudget { MaxEntries = maxEntries, IncludeDiagnostics = true }
        };
        var scheduleCatalog = TimePhase("schedule-catalog", () => ScheduleCatalogCollector.Collect(document, scheduleRequest, browserIndexProvider));
        issues.AddRange(scheduleCatalog.Issues);
        var scheduleEntries = scheduleCatalog.Entries
            .Where(schedule => request.IncludeUnplacedSchedules || schedule.IsPlacedOnSheet)
            .Where(schedule => MatchesLevelFilter(FindScheduleLevelName(document, schedule), levelNames))
            .Where(schedule => MatchesAnyContains(schedule.Name, scheduleNameFilters))
            .Where(schedule => MatchesSearch($"{schedule.Name} {schedule.CategoryName} {string.Join(" ", schedule.ParameterUsages.Select(usage => usage.FieldName))}", searchTokens))
            .ToList();
        var loadedFamilies = TimePhase("loaded-families", () => LoadedFamiliesCatalogCollector.Collect(
            document,
            new LoadedFamiliesFilter { PlacementScope = LoadedFamilyPlacementScope.PlacedOnly },
            new RevitDataProjectionRequest { View = RevitDataResultView.Handles },
            new RevitDataOutputBudget { MaxEntries = maxEntries, IncludeDiagnostics = true }
        ));
        issues.AddRange(loadedFamilies.Issues);
        var families = loadedFamilies.Families
            .Where(family => categoryNames.Count == 0 || (!string.IsNullOrWhiteSpace(family.CategoryName) && categoryNames.Contains(family.CategoryName)))
            .Where(family => MatchesAnyContains(family.FamilyName, familyNameFilters))
            .Where(family => MatchesSearch($"{family.FamilyName} {family.CategoryName}", searchTokens))
            .ToList();
        var instanceCounts = TimePhase("instance-counts", () => CollectInstanceCounts(document));
        var instancesByCategory = instanceCounts.ByCategory;
        var familiesByCategory = families
            .Where(family => !string.IsNullOrWhiteSpace(family.CategoryName))
            .GroupBy(family => family.CategoryName!, IgnoreCase)
            .ToDictionary(group => group.Key, group => group.ToList(), IgnoreCase);
        var schedulesByCategory = scheduleEntries
            .Where(schedule => !string.IsNullOrWhiteSpace(schedule.CategoryName))
            .GroupBy(schedule => schedule.CategoryName!, IgnoreCase)
            .ToDictionary(group => group.Key, group => group.ToList(), IgnoreCase);

        var levelEntries = sections.Contains(ProjectIndexSection.Levels)
            ? ProjectPage(levels.Where(level => MatchesLevelFilter(level.Name, levelNames)).ToList(), maxEntries, issues, "ProjectIndexLevelsTruncated")
                .Select(level => CreateLevelEntry(document, level, views, scheduleEntries, instanceCounts.ByLevelId, includeHandles, maxSamples, placementIndex))
                .ToList()
            : [];
        var includeBrowserPaths = request.IncludeBrowserProvenance;
        var sheetEntries = sections.Contains(ProjectIndexSection.Sheets)
            ? ProjectPage(sheets, maxEntries, issues, "ProjectIndexSheetsTruncated")
                .Select(sheet => CreateSheetEntry(document, sheet, includeHandles, includeBrowserPaths, maxSamples, browserIndex, placementIndex))
                .ToList()
            : [];
        var viewEntries = sections.Contains(ProjectIndexSection.Views)
            ? ProjectPage(views, maxEntries, issues, "ProjectIndexViewsTruncated")
                .Select(viewElement => CreateViewEntry(document, viewElement, includeHandles, includeBrowserPaths, maxSamples, browserIndex, placementIndex))
                .ToList()
            : [];
        var scheduleIndexEntries = sections.Contains(ProjectIndexSection.Schedules)
            ? ProjectPage(scheduleEntries, maxEntries, issues, "ProjectIndexSchedulesTruncated")
                .Select(schedule => CreateScheduleEntry(document, schedule, includeHandles, includeSamples, includeBrowserPaths, maxSamples, browserIndex, placementIndex))
                .ToList()
            : [];
        var categoryEntries = sections.Contains(ProjectIndexSection.Categories)
            ? ProjectPage(CreateCategoryEntries(document, familiesByCategory, schedulesByCategory, instancesByCategory, categoryNames, includeHandles, maxSamples), maxEntries, issues, "ProjectIndexCategoriesTruncated")
            : [];
        var familyEntries = sections.Contains(ProjectIndexSection.Families)
            ? ProjectPage(families, maxEntries, issues, "ProjectIndexFamiliesTruncated")
                .Select(family => CreateFamilyEntry(document, family, scheduleEntries, includeHandles, maxSamples))
                .ToList()
            : [];

        var returnedCount = levelEntries.Count + sheetEntries.Count + viewEntries.Count + scheduleIndexEntries.Count + categoryEntries.Count + familyEntries.Count;
        var totalCount = (sections.Contains(ProjectIndexSection.Levels) ? levels.Count : 0)
                         + (sections.Contains(ProjectIndexSection.Sheets) ? sheets.Count : 0)
                         + (sections.Contains(ProjectIndexSection.Views) ? views.Count : 0)
                         + (sections.Contains(ProjectIndexSection.Schedules) ? scheduleEntries.Count : 0)
                         + (sections.Contains(ProjectIndexSection.Categories) ? CreateCategoryNames(familiesByCategory, schedulesByCategory, instancesByCategory, categoryNames).Count : 0)
                         + (sections.Contains(ProjectIndexSection.Families) ? families.Count : 0);
        var truncated = returnedCount < totalCount;

        var result = new ProjectIndexData(
            new ProjectIndexSummary(levels.Count, sheets.Count, views.Count, scheduleEntries.Count, CreateCategoryNames(familiesByCategory, schedulesByCategory, instancesByCategory, []).Count, families.Count, truncated),
            levelEntries,
            sheetEntries,
            viewEntries,
            scheduleIndexEntries,
            categoryEntries,
            familyEntries,
            request.IncludeBrowserProvenance ? browserIndex.Organizations : [],
            request.IncludeModelContext ? TimePhase("model-context", () => CollectModelContext(document)) : null,
            RevitDataOutputBudgets.ProjectIssues(issues, budget),
            new RevitDataResultPage(totalCount, returnedCount, truncated)
        );
        Log.Debug("ProjectIndex collected in {ElapsedMilliseconds} ms: levels={LevelCount}, sheets={SheetCount}, views={ViewCount}, schedules={ScheduleCount}, categories={CategoryCount}, families={FamilyCount}", totalStopwatch.ElapsedMilliseconds, levels.Count, sheets.Count, views.Count, scheduleEntries.Count, CreateCategoryNames(familiesByCategory, schedulesByCategory, instancesByCategory, []).Count, families.Count);
        return result;
    }

    private static ProjectIndexModelContext CollectModelContext(Document document) {
        var majorCategories = new[] {
            BuiltInCategory.OST_MechanicalEquipment,
            BuiltInCategory.OST_DuctCurves,
            BuiltInCategory.OST_DuctFitting,
            BuiltInCategory.OST_DuctAccessory,
            BuiltInCategory.OST_PipeCurves,
            BuiltInCategory.OST_PipeFitting,
            BuiltInCategory.OST_PipeAccessory,
            BuiltInCategory.OST_PlumbingFixtures,
            BuiltInCategory.OST_ElectricalEquipment,
            BuiltInCategory.OST_ElectricalFixtures,
            BuiltInCategory.OST_LightingFixtures,
            BuiltInCategory.OST_CableTray,
            BuiltInCategory.OST_Conduit
        };
        var categoryCounts = majorCategories
            .Select(category => new {
                Category = Category.GetCategory(document, category),
                Count = new FilteredElementCollector(document)
                    .OfCategory(category)
                    .WhereElementIsNotElementType()
                    .GetElementCount()
            })
            .Where(item => item.Category != null && item.Count != 0)
            .Select(item => new ProjectIndexModelCategoryCount(item.Category!.Name, item.Count))
            .OrderBy(item => item.CategoryName, IgnoreCase)
            .ToList();

        return new ProjectIndexModelContext(
            new FilteredElementCollector(document).OfClass(typeof(RevitLinkInstance)).GetElementCount(),
            CountCategory(document, BuiltInCategory.OST_Rooms),
            CountCategory(document, BuiltInCategory.OST_MEPSpaces),
            CountCategory(document, BuiltInCategory.OST_Areas),
            categoryCounts
        );
    }

    private static int CountCategory(Document document, BuiltInCategory category) => new FilteredElementCollector(document)
        .OfCategory(category)
        .WhereElementIsNotElementType()
        .GetElementCount();

    private static ProjectIndexLevelEntry CreateLevelEntry(
        Document document,
        Level level,
        IReadOnlyList<View> views,
        IReadOnlyList<ScheduleCatalogEntry> schedules,
        IReadOnlyDictionary<long, int> instanceCountsByLevelId,
        bool includeHandles,
        int maxSamples,
        ProjectIndexPlacementIndex placementIndex
    ) {
        var levelViews = views.Where(view => string.Equals(view.GenLevel?.Name, level.Name, StringComparison.OrdinalIgnoreCase)).ToList();
        var placedViews = levelViews.Where(view => placementIndex.IsViewPlaced(view.Id)).ToList();
        var sheetHandles = includeHandles
            ? placedViews.SelectMany(view => placementIndex.GetSheetHandlesForView(view.Id)).DistinctByHandle().Take(maxSamples).ToList()
            : [];
        var levelSchedules = schedules.Where(schedule => string.Equals(FindScheduleLevelName(document, schedule), level.Name, StringComparison.OrdinalIgnoreCase)).ToList();
        return new ProjectIndexLevelEntry(
            CreateHandle(document, level, RevitAgentContextHandleKind.Element, level.Name),
            level.Name,
            level.Elevation,
            levelViews.Count,
            placedViews.Count,
            levelSchedules.Count,
            levelSchedules.Count(schedule => schedule.IsPlacedOnSheet),
            instanceCountsByLevelId.TryGetValue(level.Id.Value(), out var instanceCount) ? instanceCount : 0,
            sheetHandles,
            [new RevitAgentContextProvenance(RevitAgentContextProvenanceKind.BrowserIndex, "Level indexed from project levels and linked view/sheet/schedule facts.")]
        );
    }

    private static ProjectIndexSheetEntry CreateSheetEntry(Document document, ViewSheet sheet, bool includeHandles, bool includeBrowserPaths, int maxSamples, ProjectBrowserCollectedIndex browserIndex, ProjectIndexPlacementIndex placementIndex) {
        var placedViews = placementIndex.GetPlacedViews(sheet.Id);
        var placedSchedules = placementIndex.GetPlacedSchedules(sheet.Id);
        var levelNames = placedViews.Select(view => view.GenLevel?.Name).OfType<string>().Where(name => !string.IsNullOrWhiteSpace(name)).Distinct(IgnoreCase).OrderBy(name => name, IgnoreCase).ToList();
        return new ProjectIndexSheetEntry(
            CreateHandle(document, sheet, RevitAgentContextHandleKind.Sheet, $"{sheet.SheetNumber} - {sheet.Name}"),
            sheet.SheetNumber,
            sheet.Name,
            placedViews.Count,
            placedSchedules.Count,
            includeHandles ? placedViews.Select(view => CreateHandle(document, view, RevitAgentContextHandleKind.View, view.Title)).Take(maxSamples).ToList() : [],
            includeHandles ? placedSchedules.Select(schedule => CreateHandle(document, schedule, RevitAgentContextHandleKind.Schedule, schedule.Name)).Take(maxSamples).ToList() : [],
            levelNames,
            browserIndex.Get(ProjectBrowserSection.Sheets, sheet.Id, includeBrowserPaths),
            [new RevitAgentContextProvenance(RevitAgentContextProvenanceKind.PrintedContext, "Sheet indexed from project browser with placed view and schedule handles.")]
        );
    }

    private static ProjectIndexViewEntry CreateViewEntry(Document document, View view, bool includeHandles, bool includeBrowserPaths, int maxSamples, ProjectBrowserCollectedIndex browserIndex, ProjectIndexPlacementIndex placementIndex) {
        var sheetHandles = includeHandles ? placementIndex.GetSheetHandlesForView(view.Id).Take(maxSamples).ToList() : [];
        return new ProjectIndexViewEntry(
            CreateHandle(document, view, RevitAgentContextHandleKind.View, view.Title),
            view.Title,
            view.ViewType.ToString(),
            view.GenLevel?.Name,
            view.IsTemplate,
            view.CanBePrinted,
            sheetHandles.Count != 0,
            sheetHandles,
            browserIndex.Get(ProjectBrowserSection.Views, view.Id, includeBrowserPaths),
            [new RevitAgentContextProvenance(sheetHandles.Count == 0 ? RevitAgentContextProvenanceKind.BrowserIndex : RevitAgentContextProvenanceKind.PrintedContext, sheetHandles.Count == 0 ? "View indexed from project browser." : "View is placed on one or more sheets.")]
        );
    }

    private static ProjectIndexScheduleEntry CreateScheduleEntry(
        Document document,
        ScheduleCatalogEntry schedule,
        bool includeHandles,
        bool includeSamples,
        bool includeBrowserPaths,
        int maxSamples,
        ProjectBrowserCollectedIndex browserIndex,
        ProjectIndexPlacementIndex placementIndex
    ) => new(
        new RevitAgentContextHandle(RevitAgentContextHandleKind.Schedule, document.GetDocumentKey(), schedule.ScheduleId, schedule.ScheduleUniqueId, schedule.Name, schedule.CategoryName),
        schedule.Name,
        schedule.CategoryName,
        schedule.IsTemplate,
        schedule.IsPlacedOnSheet,
        schedule.FilterBySheet,
        schedule.VisibleBodyRowCount,
        schedule.VisibleFamilyCount,
        schedule.VisibleInstanceCount,
        includeHandles
            ? schedule.SheetPlacements.Select(placementIndex.GetSheetHandle).Where(handle => handle != null).Cast<RevitAgentContextHandle>().Take(maxSamples).ToList()
            : [],
        includeSamples ? schedule.ParameterUsages.Select(usage => usage.FieldName).Distinct(IgnoreCase).Take(maxSamples).ToList() : [],
        schedule.BrowserPaths.Count != 0 ? schedule.BrowserPaths : browserIndex.Get(ProjectBrowserSection.Schedules, schedule.ScheduleId.ToElementId(), includeBrowserPaths),
        [new RevitAgentContextProvenance(schedule.IsPlacedOnSheet ? RevitAgentContextProvenanceKind.PrintedContext : RevitAgentContextProvenanceKind.BrowserIndex, schedule.IsPlacedOnSheet ? "Schedule is placed on one or more sheets." : "Schedule indexed from project browser.")]
    );

    private static List<ProjectIndexCategoryEntry> CreateCategoryEntries(
        Document document,
        IReadOnlyDictionary<string, List<LoadedFamilyCatalogEntry>> familiesByCategory,
        IReadOnlyDictionary<string, List<ScheduleCatalogEntry>> schedulesByCategory,
        IReadOnlyDictionary<string, int> instancesByCategory,
        HashSet<string> categoryFilter,
        bool includeHandles,
        int maxSamples
    ) => CreateCategoryNames(familiesByCategory, schedulesByCategory, instancesByCategory, categoryFilter)
        .Select(categoryName => {
            familiesByCategory.TryGetValue(categoryName, out var families);
            schedulesByCategory.TryGetValue(categoryName, out var schedules);
            instancesByCategory.TryGetValue(categoryName, out var instanceCount);
            return new ProjectIndexCategoryEntry(
                new RevitAgentContextHandle(RevitAgentContextHandleKind.Category, document.GetDocumentKey(), null, null, categoryName, categoryName),
                categoryName,
                families?.Count ?? 0,
                instanceCount,
                schedules?.Count ?? 0,
                includeHandles ? (schedules ?? []).Select(schedule => new RevitAgentContextHandle(RevitAgentContextHandleKind.Schedule, document.GetDocumentKey(), schedule.ScheduleId, schedule.ScheduleUniqueId, schedule.Name, schedule.CategoryName)).Take(maxSamples).ToList() : [],
                [new RevitAgentContextProvenance(RevitAgentContextProvenanceKind.BrowserIndex, "Category indexed from placed families, schedules, and model instances.")]
            );
        })
        .ToList();

    private static ProjectIndexFamilyEntry CreateFamilyEntry(
        Document document,
        LoadedFamilyCatalogEntry family,
        IReadOnlyList<ScheduleCatalogEntry> scheduleEntries,
        bool includeHandles,
        int maxSamples
    ) {
        var schedules = scheduleEntries
            .Where(schedule => schedule.VisibleFamilies.Any(visibleFamily => visibleFamily.FamilyId == family.FamilyId)
                               || (!string.IsNullOrWhiteSpace(family.CategoryName) && string.Equals(schedule.CategoryName, family.CategoryName, StringComparison.OrdinalIgnoreCase)))
            .OrderBy(schedule => schedule.Name, IgnoreCase)
            .ToList();
        return new ProjectIndexFamilyEntry(
            new RevitAgentContextHandle(RevitAgentContextHandleKind.Family, document.GetDocumentKey(), family.FamilyId, family.FamilyUniqueId, family.FamilyName, family.CategoryName),
            family.FamilyName,
            family.CategoryName,
            family.TypeCount,
            family.PlacedInstanceCount,
            schedules.Count,
            includeHandles ? schedules.Select(schedule => new RevitAgentContextHandle(RevitAgentContextHandleKind.Schedule, document.GetDocumentKey(), schedule.ScheduleId, schedule.ScheduleUniqueId, schedule.Name, schedule.CategoryName)).Take(maxSamples).ToList() : [],
            [new RevitAgentContextProvenance(RevitAgentContextProvenanceKind.BrowserIndex, "Family indexed from loaded-family catalog and linked to schedules by visible family/category facts.")]
        );
    }

    private static List<T> ProjectPage<T>(List<T> entries, int? maxEntries, List<RevitDataIssue> issues, string code) {
        if (maxEntries is not > 0 || entries.Count <= maxEntries.Value)
            return entries;
        issues.Add(new RevitDataIssue(
            code,
            RevitDataIssueSeverity.Warning,
            $"Returned {maxEntries.Value} of {entries.Count} {typeof(T).Name} item(s). Increase budget.maxEntries to expand."
        ));
        return entries.Take(maxEntries.Value).ToList();
    }

    private sealed record ProjectInstanceCounts(IReadOnlyDictionary<string, int> ByCategory, IReadOnlyDictionary<long, int> ByLevelId);

    private static ProjectInstanceCounts CollectInstanceCounts(Document document) {
        var byCategory = new Dictionary<string, int>(IgnoreCase);
        var byLevelId = new Dictionary<long, int>();
        foreach (var element in new FilteredElementCollector(document).WhereElementIsNotElementType()) {
            if (element.Category != null)
                byCategory[element.Category.Name] = byCategory.GetValueOrDefault(element.Category.Name) + 1;
            if (element.LevelId != ElementId.InvalidElementId)
                byLevelId[element.LevelId.Value()] = byLevelId.GetValueOrDefault(element.LevelId.Value()) + 1;
        }

        return new ProjectInstanceCounts(byCategory, byLevelId);
    }

    private static List<string> CreateCategoryNames(
        IReadOnlyDictionary<string, List<LoadedFamilyCatalogEntry>> familiesByCategory,
        IReadOnlyDictionary<string, List<ScheduleCatalogEntry>> schedulesByCategory,
        IReadOnlyDictionary<string, int> instancesByCategory,
        HashSet<string> categoryFilter
    ) => familiesByCategory.Keys
        .Concat(schedulesByCategory.Keys)
        .Concat(instancesByCategory.Keys)
        .Where(category => categoryFilter.Count == 0 || categoryFilter.Contains(category))
        .Distinct(IgnoreCase)
        .OrderBy(category => category, IgnoreCase)
        .ToList();

    private static string? FindScheduleLevelName(Document document, ScheduleCatalogEntry schedule) => null;

    private static ProjectIndexPlacementIndex CreatePlacementIndex(Document document) {
        var sheets = new FilteredElementCollector(document)
            .OfClass(typeof(ViewSheet))
            .Cast<ViewSheet>()
            .Where(sheet => !sheet.IsTemplate)
            .ToList();
        var placedViewsBySheet = new Dictionary<long, List<View>>();
        var sheetHandlesByViewId = new Dictionary<long, List<RevitAgentContextHandle>>();
        var sheetHandlesByName = new Dictionary<string, RevitAgentContextHandle>(IgnoreCase);

        foreach (var sheet in sheets) {
            var sheetHandle = CreateHandle(document, sheet, RevitAgentContextHandleKind.Sheet, $"{sheet.SheetNumber} - {sheet.Name}");
            sheetHandlesByName[$"{sheet.SheetNumber}|{sheet.Name}"] = sheetHandle;
            foreach (var viewport in sheet.GetAllViewports().Select(document.GetElement).OfType<Viewport>()) {
                if (document.GetElement(viewport.ViewId) is not View view)
                    continue;
                Add(placedViewsBySheet, sheet.Id.Value(), view);
                Add(sheetHandlesByViewId, view.Id.Value(), sheetHandle);
            }
        }

        var placedSchedulesBySheet = new Dictionary<long, List<ViewSchedule>>();
        var sheetHandlesByScheduleId = new Dictionary<long, List<RevitAgentContextHandle>>();
        foreach (var instance in new FilteredElementCollector(document).OfClass(typeof(ScheduleSheetInstance)).Cast<ScheduleSheetInstance>()) {
            if (document.GetElement(instance.OwnerViewId) is not ViewSheet sheet || document.GetElement(instance.ScheduleId) is not ViewSchedule schedule)
                continue;
            var sheetHandle = CreateHandle(document, sheet, RevitAgentContextHandleKind.Sheet, $"{sheet.SheetNumber} - {sheet.Name}");
            Add(placedSchedulesBySheet, sheet.Id.Value(), schedule);
            Add(sheetHandlesByScheduleId, schedule.Id.Value(), sheetHandle);
        }

        return new ProjectIndexPlacementIndex(placedViewsBySheet, placedSchedulesBySheet, sheetHandlesByViewId, sheetHandlesByScheduleId, sheetHandlesByName);
    }

    private static T TimePhase<T>(string phase, Func<T> action) {
        var stopwatch = Stopwatch.StartNew();
        var result = action();
        Log.Debug("ProjectIndex {Phase} collected in {ElapsedMilliseconds} ms", phase, stopwatch.ElapsedMilliseconds);
        return result;
    }

    private static void Add<T>(Dictionary<long, List<T>> dictionary, long key, T value) {
        if (!dictionary.TryGetValue(key, out var values)) {
            values = [];
            dictionary[key] = values;
        }
        values.Add(value);
    }

    private sealed record ProjectIndexPlacementIndex(
        IReadOnlyDictionary<long, List<View>> PlacedViewsBySheetId,
        IReadOnlyDictionary<long, List<ViewSchedule>> PlacedSchedulesBySheetId,
        IReadOnlyDictionary<long, List<RevitAgentContextHandle>> SheetHandlesByViewId,
        IReadOnlyDictionary<long, List<RevitAgentContextHandle>> SheetHandlesByScheduleId,
        IReadOnlyDictionary<string, RevitAgentContextHandle> SheetHandlesByName
    ) {
        public bool IsViewPlaced(ElementId viewId) => SheetHandlesByViewId.ContainsKey(viewId.Value());
        public IReadOnlyList<View> GetPlacedViews(ElementId sheetId) => PlacedViewsBySheetId.TryGetValue(sheetId.Value(), out var views) ? views : [];
        public IReadOnlyList<ViewSchedule> GetPlacedSchedules(ElementId sheetId) => PlacedSchedulesBySheetId.TryGetValue(sheetId.Value(), out var schedules) ? schedules : [];
        public IReadOnlyList<RevitAgentContextHandle> GetSheetHandlesForView(ElementId viewId) => SheetHandlesByViewId.TryGetValue(viewId.Value(), out var handles) ? handles : [];
        public RevitAgentContextHandle? GetSheetHandle(ScheduleCatalogSheetPlacement placement) => SheetHandlesByName.TryGetValue($"{placement.SheetNumber}|{placement.SheetName}", out var handle) ? handle : null;
    }

    private static RevitAgentContextHandle CreateHandle(Document document, Element element, RevitAgentContextHandleKind kind, string label) => new(
        kind,
        document.GetDocumentKey(),
        element.Id.Value(),
        element.UniqueId,
        label,
        element.Category?.Name
    );

    private static bool MatchesLevelFilter(string? levelName, HashSet<string> levelNames) =>
        levelNames.Count == 0 || (!string.IsNullOrWhiteSpace(levelName) && levelNames.Contains(levelName));

    private static bool MatchesAnyContains(string? value, IReadOnlyList<string> filters) =>
        filters.Count == 0 || (!string.IsNullOrWhiteSpace(value) && filters.Any(filter => value.Contains(filter, StringComparison.OrdinalIgnoreCase)));

    private static bool MatchesSearch(string? value, IReadOnlyList<string> tokens) =>
        tokens.Count == 0 || (!string.IsNullOrWhiteSpace(value) && tokens.All(token => value.Contains(token, StringComparison.OrdinalIgnoreCase)));

    private static HashSet<string> ToFilterSet(IEnumerable<string>? values) => values?
        .Where(value => !string.IsNullOrWhiteSpace(value))
        .Select(value => value.Trim())
        .ToHashSet(IgnoreCase) ?? new HashSet<string>(IgnoreCase);

    private static List<string> ToTrimmedList(IEnumerable<string>? values) => values?
        .Where(value => !string.IsNullOrWhiteSpace(value))
        .Select(value => value.Trim())
        .Distinct(IgnoreCase)
        .ToList() ?? [];

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
