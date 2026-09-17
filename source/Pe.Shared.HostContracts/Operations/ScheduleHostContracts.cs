using Pe.Shared.RevitData;

namespace Pe.Shared.HostContracts.Operations;

/// <summary>Capture one schedule's definition (never its cell values) as a spec.</summary>
public sealed record ScheduleSpecCaptureRequest(long ScheduleId);

public sealed record ScheduleSpecCaptureData(Reading Reading, string ScheduleName, string SpecJson);

/// <summary>Create a new schedule from a saved spec. Apply never edits an existing schedule.</summary>
public sealed record ScheduleSpecApplyRequest(string SpecJson, PodMemberSource Source);

public sealed record ScheduleSpecApplyData(
    long ScheduleId,
    string ScheduleName,
    int AppliedFieldCount,
    IReadOnlyList<string> Skipped,
    IReadOnlyList<string> Warnings,
    string ReceiptPath
);
