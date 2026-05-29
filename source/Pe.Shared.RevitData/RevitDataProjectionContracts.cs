using Newtonsoft.Json;
using Newtonsoft.Json.Converters;
using TypeGen.Core.TypeAnnotations;

namespace Pe.Shared.RevitData;

[JsonConverter(typeof(StringEnumConverter))]
[ExportTsEnum]
public enum RevitDataResultView {
    Summary,
    Handles,
    Rows,
    Full
}


[ExportTsInterface]
public record RevitDataRequestEnvelope<TFilter, TScope, TReference, TOptions> {
    public TFilter? Filter { get; init; }
    public TScope? Scope { get; init; }
    public List<TReference> References { get; init; } = [];
    public RevitDataProjectionRequest? Projection { get; init; }
    public RevitDataOutputBudget? Budget { get; init; }
    public TOptions? Options { get; init; }
}

[ExportTsInterface]
public record RevitDataNoFilter;

[ExportTsInterface]
public record RevitDataNoScope;

[ExportTsInterface]
public record RevitDataNoReference;

[ExportTsInterface]
public record RevitDataNoOptions;

[ExportTsInterface]
public record RevitDataOutputBudget {
    public int? MaxEntries { get; init; }
    public int? MaxRowsPerEntry { get; init; }
    public int? MaxSamplesPerEntry { get; init; }
    public bool IncludeDiagnostics { get; init; } = true;
}

[ExportTsInterface]
public record RevitDataProjectionRequest {
    public RevitDataResultView View { get; init; } = RevitDataResultView.Summary;
    public RevitDataOutputBudget? Budget { get; init; }
}

[ExportTsInterface]
public record RevitDataResultPage(
    int TotalCount,
    int ReturnedCount,
    bool IsTruncated
);

public static class RevitDataOutputBudgets {
    public static RevitDataOutputBudget WithDefaults(
        RevitDataOutputBudget? budget,
        int? maxEntries = null,
        int? maxRowsPerEntry = null,
        int? maxSamplesPerEntry = null,
        bool includeDiagnostics = true
    ) => new() {
        MaxEntries = budget?.MaxEntries ?? maxEntries,
        MaxRowsPerEntry = budget?.MaxRowsPerEntry ?? maxRowsPerEntry,
        MaxSamplesPerEntry = budget?.MaxSamplesPerEntry ?? maxSamplesPerEntry,
        IncludeDiagnostics = budget?.IncludeDiagnostics ?? includeDiagnostics
    };

    public static List<RevitDataIssue> ProjectIssues(
        IReadOnlyList<RevitDataIssue> issues,
        RevitDataOutputBudget budget
    ) => budget.IncludeDiagnostics ? issues.ToList() : [];
}
