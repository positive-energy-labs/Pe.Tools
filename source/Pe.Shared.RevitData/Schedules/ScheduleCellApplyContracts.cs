using Newtonsoft.Json;
using Pe.Shared.RevitData;

namespace Pe.Shared.RevitData.Schedules;

public sealed record ScheduleCellApplyRequest(
    long ScheduleId,
    string ScheduleUniqueId,
    IReadOnlyList<ScheduleCellEdit> Edits,
    bool DryRun = false,
    string? TransactionName = null
);

public sealed record ScheduleCellEdit(
    int RowNumber,
    int ColumnNumber,
    [property: JsonProperty(Required = Required.Always)] ScheduleCellBinding ExpectedBinding,
    string? Value = null,
    string? Unit = null,
    bool RawInternal = false
);

public sealed record ScheduleCellApplyData(
    int AppliedCells,
    int AppliedParameterWrites,
    bool DryRun,
    IReadOnlyList<ScheduleCellEditResult> Results,
    IReadOnlyList<RevitDataIssue> Diagnostics
);

public sealed record ScheduleCellEditResult(
    int Index,
    int RowNumber,
    int ColumnNumber,
    bool Ok,
    string? Error,
    ScheduleCellBinding? CurrentBinding,
    // Each nested Index is the corresponding CurrentBinding.Targets position, not the global
    // coalesced native-batch index. Generic ParameterValueApplyData indices remain unchanged.
    IReadOnlyList<ParameterValueEditResult> ParameterResults
);
