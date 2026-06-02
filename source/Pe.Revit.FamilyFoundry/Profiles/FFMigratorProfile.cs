using Pe.Revit.FamilyFoundry.DesiredState;
using Pe.Revit.FamilyFoundry.OperationGroups;
using Pe.Revit.FamilyFoundry.Operations;
using Pe.Shared.StorageRuntime.Json;
using System.ComponentModel;
using System.ComponentModel.DataAnnotations;

namespace Pe.Revit.FamilyFoundry.Profiles;

public class FFMigratorProfile : BaseProfile, IDesiredMigrationParameterProfile {
    [Description("Shared parameters to add, map, or assign while bulk-processing families.")]
    public List<DesiredSharedParameterDeclaration> SharedParameters { get; init; } = [];

    [Description("Local family parameters to create, synthesize, or assign while bulk-processing families.")]
    public List<DesiredFamilyParameterDeclaration> FamilyParameters { get; init; } = [];

    [Description("Includable shared-parameter mapping data. NewName is the desired shared parameter name; CurrNames are source family parameter names.")]
    [Includable(IncludableFragmentRoot.MappingData)]
    public List<MappingData> MappingData { get; init; } = [];

    [Description("Central per-type assignment table. Each row has a Parameter column and dynamic family-type columns.")]
    [UniformChildKeys]
    public List<DesiredPerTypeAssignmentRow> PerTypeAssignmentsTable { get; init; } = [];

    [Description("Semantic solid authoring and serialization settings. Usually empty for Migrator; Manager is the primary solids shell today.")]
    public AuthoredParamDrivenSolidsSettings ParamDrivenSolids { get; init; } = new();

    [Description("Settings for cleaning the family document")]
    [Required]
    public CleanFamilyDocumentSettings CleanFamilyDocument { get; init; } = new();

    [Description("Settings for explicitly deleting exact-name family parameters.")]
    [Required]
    public DeleteParamsSettings DeleteParams { get; init; } = new();

    [Description("Settings for sorting parameters within each property group.")]
    [Required]
    public SortParamsSettings SortParams { get; init; } = new();
}
