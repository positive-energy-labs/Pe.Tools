using NJsonSchema.Annotations;
using Pe.Revit.FamilyFoundry.Aggregators.Snapshots;
using Pe.Revit.FamilyFoundry.OperationSettings;
using Pe.Revit.FamilyFoundry.Operations;
using System.ComponentModel;

namespace Pe.Revit.FamilyFoundry.OperationGroups;

public class CleanFamilyDocumentSettings : IOperationSettings {
    public bool Enabled { get; init; } = true;

    [Description("Whether to purge nested families from the family")]
    public bool EnablePurgeNestedFamilies { get; init; } = true;
    [Description("Whether to purge reference planes from the family")]
    public bool EnablePurgeReferencePlanes { get; init; } = true;
    [Description("Whether to purge model lines from the family")]
    public bool EnablePurgeModelLines { get; init; } = true;
    [Description("Whether to purge unused parameters from the family")]
    public bool EnablePurgeParams { get; init; } = true;

    // TODO: describe
    public PurgeParamsBase PurgeParamsSettings { get; init; } = new();


    [JsonSchemaIgnore]
    public bool ShouldPurgeNestedFamilies => this.Enabled && this.EnablePurgeNestedFamilies;

    [JsonSchemaIgnore]
    public bool ShouldPurgeReferencePlanes => this.Enabled && this.EnablePurgeReferencePlanes;

    [JsonSchemaIgnore]
    public bool ShouldPurgeModelLines => this.Enabled && this.EnablePurgeModelLines;

    [JsonSchemaIgnore]
    public bool ShouldPurgeParams => this.Enabled && this.EnablePurgeParams;

    [JsonSchemaIgnore]
    public PurgeParamsSettings ResolvedPurgeParamsSettings => new() {
        Enabled = this.ShouldPurgeParams,
        DirectDeleteEmptyParameters = this.PurgeParamsSettings.DirectDeleteEmptyParameters,
        ConsiderZeroValueAsEmpty = this.PurgeParamsSettings.ConsiderZeroValueAsEmpty,
        ConsiderEmptyStringAsEmpty = this.PurgeParamsSettings.ConsiderEmptyStringAsEmpty,
        ExcludeNames = this.PurgeParamsSettings.ExcludeNames
    };
}

public class CleanFamilyDocument(
    CleanFamilyDocumentSettings settings,
    IEnumerable<string> ExcludeParamNames
    ) : OperationGroup<CleanFamilyDocumentSettings>(
        "Clean family document.",
        InitializeOperations(settings, ExcludeParamNames),
        []
    ) {

    public static List<IOperation> InitializeOperations(CleanFamilyDocumentSettings settings, IEnumerable<string> ExcludeParamNames) => [
            new PurgeNestedFamilies(new DefaultOperationSettings { Enabled = settings.ShouldPurgeNestedFamilies }),
            new PurgeReferencePlanes(new PurgeReferencePlanesSettings { Enabled = settings.ShouldPurgeReferencePlanes }),
            new PurgeModelLines(new DefaultOperationSettings { Enabled = settings.ShouldPurgeModelLines }),
            new PurgeParams(settings.ResolvedPurgeParamsSettings, ExcludeParamNames),
        ];
}