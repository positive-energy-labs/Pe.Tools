using Autodesk.Revit.DB.Structure;
using Pe.Revit.Global.Revit.Lib.Families.LoadedFamilies.Models;
using Pe.Revit.Global.Revit.Lib.Schedules;
using Pe.Shared.RevitData.Families;
using Serilog;
using System.Diagnostics;

namespace Pe.Revit.Global.Revit.Lib.Families.LoadedFamilies.Collectors;

public static class LoadedFamiliesScheduleCollector {
    public static List<CollectedLoadedFamilyRecord> Supplement(
        Document doc,
        IReadOnlyList<CollectedLoadedFamilyRecord> families,
        LoadedFamiliesMatrixEvaluationContext context,
        Action<ViewSchedule, TimeSpan, TimeSpan, int>? onScheduleEvaluated = null
    ) {
        if (families.Count == 0)
            return [];

        var familyElements = GetFamilyElementsById(doc, families);
        var scheduleNamesByFamilyId = families.ToDictionary(
            family => family.FamilyId,
            _ => new List<string>()
        );

        foreach (var categoryGroup in GroupFamiliesByCategory(families, familyElements)) {
            var schedules = GetCandidateSchedules(doc, categoryGroup.CategoryId);
            if (schedules.Count == 0)
                continue;

            var categoryPlacements = context.GetPlacedInstancesForCategory(categoryGroup.CategoryId).ToList();
            foreach (var schedule in schedules) {
                var serializeStopwatch = Stopwatch.StartNew();
                var spec = ScheduleHelper.SerializeSchedule(schedule);
                spec.FilterBySheet = false;
                var serializeElapsed = serializeStopwatch.Elapsed;

                var evaluateStopwatch = Stopwatch.StartNew();
                var matchingFamilyIds = spec.Filters.Count == 0
                    ? categoryGroup.FamilyElements.Select(family => family.Id.Value()).ToList()
                    : EvaluateScheduleAgainstPlacements(doc, schedule, spec, categoryPlacements);
                var evaluateElapsed = evaluateStopwatch.Elapsed;

                foreach (var familyId in matchingFamilyIds) {
                    if (!scheduleNamesByFamilyId.TryGetValue(familyId, out var scheduleNames))
                        continue;

                    if (!scheduleNames.Contains(schedule.Name, StringComparer.Ordinal))
                        scheduleNames.Add(schedule.Name);
                }

                onScheduleEvaluated?.Invoke(schedule, serializeElapsed, evaluateElapsed, matchingFamilyIds.Count);
            }
        }

        return ApplyScheduleNames(families, scheduleNamesByFamilyId);
    }

    public static List<CollectedLoadedFamilyRecord> Supplement(
        Document doc,
        IReadOnlyList<CollectedLoadedFamilyRecord> families
    ) {
        if (families.Count == 0)
            return [];

        var familyElements = GetFamilyElementsById(doc, families);
        var scheduleNamesByFamilyId = families.ToDictionary(
            family => family.FamilyId,
            _ => new List<string>()
        );

        foreach (var categoryGroup in GroupFamiliesByCategory(families, familyElements)) {
            var schedules = GetCandidateSchedules(doc, categoryGroup.CategoryId);
            if (schedules.Count == 0)
                continue;

            foreach (var schedule in schedules) {
                var spec = ScheduleHelper.SerializeSchedule(schedule);
                spec.FilterBySheet = false;
                var matchingFamilyIds = ScheduleHelper.GetFamilyIdsMatchingFiltersAnyType(
                    doc,
                    spec,
                    categoryGroup.FamilyElements
                );

                foreach (var familyId in matchingFamilyIds) {
                    if (!scheduleNamesByFamilyId.TryGetValue(familyId, out var scheduleNames))
                        continue;

                    if (!scheduleNames.Contains(schedule.Name, StringComparer.Ordinal))
                        scheduleNames.Add(schedule.Name);
                }
            }
        }

        return families
            .Select(family => family with {
                ScheduleNames = scheduleNamesByFamilyId.TryGetValue(family.FamilyId, out var scheduleNames)
                    ? scheduleNames.OrderBy(name => name, StringComparer.OrdinalIgnoreCase).ToList()
                    : []
            })
            .OrderBy(family => family.FamilyName, StringComparer.OrdinalIgnoreCase)
            .ToList();
    }

    private static List<long> EvaluateScheduleAgainstPlacements(
        Document doc,
        ViewSchedule sourceSchedule,
        ScheduleSpec spec,
        IReadOnlyList<TempPlacedSymbolRecord> placements
    ) {
        if (placements.Count == 0)
            return [];

        var matchingFamilyIds = ScheduleHelper.GetFamilyIdsMatchingFiltersAnyType(doc, spec, placements);
        Log.Debug(
            "Loaded families matrix evaluated schedule '{ScheduleName}' against {PlacementCount} placed symbols. Matches={MatchCount}",
            sourceSchedule.Name,
            placements.Count,
            matchingFamilyIds.Count
        );
        return matchingFamilyIds;
    }

    private static List<CollectedLoadedFamilyRecord> ApplyScheduleNames(
        IReadOnlyList<CollectedLoadedFamilyRecord> families,
        IReadOnlyDictionary<long, List<string>> scheduleNamesByFamilyId
    ) =>
        families
            .Select(family => family with {
                ScheduleNames = scheduleNamesByFamilyId.TryGetValue(family.FamilyId, out var scheduleNames)
                    ? scheduleNames.OrderBy(name => name, StringComparer.OrdinalIgnoreCase).ToList()
                    : []
            })
            .OrderBy(family => family.FamilyName, StringComparer.OrdinalIgnoreCase)
            .ToList();

    private static Dictionary<long, Family> GetFamilyElementsById(
        Document doc,
        IReadOnlyList<CollectedLoadedFamilyRecord> families
    ) {
        var selectedFamilyIds = families
            .Select(family => family.FamilyId)
            .ToHashSet();

        return new FilteredElementCollector(doc)
            .OfClass(typeof(Family))
            .Cast<Family>()
            .Where(family => selectedFamilyIds.Contains(family.Id.Value()))
            .ToDictionary(family => family.Id.Value());
    }

    private static List<FamilyCategoryGroup> GroupFamiliesByCategory(
        IReadOnlyList<CollectedLoadedFamilyRecord> families,
        IReadOnlyDictionary<long, Family> familyElements
    ) =>
        families
            .Select(family => new {
                Record = family,
                Element = familyElements.TryGetValue(family.FamilyId, out var element) ? element : null
            })
            .Where(x => x.Element?.FamilyCategory?.Id != null)
            .GroupBy(
                x => x.Element!.FamilyCategory!.Id,
                x => x.Element!,
                ElementIdComparer.Instance
            )
            .Select(group => new FamilyCategoryGroup(
                group.Key,
                group.GroupBy(family => family.Id.Value())
                    .Select(x => x.First())
                    .OrderBy(family => family.Name, StringComparer.OrdinalIgnoreCase)
                    .ToList()
            ))
            .ToList();

    private static List<ViewSchedule> GetCandidateSchedules(
        Document doc,
        ElementId categoryId
    ) =>
        new FilteredElementCollector(doc)
            .OfClass(typeof(ViewSchedule))
            .Cast<ViewSchedule>()
            .Where(schedule => !schedule.IsTemplate)
            .Where(schedule => schedule.Definition != null)
            .Where(schedule => schedule.Definition.CategoryId == categoryId)
            .Where(schedule => !schedule.Name.Contains("<Revision Schedule>", StringComparison.OrdinalIgnoreCase))
            .OrderBy(schedule => schedule.Name, StringComparer.OrdinalIgnoreCase)
            .ToList();

    private sealed record FamilyCategoryGroup(
        ElementId CategoryId,
        List<Family> FamilyElements
    );

    private sealed class ElementIdComparer : IEqualityComparer<ElementId> {
        public static ElementIdComparer Instance { get; } = new();

        public bool Equals(ElementId? x, ElementId? y) =>
            x?.Value() == y?.Value();

        public int GetHashCode(ElementId obj) =>
            obj.Value().GetHashCode();
    }
}
