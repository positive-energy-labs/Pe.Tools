using Newtonsoft.Json;
using Newtonsoft.Json.Converters;
using TypeGen.Core.TypeAnnotations;

namespace Pe.Shared.HostContracts.Operations;

[JsonConverter(typeof(StringEnumConverter))]
[ExportTsEnum]
public enum HostLogTarget {
    Host,
    Revit,
    All
}

[ExportTsInterface]
public sealed record HostLogsRequest(
    HostLogTarget Target = HostLogTarget.All,
    int TailLineCount = 200
);

[ExportTsInterface]
public sealed record HostLogFileData(
    string Label,
    string FilePath,
    string[] Lines
);

[ExportTsInterface]
public sealed record HostLogsData(
    HostLogFileData[] Files
);

public static class GetHostLogsOperationContract {
    public static readonly HostOperationDefinition Definition =
        HostOperationDefinition.Create<HostLogsRequest, HostLogsData>(
            "host.logs",
            HostHttpVerb.Get,
            "/api/settings/logs",
            HostExecutionMode.Local,
            "Get Host Logs"
        );
}
