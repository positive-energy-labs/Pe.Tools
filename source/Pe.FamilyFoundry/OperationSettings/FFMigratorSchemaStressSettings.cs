using Pe.Extensions.FamDocument.SetValue;
using Pe.Global.Services.Storage.Core.Json;
using Pe.Global.Services.Storage.Core.Json.SchemaProcessors;
using Pe.Global.Services.Storage.Core.Json.SchemaProviders;
using System.ComponentModel;
using System.ComponentModel.DataAnnotations;

namespace Pe.FamilyFoundry.OperationSettings;

/// <summary>
///     Non-executing settings contract used to stress test schema rendering and provider behavior
///     for FF Migrator-like workflows.
/// </summary>
public class FFMigratorSchemaStressSettings {
    [Description("Family name used to drive dependent family type selection.")]
    [Required]
    [SchemaExamples(typeof(FamilyNamesProvider))]
    public string FamilyName { get; init; } = string.Empty;

    [Description("Family type (symbol) names filtered by FamilyName.")]
    [SchemaExamples(typeof(FamilyTypeNamesByFamilyProvider))]
    public string FamilyTypeName { get; init; } = string.Empty;

    [Description("Category name used by multiple dependent providers.")]
    [Required]
    [SchemaExamples(typeof(CategoryNamesProvider))]
    public string CategoryName { get; init; } = string.Empty;

    [Description("Family names filtered by CategoryName.")]
    [SchemaExamples(typeof(FamilyNamesByCategoryProvider))]
    public List<string> FamiliesByCategory { get; init; } = [];

    [Description("Annotation tag family names bound to CategoryName.")]
    [SchemaExamples(typeof(AnnotationTagFamilyNamesProvider))]
    public string TagFamilyName { get; init; } = string.Empty;

    [Description("Shared parameter names with optional selected-family context filtering.")]
    [SchemaExamples(typeof(SharedParameterNamesProvider))]
    public string SharedParameterName { get; init; } = string.Empty;

    [Description("Schedule category name used to scope schedule and schedulable field options.")]
    [SchemaExamples(typeof(CategoryNamesProvider))]
    public string ScheduleCategoryName { get; init; } = string.Empty;

    [Description("Existing schedule names filtered by ScheduleCategoryName.")]
    [SchemaExamples(typeof(ScheduleNamesByCategoryProvider))]
    public string ScheduleName { get; init; } = string.Empty;

    [Description("Schedulable field names discovered from schedules in ScheduleCategoryName.")]
    [SchemaExamples(typeof(SchedulableFieldNamesByCategoryProvider))]
    public string SchedulableFieldName { get; init; } = string.Empty;

    [Description("Formatting mode to simulate project unit vs schedule-specific display behavior.")]
    [SchemaExamples(typeof(ScheduleFormattingModeProvider))]
    public string FormattingMode { get; init; } = "ProjectUnits";

    [Description("UnitTypeId name for display formatting preview scenarios.")]
    [SchemaExamples(typeof(UnitTypeIdNamesProvider))]
    public string FormatUnitTypeName { get; init; } = string.Empty;

    [Description("Mapping rows used to stress dependent providers and nested validation rendering.")]
    [Required]
    [Includable(IncludableFragmentRoot.StressMappingData)]
    public List<SchemaStressMappingData> MappingData { get; init; } = [];

    [Description("Enabled flag for consistency with operation-style settings contracts.")]
    [Required]
    public bool Enabled { get; init; } = true;
}

public class SchemaStressMappingData {
    [Description("Candidate source parameter names ordered by mapping priority.")]
    [SchemaExamples(typeof(SharedParameterNamesProvider))]
    public List<string> CurrNames { get; init; } = [];

    [Description("Target shared parameter name. Should be unique across mapping rows.")]
    [Required]
    [SchemaExamples(typeof(SharedParameterNamesProvider))]
    public string NewName { get; init; } = string.Empty;

    [Description("Coercion strategy used to stress dropdown/validation behavior for mapping strategy choices.")]
    [SchemaExamples(typeof(MappingStrategyNamesProvider))]
    public string MappingStrategy { get; init; } = nameof(BuiltInCoercionStrategy.CoerceByStorageType);

    [Description("Optional note field to verify description popovers and free-form inputs.")]
    public string? Notes { get; init; }
}
