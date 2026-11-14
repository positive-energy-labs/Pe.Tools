using Newtonsoft.Json;
using Newtonsoft.Json.Converters;
using Newtonsoft.Json.Linq;

namespace Pe.Shared.HostContracts.Scripting;

public record ScriptWorkspaceBootstrapRequest(
    string WorkspaceKey = "default"
);

/// <summary>
///     What bootstrap seeded. `ProductAgentsPath` is the agent's guide in the agent's working directory and
///     `MachinePropsPath` the per-machine props file the pod's project imports; both are machine state, outside
///     every home. The workspace paths are the pod's own folder, in whichever home holds it.
/// </summary>
public record ScriptWorkspaceBootstrapData(
    string WorkspaceKey,
    string ProductHomePath,
    string ProductAgentsPath,
    string WorkspaceRootPath,
    string WorkspaceAgentsPath,
    string WorkspaceReadmePath,
    string ProjectFilePath,
    string PodManifestPath,
    string MachinePropsPath,
    string RevitVersion,
    string TargetFramework,
    string RuntimeAssemblyPath,
    List<string> GeneratedFiles
);

/// <summary>
///     `WorkspaceKey` is the host's pod selector when no `SourceBundle` is supplied. Native execution never
///     resolves it to a path: the captured manifest's id names the pod, and the host says which folder holds it.
/// </summary>
public record ExecuteRevitScriptRequest(
    string? ScriptContent = null,
    string? SourcePath = null,
    string WorkspaceKey = "default",
    string? SourceName = null,
    // Absent, a Pod entrypoint runs in the mode pod.json declares for it, and anything else runs ReadOnly.
    ScriptPermissionMode? PermissionMode = null,
    int TimeoutSeconds = 600,
    ScriptPodSourceBundle? SourceBundle = null,
    // Host-stamped over anything the input carried; a run with no stamp is the agent's and is held (ADR 0038).
    ScriptCaller Caller = ScriptCaller.Agent,
    // The script's arguments: one JSON object, at most 256 KiB, passed through untouched by every door (contract C1).
    JObject? Input = null
);

public record ScriptPodSourceFile(string Path, string BytesBase64);

public record ScriptPodSourceBundle(List<ScriptPodSourceFile> Files);

public record ScriptArtifactData(
    string Name,
    string RelativePath,
    string FullPath,
    string ContentType,
    long SizeBytes
);

public record ExecuteRevitScriptData(
    ScriptExecutionStatus Status,
    string Output,
    List<ScriptDiagnostic> Diagnostics,
    string RevitVersion,
    string TargetFramework,
    string? ContainerTypeName,
    string ExecutionId,
    List<ScriptArtifactData>? Artifacts = null,
    object? Data = null,
    PodReceipt? Attribution = null,
    // The one reason a project save or synchronize inside this run was cancelled (ADR 0038); null when none was.
    string? Held = null,
    // What the run changed in its document, in every mode; null when the script never started.
    ScriptChanges? Changes = null,
    // Every failure Revit raised while the script ran, and what became of it; null when the script never started.
    List<ScriptFailure>? Failures = null
);

/// <summary>Element ids of one kind of change. `Ids` holds at most 2,000; `Total` counts them all.</summary>
public record ScriptChangedIds(List<long> Ids, int Total);

/// <summary>
///     What a script run changed in the document it ran on, as Revit reported each commit. An element added and
///     then modified is added; one added and then deleted is in no list. `Kept` is false for a ReadOnly run: the
///     lists are what it would have changed, and Revit rolled it back. `Transactions` names each commit in order.
///     `Summary` says the same in one sentence, and says so when Revit rolled back what the run tried to commit.
///     `Undo` names the single entry Ctrl+Z in Revit undoes; when it is null on a run that kept changes,
///     `Ungrouped` says why the run's transactions are separate undo entries. `Overlapped` is true when another
///     call ran at the same time: the lists may then include that call's changes.
/// </summary>
public record ScriptChanges(
    ScriptChangedIds Added,
    ScriptChangedIds Modified,
    ScriptChangedIds Deleted,
    List<string> Transactions,
    bool Kept,
    string Summary,
    string? Undo = null,
    string? Ungrouped = null,
    bool Overlapped = false
);

/// <summary>What became of a failure Revit raised during a script run.</summary>
[JsonConverter(typeof(StringEnumConverter))]
public enum ScriptFailureOutcome {
    /// <summary>The failure's transaction did not commit: nothing it did is in the document.</summary>
    RolledBack,
    /// <summary>A warning the run acknowledged; its transaction went on.</summary>
    Dismissed,
    /// <summary>The failure's transaction committed: a warning that stands, or a failure something resolved.</summary>
    Committed
}

/// <summary>One failure in Revit's words. `DefinitionId` is Revit's failure definition GUID; `Severity` is Warning, Error or DocumentCorruption.</summary>
public record ScriptFailure(
    string Message,
    string Severity,
    string DefinitionId,
    List<long> ElementIds,
    string Transaction,
    ScriptFailureOutcome Outcome
);

/// <summary>What a run's source was: a saved member's bytes, a supplied draft, or operation input with no member.</summary>
[JsonConverter(typeof(StringEnumConverter))]
public enum PodRunOrigin {
    SavedMember,
    SuppliedDraft,
    Operation
}

/// <summary>A run's settled outcome. Cancelled is its own answer, never a rollback claim.</summary>
[JsonConverter(typeof(StringEnumConverter))]
public enum PodRunOutcome {
    Succeeded,
    Failed,
    Cancelled
}

/// <summary>
///     One run's receipt: its source origin, outcome, and outputs. `PodId` is null when an unfiled draft stores the run
///     in operation output.
///     `MemberSha256` names saved bytes, so only a <see cref="PodRunOrigin.SavedMember" /> run carries it; a
///     supplied draft keeps the path it drafts and its own bytes and hash stay in `input.json`; operation input
///     names no member.
/// </summary>
public sealed record PodReceipt {
    private PodReceipt(string? podId, string? memberPath, string? memberSha256, PodRunOrigin origin,
        string operation, string? planHash, PodRunOutcome outcome, List<string> outputs, string? reason) {
        (this.PodId, this.MemberPath, this.MemberSha256, this.Origin) = (podId, memberPath, memberSha256, origin);
        (this.Operation, this.PlanHash, this.Outcome, this.Outputs, this.Reason) = (operation, planHash, outcome, outputs, reason);
    }

    public string? PodId { get; }
    public string? MemberPath { get; }
    public string? MemberSha256 { get; }
    public PodRunOrigin Origin { get; }
    public string Operation { get; init; }
    public string? PlanHash { get; init; }
    public PodRunOutcome Outcome { get; init; }
    public List<string> Outputs { get; init; }
    private readonly string? _reason;
    public string? Reason { get => this._reason; init => this._reason = value is "" ? null : value; }

    public static PodReceipt ForSavedMember(string? podId, string path, string sha256, string operation,
        string? planHash, PodRunOutcome outcome, List<string> outputs, string? reason) =>
        new(podId, path, sha256, PodRunOrigin.SavedMember, operation, planHash, outcome, outputs, reason);

    public static PodReceipt ForOperation(string? podId, string operation, string? planHash,
        PodRunOutcome outcome, List<string> outputs, string? reason) =>
        new(podId, null, null, PodRunOrigin.Operation, operation, planHash, outcome, outputs, reason);

    /// <summary>A draft never claims a saved member's hash; operation input is not a captured member.</summary>
    public static PodReceipt ForSource(PodCapturedSourceData root, string operation, string? planHash, PodRunOutcome outcome, List<string> outputs, string? reason) =>
        root.Origin switch {
            PodRunOrigin.SavedMember => ForSavedMember(root.Id, root.Path, root.Sha256, operation, planHash, outcome, outputs, reason),
            PodRunOrigin.SuppliedDraft => new(root.Id, null, null, root.Origin, operation, planHash, outcome, outputs, reason),
            _ => throw new ArgumentException("A captured source must be a saved member or supplied draft.", nameof(root))
        };
}

public record PodMemberComposeRequest(string? Pod, string Path, string? Content = null, PodCapturedSourceData? Source = null);

public record PodMemberComposeData(string? Composed, PodCapturedSourceData Source, List<ScriptDiagnostic> Diagnostics, List<PodConsumedSourceData> Dependencies);

public record PodCapturedSourceData(
    string? Id,
    [property: JsonProperty(Required = Required.Always)] string Path,
    [property: JsonProperty(Required = Required.Always)] string Sha256,
    [property: JsonProperty(Required = Required.Always)] string BytesBase64,
    [property: JsonProperty(Required = Required.Always)] PodRunOrigin Origin);

public record PodConsumedSourceData(
    [property: JsonProperty(Required = Required.Always)] string Id,
    [property: JsonProperty(Required = Required.Always)] string Path,
    [property: JsonProperty(Required = Required.Always)] string Sha256,
    [property: JsonProperty(Required = Required.Always)] string BytesBase64);

[JsonConverter(typeof(StringEnumConverter))]
public enum ScriptExecutionStatus {
    Succeeded,
    ReferenceResolutionFailed,
    CompilationFailed,
    RuntimeFailed,
    Rejected,
    PolicyRejected,
    Cancelled,
    TimedOut
}

/// <summary>Who started a script run. Only a <c>Person</c>'s run may save or synchronize a project document.</summary>
[JsonConverter(typeof(StringEnumConverter))]
public enum ScriptCaller {
    Agent,
    Person
}

[JsonConverter(typeof(StringEnumConverter))]
public enum ScriptPermissionMode {
    ReadOnly,
    WriteTransaction,
    NoTransaction
}

[JsonConverter(typeof(StringEnumConverter))]
public enum ScriptDiagnosticSeverity {
    Info,
    Warning,
    Error
}

public record ScriptDiagnostic(
    string Stage,
    ScriptDiagnosticSeverity Severity,
    string Message,
    string? Source = null
);
