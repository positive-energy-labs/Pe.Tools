namespace Pe.Shared.HostContracts.Operations;

public enum HostLogTarget {
    Host,
    Revit,
    All
}

public sealed record HostLogsRequest(
    HostLogTarget Target = HostLogTarget.All,
    int TailLineCount = 200
);

public sealed record HostLogFileData(
    string Label,
    string FilePath,
    string[] Lines
);

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
