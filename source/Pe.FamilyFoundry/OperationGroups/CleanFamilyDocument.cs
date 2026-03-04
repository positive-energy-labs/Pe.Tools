using Pe.FamilyFoundry.Aggregators.Snapshots;
using Pe.FamilyFoundry.Operations;
using Pe.FamilyFoundry.OperationSettings;
using System.ComponentModel;

namespace Pe.FamilyFoundry.OperationGroups;

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

    public bool ShouldPurgeNestedFamilies => this.Enabled && this.EnablePurgeNestedFamilies;
    public bool ShouldPurgeReferencePlanes => this.Enabled && this.EnablePurgeReferencePlanes;
    public bool ShouldPurgeModelLines => this.Enabled && this.EnablePurgeModelLines;
    public bool ShouldPurgeParams => this.Enabled && this.EnablePurgeParams;

    // TODO: describe
    public PurgeParamsBase PurgeParamsSettings { get; init; } = new();

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