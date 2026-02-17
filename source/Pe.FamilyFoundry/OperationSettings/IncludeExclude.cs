using Pe.Global.Services.Storage.Core.Json;
using Pe.Global.Services.Storage.Core.Json.SchemaProcessors;
using Pe.Global.Services.Storage.Core.Json.SchemaProviders;

namespace Pe.FamilyFoundry.OperationSettings;

public class IncludeFamilies {
    [Includable("family-names")]
    [SchemaExamples(typeof(FamilyNamesProvider))]
    public List<string> Equaling { get; init; } = [];

    [Includable("family-names")]
    [SchemaExamples(typeof(FamilyNamesProvider))]
    public List<string> Containing { get; init; } = [];

    [Includable("family-names")]
    [SchemaExamples(typeof(FamilyNamesProvider))]
    public List<string> StartingWith { get; init; } = [];
}

public class ExcludeFamilies {
    [Includable("family-names")]
    [SchemaExamples(typeof(FamilyNamesProvider))]
    public List<string> Equaling { get; init; } = [];

    [Includable("family-names")]
    [SchemaExamples(typeof(FamilyNamesProvider))]
    public List<string> Containing { get; init; } = [];

    [Includable("family-names")]
    [SchemaExamples(typeof(FamilyNamesProvider))]
    public List<string> StartingWith { get; init; } = [];
}

public class IncludeSharedParameter {
    [Includable("shared-parameter-names")]
    [SchemaExamples(typeof(SharedParameterNamesProvider))]
    public List<string> Equaling { get; init; } = [];

    [Includable("shared-parameter-names")]
    [SchemaExamples(typeof(SharedParameterNamesProvider))]
    public List<string> Containing { get; init; } = [];

    [Includable("shared-parameter-names")]
    [SchemaExamples(typeof(SharedParameterNamesProvider))]
    public List<string> StartingWith { get; init; } = [];
}

public class ExcludeSharedParameter {
    [Includable("shared-parameter-names")]
    [SchemaExamples(typeof(SharedParameterNamesProvider))]
    public List<string> Equaling { get; init; } = [];

    [Includable("shared-parameter-names")]
    [SchemaExamples(typeof(SharedParameterNamesProvider))]
    public List<string> Containing { get; init; } = [];

    [Includable("shared-parameter-names")]
    [SchemaExamples(typeof(SharedParameterNamesProvider))]
    public List<string> StartingWith { get; init; } = [];
}