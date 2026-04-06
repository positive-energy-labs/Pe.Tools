using Pe.StorageRuntime.Json;

namespace Pe.FamilyFoundry.OperationSettings;

public class IncludeFamilies {
    [Includable(IncludableFragmentRoot.FamilyNames)]
    public List<string> Equaling { get; init; } = [];

    [Includable(IncludableFragmentRoot.FamilyNames)]
    public List<string> Containing { get; init; } = [];

    [Includable(IncludableFragmentRoot.FamilyNames)]
    public List<string> StartingWith { get; init; } = [];
}

public class ExcludeFamilies {
    [Includable(IncludableFragmentRoot.FamilyNames)]
    public List<string> Equaling { get; init; } = [];

    [Includable(IncludableFragmentRoot.FamilyNames)]
    public List<string> Containing { get; init; } = [];

    [Includable(IncludableFragmentRoot.FamilyNames)]
    public List<string> StartingWith { get; init; } = [];
}

public class IncludeSharedParameter {
    [Includable(IncludableFragmentRoot.SharedParameterNames)]
    public List<string> Equaling { get; init; } = [];

    [Includable(IncludableFragmentRoot.SharedParameterNames)]
    public List<string> Containing { get; init; } = [];

    [Includable(IncludableFragmentRoot.SharedParameterNames)]
    public List<string> StartingWith { get; init; } = [];
}

public class ExcludeSharedParameter {
    [Includable(IncludableFragmentRoot.SharedParameterNames)]
    public List<string> Equaling { get; init; } = [];

    [Includable(IncludableFragmentRoot.SharedParameterNames)]
    public List<string> Containing { get; init; } = [];

    [Includable(IncludableFragmentRoot.SharedParameterNames)]
    public List<string> StartingWith { get; init; } = [];
}
