using Pe.StorageRuntime.Revit.Core.Json.SchemaProviders;
using Pe.StorageRuntime.Json;
using Pe.StorageRuntime.Revit.Core.Json.SchemaProcessors;

namespace Pe.FamilyFoundry.OperationSettings;

public class IncludeFamilies {
    [Includable(IncludableFragmentRoot.FamilyNames)]
    [SchemaExamples(typeof(FamilyNamesProvider))]
    public List<string> Equaling { get; init; } = [];

    [Includable(IncludableFragmentRoot.FamilyNames)]
    [SchemaExamples(typeof(FamilyNamesProvider))]
    public List<string> Containing { get; init; } = [];

    [Includable(IncludableFragmentRoot.FamilyNames)]
    [SchemaExamples(typeof(FamilyNamesProvider))]
    public List<string> StartingWith { get; init; } = [];
}

public class ExcludeFamilies {
    [Includable(IncludableFragmentRoot.FamilyNames)]
    [SchemaExamples(typeof(FamilyNamesProvider))]
    public List<string> Equaling { get; init; } = [];

    [Includable(IncludableFragmentRoot.FamilyNames)]
    [SchemaExamples(typeof(FamilyNamesProvider))]
    public List<string> Containing { get; init; } = [];

    [Includable(IncludableFragmentRoot.FamilyNames)]
    [SchemaExamples(typeof(FamilyNamesProvider))]
    public List<string> StartingWith { get; init; } = [];
}

public class IncludeSharedParameter {
    [Includable(IncludableFragmentRoot.SharedParameterNames)]
    [SchemaExamples(typeof(SharedParameterNamesProvider))]
    public List<string> Equaling { get; init; } = [];

    [Includable(IncludableFragmentRoot.SharedParameterNames)]
    [SchemaExamples(typeof(SharedParameterNamesProvider))]
    public List<string> Containing { get; init; } = [];

    [Includable(IncludableFragmentRoot.SharedParameterNames)]
    [SchemaExamples(typeof(SharedParameterNamesProvider))]
    public List<string> StartingWith { get; init; } = [];
}

public class ExcludeSharedParameter {
    [Includable(IncludableFragmentRoot.SharedParameterNames)]
    [SchemaExamples(typeof(SharedParameterNamesProvider))]
    public List<string> Equaling { get; init; } = [];

    [Includable(IncludableFragmentRoot.SharedParameterNames)]
    [SchemaExamples(typeof(SharedParameterNamesProvider))]
    public List<string> Containing { get; init; } = [];

    [Includable(IncludableFragmentRoot.SharedParameterNames)]
    [SchemaExamples(typeof(SharedParameterNamesProvider))]
    public List<string> StartingWith { get; init; } = [];
}
