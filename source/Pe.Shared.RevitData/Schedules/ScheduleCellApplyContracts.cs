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
    ScheduleCellBinding ExpectedBinding,
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
    IReadOnlyList<ParameterValueEditResult> ParameterResults
);
