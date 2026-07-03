using System.ComponentModel.DataAnnotations;
using Newtonsoft.Json;
using Newtonsoft.Json.Converters;
using Pe.Shared.Codegen;

namespace Pe.Shared.RevitData;

[JsonConverter(typeof(StringEnumConverter))]
[ExportTsSchema]
public enum RevitDataResultView {
    Summary,
    Handles,
    Rows,
    Full
}


[ExportTsSchema]
public record RevitDataOutputBudget {
    [Range(1, 100000)]
    public int? MaxEntries { get; init; }

    [Range(1, 10000)]
    public int? MaxRowsPerEntry { get; init; }

    [Range(1, 10000)]
    public int? MaxSamplesPerEntry { get; init; }

    public bool IncludeDiagnostics { get; init; } = true;
}

[ExportTsSchema]
public record RevitDataProjectionRequest {
    public RevitDataResultView View { get; init; } = RevitDataResultView.Summary;
    public RevitDataOutputBudget? Budget { get; init; }
}

[ExportTsSchema]
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
