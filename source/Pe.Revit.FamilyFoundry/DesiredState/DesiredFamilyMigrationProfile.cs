using Autodesk.Revit.DB;
using Newtonsoft.Json;
using Newtonsoft.Json.Converters;
using Newtonsoft.Json.Linq;
using Pe.Revit.Extensions.FamDocument.SetValue;
using Pe.Revit.FamilyFoundry.OperationGroups;
using Pe.Revit.FamilyFoundry.Operations;
using Pe.Revit.FamilyFoundry.OperationSettings;
using Pe.Revit.SettingsRuntime.Json.RevitTypes;
using Pe.Shared.RevitData;
using Pe.Shared.StorageRuntime.Json;
using System.ComponentModel;
using System.ComponentModel.DataAnnotations;

namespace Pe.Revit.FamilyFoundry.DesiredState;

public interface IDesiredParameterProfile {
    List<DesiredSharedParameterDeclaration> SharedParameters { get; }
    List<DesiredFamilyParameterDeclaration> FamilyParameters { get; }
    List<DesiredPerTypeAssignmentRow> PerTypeAssignmentsTable { get; }
    AuthoredParamDrivenSolidsSettings ParamDrivenSolids { get; }
}

public interface IDesiredMigrationParameterProfile : IDesiredParameterProfile {
    List<MappingData> MappingData { get; }
}

public sealed class DesiredFamilyMigrationProfile : BaseProfile, IDesiredMigrationParameterProfile {
    [Description("Shared parameters to add, map, or assign. MappingData targets can also imply shared declarations by name.")]
    public List<DesiredSharedParameterDeclaration> SharedParameters { get; init; } = [];

    [Description("Local family parameters to create, synthesize, or assign.")]
    public List<DesiredFamilyParameterDeclaration> FamilyParameters { get; init; } = [];

    [Description("Includable shared-parameter mapping data. NewName is the desired shared parameter name; CurrNames are source family parameter names.")]
    [Includable(IncludableFragmentRoot.MappingData)]
    public List<MappingData> MappingData { get; init; } = [];

    [Description("Central per-type assignment table. Each row has a Parameter column and dynamic family-type columns.")]
    [UniformChildKeys]
    public List<DesiredPerTypeAssignmentRow> PerTypeAssignmentsTable { get; init; } = [];

    [Description("Semantic solid authoring and serialization settings.")]
    public AuthoredParamDrivenSolidsSettings ParamDrivenSolids { get; init; } = new();

    [Description("Optional existing cleanup settings to run after desired-state reconciliation.")]
    public CleanFamilyDocumentSettings CleanFamilyDocument { get; init; } = new() { Enabled = false };

    [Description("Optional explicitly-authored parameter delete settings to run after desired-state reconciliation.")]
    public DeleteParamsSettings DeleteParams { get; init; } = new() { Enabled = false };

    [Description("Optional electrical connector creation and parameter binding settings to run after desired-state reconciliation.")]
    public MakeElecConnectorSettings MakeElectricalConnector { get; init; } = new() { Enabled = false };

    [Description("Optional existing parameter sorting settings to run after desired-state reconciliation.")]
    public SortParamsSettings SortParams { get; init; } = new() { Enabled = false };
}

public sealed class DesiredSharedParameterDeclaration : AuthoredSharedParameterDeclaration {
    [Description("Optional source family parameter names to map into this shared parameter, in priority order.")]
    [Includable("family-parameter-names")]
    public List<string> SourceNames { get; init; } = [];

    [Description("Only add the shared parameter when at least one SourceNames entry exists in the family.")]
    public bool OnlyAddIfSourceExists { get; init; }

    [Description("Internal mapping/coercion strategy used when SourceNames map into this shared parameter.")]
    public string MappingStrategy { get; init; } = nameof(BuiltInCoercionStrategy.CoerceByStorageType);
}

public sealed class DesiredFamilyParameterDeclaration : AuthoredFamilyParameterDeclaration;

public sealed record DesiredPerTypeAssignmentRow {
    public const string ParameterColumn = "Parameter";

    [Description("The declared parameter name for this per-type assignment row.")]
    [Required]
    public string Parameter { get; init; } = string.Empty;

    [JsonExtensionData]
    public IDictionary<string, JToken> ValuesByType { get; init; } =
        new Dictionary<string, JToken>(StringComparer.Ordinal);
}

public sealed class SharedParameterSelectionSpec {
    [Description("Shared parameter name patterns to include.")]
    public SharedParameterSelectionFilter Include { get; init; } = new();

    [Description("Shared parameter name patterns to exclude after inclusion.")]
    public SharedParameterSelectionFilter Exclude { get; init; } = new();

    public bool HasIncludeFilters => this.Include.HasFilters;

    public bool Matches(string? name) {
        if (string.IsNullOrWhiteSpace(name)) return false;
        return this.Include.Matches(name) && !this.Exclude.Matches(name);
    }
}

public sealed class SharedParameterSelectionFilter {
    [Includable(IncludableFragmentRoot.SharedParameterNames)]
    public List<string> Names { get; init; } = [];

    [Includable(IncludableFragmentRoot.SharedParameterNames)]
    public List<string> Containing { get; init; } = [];

    [Includable(IncludableFragmentRoot.SharedParameterNames)]
    public List<string> StartingWith { get; init; } = [];

    public bool HasFilters => this.Names.Any() || this.Containing.Any() || this.StartingWith.Any();

    public bool Matches(string name) {
        if (!this.HasFilters) return false;
        return this.Names.Any(filter => string.Equals(name, filter, StringComparison.Ordinal)) ||
               this.Containing.Any(filter => name.Contains(filter, StringComparison.Ordinal)) ||
               this.StartingWith.Any(filter => name.StartsWith(filter, StringComparison.Ordinal));
    }
}

public sealed record DesiredParameterAssignmentSpec(
    [property: JsonConverter(typeof(StringEnumConverter))]
    ParamAssignmentKind Kind,
    string Value
);

public sealed class DesiredParameterMigrationSpec {
    public List<string> SourceNames { get; init; } = [];
    public bool OnlyAddIfSourceExists { get; init; }
    public string MappingStrategy { get; init; } = nameof(BuiltInCoercionStrategy.CoerceByStorageType);
}

[JsonConverter(typeof(StringEnumConverter))]
public enum ResolvedParameterMetadataProvenance {
    Authored,
    ParameterService,
    ParameterServiceDefault,
    FamilyFoundryDefault,
    SnapshotOrFixture,
    Unresolved
}

public sealed record ResolvedParameterMetadataProvenanceSet(
    ResolvedParameterMetadataProvenance Identity,
    ResolvedParameterMetadataProvenance DataType,
    ResolvedParameterMetadataProvenance PropertiesGroup,
    ResolvedParameterMetadataProvenance IsInstance,
    ResolvedParameterMetadataProvenance Tooltip
);

public sealed record ResolvedParameterDefinition(
    ParameterIdentity Identity,
    string Name,
    ForgeTypeId DataType,
    ForgeTypeId PropertiesGroup,
    bool IsInstance,
    string? Tooltip
);

public sealed record ResolvedDesiredParameter(
    ResolvedParameterDefinition Definition,
    bool IsShared,
    DesiredParameterAssignmentSpec? Assignment,
    IReadOnlyDictionary<string, string?> ValuesByType,
    DesiredParameterMigrationSpec? Migration,
    ResolvedParameterMetadataProvenanceSet Provenance
);

public sealed record FamilyMigrationReconciliationPlan(
    IReadOnlyList<ResolvedDesiredParameter> Parameters,
    IReadOnlyList<string> RequiredApsParameterNames,
    IReadOnlyList<string> FamilyParameterNames,
    IReadOnlyList<LoweredDesiredMigrationAction> LoweredActions
);

public sealed record LoweredDesiredMigrationAction(
    string Operation,
    string Target,
    IReadOnlyList<string> Sources,
    string Reason
);
