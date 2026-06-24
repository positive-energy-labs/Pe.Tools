using Pe.Revit.FamilyFoundry.DesiredState;
using Pe.Revit.FamilyFoundry.Operations;
using System.ComponentModel;
using System.ComponentModel.DataAnnotations;

namespace Pe.Revit.FamilyFoundry.Profiles;

public class FFManagerProfile : BaseProfile, IDesiredParameterProfile {
    [Description("Shared parameters to add or assign in the current family.")]
    public List<DesiredSharedParameterDeclaration> SharedParameters { get; init; } = [];

    [Description("Local family parameters to create, synthesize, or assign in the current family.")]
    public List<DesiredFamilyParameterDeclaration> FamilyParameters { get; init; } = [];

    [Description("Central per-type assignment table. Each row has a Parameter column and dynamic family-type columns.")]
    public List<DesiredPerTypeAssignmentRow> PerTypeAssignmentsTable { get; init; } = [];

    [Description("Settings for authored family lookup tables imported into Revit size tables.")]
    [Required]
    public SetLookupTablesSettings SetLookupTables { get; init; } = new();

    [Description("Semantic solid authoring and serialization settings.")]
    [Required]
    public AuthoredParamDrivenSolidsSettings ParamDrivenSolids { get; init; } = new();

    [Description("Optional room calculation point authoring for bulk room-aware family processing.")]
    [Required]
    public AddRoomDinglerSettings AddRoomDingler { get; init; } = new();
}
