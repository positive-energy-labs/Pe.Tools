using Pe.Shared.HostContracts.Operations;
using Pe.Shared.HostContracts.Protocol;
using Pe.Shared.HostContracts.SettingsStorage;
using Pe.Shared.RevitData.Schedules;
using TypeGen.Core.TypeAnnotations;

namespace Pe.Shared.HostContracts.RevitData;

[ExportTsInterface]
public record ScheduleCatalogRequest : IBridgeSessionRequest {
    public List<string> CategoryNames { get; init; } = [];
    public List<string> ScheduleNames { get; init; } = [];
    public List<ScheduleCustomParameterFilter> CustomParameterFilters { get; init; } = [];
    public bool IncludeTemplates { get; init; }
    public BridgeSessionSelector? Target { get; init; }
}

[ExportTsInterface]
public record ScheduleCatalogEnvelopeResponse(
    bool Ok,
    EnvelopeCode Code,
    string Message,
    List<ValidationIssue> Issues,
    ScheduleCatalogData? Data
) : IHostDataEnvelope<ScheduleCatalogData> {
    public object? GetData() => this.Data;
}

[ExportTsInterface]
public record ScheduleProfilesQueryRequest(
    ScheduleProfilesQuery? Query = null,
    BridgeSessionSelector? Target = null
) : IBridgeSessionRequest;

[ExportTsInterface]
public record ScheduleProfilesQueryEnvelopeResponse(
    bool Ok,
    EnvelopeCode Code,
    string Message,
    List<ValidationIssue> Issues,
    ScheduleProfilesQueryData? Data
) : IHostDataEnvelope<ScheduleProfilesQueryData> {
    public object? GetData() => this.Data;
}

[ExportTsInterface]
public record ScheduleQueryRequest(
    ScheduleQuery? Query = null,
    BridgeSessionSelector? Target = null
) : IBridgeSessionRequest;

[ExportTsInterface]
public record ScheduleQueryEnvelopeResponse(
    bool Ok,
    EnvelopeCode Code,
    string Message,
    List<ValidationIssue> Issues,
    ScheduleQueryData? Data
) : IHostDataEnvelope<ScheduleQueryData> {
    public object? GetData() => this.Data;
}