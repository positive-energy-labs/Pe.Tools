using Newtonsoft.Json;
using System.ComponentModel;
using System.ComponentModel.DataAnnotations;

namespace Pe.Shared.RevitData.Families;

/// <summary>Resolve current placements across every type of one exactly identified loaded family.</summary>
public sealed record FamilyInstanceReferencesRequest(
    [property: Range(typeof(long), "1", "9007199254740991")]
    long FamilyId,
    [property: Required, MinLength(1), RegularExpression(@".*\S.*")]
    string FamilyUniqueId,
    [property: Range(1, 1000), DefaultValue(500), JsonProperty(DefaultValueHandling = DefaultValueHandling.Populate)]
    int MaxResults = 500
);

/// <summary>
///     Echoes the requested family identity; error issues mean it was not resolved.
///     Empty or truncated placements must not authorize Select or Selection Box.
/// </summary>
public sealed record FamilyInstanceReferencesData(
    long FamilyId,
    string FamilyUniqueId,
    IReadOnlyList<ElementContextElementRef> Instances,
    RevitDataResultPage Page,
    IReadOnlyList<RevitDataIssue> Issues
);
