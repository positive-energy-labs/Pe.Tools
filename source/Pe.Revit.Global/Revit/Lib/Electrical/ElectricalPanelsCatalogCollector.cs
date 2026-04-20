using Autodesk.Revit.DB.Electrical;
using Pe.Shared.HostContracts.RevitData;

namespace Pe.Revit.Global.Revit.Lib.Electrical;

public static class ElectricalPanelsCatalogCollector {
    public static ElectricalPanelsCatalogData Collect(
        Document doc,
        ElectricalPanelsCatalogRequest? request = null
    ) {
        var panelNames = ElectricalCollectorSupport.ToFilterSet(request?.Filter?.PanelNames);
        var marks = ElectricalCollectorSupport.ToFilterSet(request?.Filter?.Marks);
        var issues = new List<RevitDataIssue>();

        var panelScheduleStats = BuildPanelScheduleStats(doc, issues);

        var entries = new FilteredElementCollector(doc)
            .OfClass(typeof(FamilyInstance))
            .Cast<FamilyInstance>()
            .Where(instance => instance.MEPModel is ElectricalEquipment)
            .Select(instance => TryCollectEntry(instance, panelScheduleStats, issues))
            .Where(entry => entry != null)
            .Cast<ElectricalPanelCatalogEntry>()
            .Where(entry => entry.IsOperationalPanel)
            .Where(entry => (panelNames.Count == 0 || panelNames.Contains(entry.PanelName)) &&
                            (marks.Count == 0 ||
                             (!string.IsNullOrWhiteSpace(entry.Mark) && marks.Contains(entry.Mark))))
            .OrderBy(entry => entry.PanelName, StringComparer.OrdinalIgnoreCase)
            .ThenBy(entry => entry.Mark, StringComparer.OrdinalIgnoreCase)
            .ToList();

        return new ElectricalPanelsCatalogData(entries, issues);
    }

    private static ElectricalPanelCatalogEntry? TryCollectEntry(
        FamilyInstance panel,
        IReadOnlyDictionary<long, PanelScheduleStats> panelScheduleStats,
        List<RevitDataIssue> issues
    ) {
        try {
            var equipment = panel.MEPModel as ElectricalEquipment;
            var assignedCircuits = ElectricalCollectorSupport.GetAssignedCircuits(equipment);
            var scheduleStats = panelScheduleStats.TryGetValue(panel.Id.Value(), out var stats)
                ? stats
                : new PanelScheduleStats(0, null, ElectricalPanelCapacitySource.None);
            var panelScheduleCount = scheduleStats.Count;
            var role = ElectricalCollectorSupport.DeterminePanelRole(equipment, assignedCircuits.Count,
                panelScheduleCount);
            var distributionSystemName = ElectricalCollectorSupport.SafeGet(() =>
                ElectricalCollectorSupport.GetDistributionSystemName(equipment)
            );
            var maxCircuitCount = ElectricalCollectorSupport.SafeGet(() => equipment?.MaxNumberOfCircuits ?? 0);
            var occupiedSlotCount = assignedCircuits.Sum(GetOccupiedSlotCount);
            var availableSlotCount = scheduleStats.ConfiguredSlotCount.HasValue
                ? Math.Max(scheduleStats.ConfiguredSlotCount.Value - occupiedSlotCount, 0)
                : 0;

            var connectedLoadCount = assignedCircuits
                .SelectMany(system => system.Elements.Cast<Element>())
                .Select(element => element.Id.Value())
                .Distinct()
                .Count();

            return new ElectricalPanelCatalogEntry(
                panel.Id.Value(),
                panel.UniqueId,
                ElectricalCollectorSupport.GetPanelName(panel) ?? panel.Name,
                ElectricalCollectorSupport.ReadMark(panel),
                panel.Category?.Name,
                ElectricalCollectorSupport.GetFamilyName(panel),
                ElectricalCollectorSupport.GetTypeName(panel),
                role,
                role == ElectricalInsightRole.Panel,
                distributionSystemName,
                maxCircuitCount,
                scheduleStats.ConfiguredSlotCount,
                occupiedSlotCount,
                availableSlotCount,
                scheduleStats.CapacitySource,
                assignedCircuits.Count,
                panelScheduleCount,
                connectedLoadCount
            );
        } catch (Exception ex) {
            issues.Add(ElectricalCollectorSupport.Warning(
                "ElectricalPanelCatalogFailed",
                ex.Message,
                panel.Name
            ));
            return null;
        }
    }

    private static IReadOnlyDictionary<long, PanelScheduleStats> BuildPanelScheduleStats(
        Document doc,
        List<RevitDataIssue> issues
    ) =>
        new FilteredElementCollector(doc)
            .OfClass(typeof(PanelScheduleView))
            .Cast<PanelScheduleView>()
            .Select(schedule => TryCollectScheduleStat(schedule, issues))
            .Where(item => item != null)
            .Cast<(long PanelId, int? ConfiguredSlotCount)>()
            .GroupBy(item => item.PanelId)
            .ToDictionary(
                group => group.Key,
                group => new PanelScheduleStats(
                    group.Count(),
                    group.Select(item => item.ConfiguredSlotCount).FirstOrDefault(value => value.HasValue),
                    group.Any(item => item.ConfiguredSlotCount.HasValue)
                        ? ElectricalPanelCapacitySource.PanelScheduleData
                        : ElectricalPanelCapacitySource.None
                )
            );

    private static (long PanelId, int? ConfiguredSlotCount)? TryCollectScheduleStat(
        PanelScheduleView schedule,
        List<RevitDataIssue> issues
    ) {
        try {
            return (
                schedule.GetPanel().Value(),
                ElectricalCollectorSupport.SafeGet(() => schedule.GetTableData().NumberOfSlots)
            );
        } catch (Exception ex) {
            issues.Add(ElectricalCollectorSupport.Warning(
                "ElectricalPanelScheduleStatFailed",
                ex.Message,
                schedule.Name
            ));
            return null;
        }
    }

    private static int GetOccupiedSlotCount(ElectricalSystem system) {
        var occupiedSlotNumbers = system.CircuitNumber
            .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Length;
        return occupiedSlotNumbers > 0
            ? occupiedSlotNumbers
            : Math.Max(system.PolesNumber, 1);
    }

    private sealed record PanelScheduleStats(
        int Count,
        int? ConfiguredSlotCount,
        ElectricalPanelCapacitySource CapacitySource
    );
}