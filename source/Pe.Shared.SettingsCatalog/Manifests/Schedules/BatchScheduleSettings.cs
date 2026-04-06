using System.ComponentModel;
using System.ComponentModel.DataAnnotations;

namespace Pe.Shared.SettingsCatalog.Manifests.Schedules;

/// <summary>
///     Settings for batch schedule creation.
///     Contains a simple array of schedule profile file paths to run.
/// </summary>
public class BatchScheduleSettings {
    [Description(
        "List of schedule profile JSON files to create in batch. Paths are relative to the schedules/ directory.")]
    [Required]
    public List<string> ScheduleFiles { get; set; } = [];
}
