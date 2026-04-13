using System.IO.Pipes;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Pe.Shared.HostContracts.Scripting;

namespace Pe.Host.Services;

internal interface IHostScriptingPipeClientService {
    Task<ScriptWorkspaceBootstrapData> BootstrapWorkspaceAsync(
        ScriptWorkspaceBootstrapRequest request,
        CancellationToken cancellationToken
    );

    Task<ExecuteRevitScriptData> ExecuteAsync(
        ExecuteRevitScriptRequest request,
        CancellationToken cancellationToken
    );
}

internal sealed class HostScriptingPipeClientService(
    string? pipeName = null,
    int connectTimeoutMs = 5000
) : IHostScriptingPipeClientService {
    private static readonly JsonSerializerOptions JsonOptions = CreateJsonOptions();
    private readonly int _connectTimeoutMs = connectTimeoutMs;
    private readonly string _pipeName = string.IsNullOrWhiteSpace(pipeName)
        ? ScriptingPipeProtocol.PipeName
        : pipeName;

    public async Task<ScriptWorkspaceBootstrapData> BootstrapWorkspaceAsync(
        ScriptWorkspaceBootstrapRequest request,
        CancellationToken cancellationToken
    ) {
        var response = await this.SendAsync(
            new ScriptingPipeRequest(
                ScriptingPipeCommand.BootstrapWorkspace,
                WorkspaceKey: request.WorkspaceKey,
                CreateSampleScript: request.CreateSampleScript
            ),
            cancellationToken
        );

        return response.Bootstrap
               ?? throw new InvalidOperationException(
                   "Revit scripting pipe returned success but no bootstrap payload."
               );
    }

    public async Task<ExecuteRevitScriptData> ExecuteAsync(
        ExecuteRevitScriptRequest request,
        CancellationToken cancellationToken
    ) {
        var response = await this.SendAsync(
            new ScriptingPipeRequest(
                ScriptingPipeCommand.ExecuteScript,
                WorkspaceKey: request.WorkspaceKey,
                SourceKind: request.SourceKind,
                SourcePath: request.SourcePath,
                ScriptContent: request.ScriptContent,
                ProjectContent: request.ProjectContent,
                SourceName: request.SourceName
            ),
            cancellationToken
        );

        return response.Result
               ?? throw new InvalidOperationException(
                   "Revit scripting pipe returned success but no execution result payload."
               );
    }

    private async Task<ScriptingPipeResponse> SendAsync(
        ScriptingPipeRequest request,
        CancellationToken cancellationToken
    ) {
        using var pipeClient = new NamedPipeClientStream(
            ".",
            this._pipeName,
            PipeDirection.InOut,
            PipeOptions.Asynchronous
        );

        try {
            await pipeClient.ConnectAsync(this._connectTimeoutMs, cancellationToken);
        } catch (TimeoutException ex) {
            throw new InvalidOperationException(
                $"Timed out waiting for Revit scripting pipe '{this._pipeName}'. Start Revit, connect exactly one Revit session to Pe.Host, and try again.",
                ex
            );
        } catch (IOException ex) {
            throw new InvalidOperationException(
                $"Could not connect to Revit scripting pipe '{this._pipeName}'. Start Revit, connect exactly one Revit session to Pe.Host, and try again.",
                ex
            );
        }

        using var reader = new StreamReader(pipeClient, Encoding.UTF8, false, 4096, leaveOpen: true);
        using var writer = new StreamWriter(pipeClient, new UTF8Encoding(false), 4096, leaveOpen: true) {
            AutoFlush = true
        };

        var payload = JsonSerializer.Serialize(request, JsonOptions);
        string? responseLine;
        try {
            await writer.WriteLineAsync(payload.AsMemory(), cancellationToken);
            responseLine = await reader.ReadLineAsync(cancellationToken);
        } catch (IOException ex) {
            throw new InvalidOperationException(
                $"Could not communicate with Revit scripting pipe '{this._pipeName}'. Start Revit, connect exactly one Revit session to Pe.Host, and try again.",
                ex
            );
        }

        if (string.IsNullOrWhiteSpace(responseLine)) {
            throw new InvalidOperationException(
                $"Could not communicate with Revit scripting pipe '{this._pipeName}'. The pipe returned an empty response."
            );
        }

        ScriptingPipeResponse response;
        try {
            response = JsonSerializer.Deserialize<ScriptingPipeResponse>(responseLine, JsonOptions)
                       ?? throw new InvalidOperationException(
                           "Revit scripting pipe returned invalid JSON."
                       );
        } catch (JsonException ex) {
            throw new InvalidOperationException(
                $"Revit scripting pipe returned invalid JSON: {ex.Message}",
                ex
            );
        }

        if (!response.Success) {
            throw new InvalidOperationException(
                string.IsNullOrWhiteSpace(response.Message)
                    ? "Revit scripting pipe returned a failure response."
                    : response.Message
            );
        }

        return response;
    }

    private static JsonSerializerOptions CreateJsonOptions() {
        var options = new JsonSerializerOptions {
            PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
            DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull
        };
        options.Converters.Add(new JsonStringEnumConverter());
        return options;
    }
}
