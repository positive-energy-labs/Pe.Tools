using System.IO.Pipes;
using System.Text;
using System.Text.Json;
using Pe.Shared.HostContracts.Scripting;
using Serilog;

namespace Pe.Revit.Scripting.Transport;

public sealed class ScriptingPipeServer : IDisposable {
    private readonly ScriptingPipeMessageHandler _messageHandler;
    private readonly CancellationTokenSource _shutdown = new();
    private readonly Task _listenLoop;
    private bool _disposed;

    public ScriptingPipeServer(ScriptingPipeMessageHandler messageHandler) {
        this._messageHandler = messageHandler;
        this._listenLoop = Task.Run(() => this.RunAsync());
    }

    private async Task RunAsync() {
        while (!this._shutdown.IsCancellationRequested) {
            NamedPipeServerStream? pipe = null;
            try {
                pipe = new NamedPipeServerStream(
                    ScriptingPipeProtocol.PipeName,
                    PipeDirection.InOut,
                    1,
                    PipeTransmissionMode.Message,
                    PipeOptions.Asynchronous
                );
                Log.Information("Revit scripting pipe waiting for client: Pipe={PipeName}", ScriptingPipeProtocol.PipeName);
                await WaitForConnectionAsync(pipe, this._shutdown.Token).ConfigureAwait(false);
                Log.Information("Revit scripting pipe client connected: Pipe={PipeName}", ScriptingPipeProtocol.PipeName);
                await this.HandleClientAsync(pipe, this._shutdown.Token).ConfigureAwait(false);
            } catch (OperationCanceledException) when (this._shutdown.IsCancellationRequested) {
                break;
            } catch (ObjectDisposedException) when (this._shutdown.IsCancellationRequested) {
                break;
            } catch (Exception ex) {
                Log.Error(ex, "Revit scripting pipe loop failed.");
            } finally {
                pipe?.Dispose();
            }
        }
    }

    private async Task HandleClientAsync(
        NamedPipeServerStream pipe,
        CancellationToken cancellationToken
    ) {
        using var reader = new StreamReader(pipe, Encoding.UTF8, false, 4096, leaveOpen: true);
        using var writer = new StreamWriter(pipe, new UTF8Encoding(false), 4096, leaveOpen: true) {
            AutoFlush = true
        };

        var line = await ReadLineAsync(reader, cancellationToken).ConfigureAwait(false);
        if (string.IsNullOrWhiteSpace(line))
            return;

        var response = await this.TryHandleRequestAsync(line, cancellationToken).ConfigureAwait(false);
        var payload = JsonSerializer.Serialize(response, ScriptingPipeContracts.JsonOptions);
        await WriteLineAsync(writer, payload, cancellationToken).ConfigureAwait(false);
    }

    private async Task<ScriptingPipeResponse> TryHandleRequestAsync(
        string payload,
        CancellationToken cancellationToken
    ) {
        try {
            var request = JsonSerializer.Deserialize<ScriptingPipeRequest>(payload, ScriptingPipeContracts.JsonOptions);
            if (request == null)
                return new ScriptingPipeResponse(false, "The scripting pipe request payload was empty.");

            return await this._messageHandler.HandleAsync(request, cancellationToken).ConfigureAwait(false);
        } catch (JsonException ex) {
            return new ScriptingPipeResponse(false, $"Invalid scripting pipe request JSON: {ex.Message}");
        } catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested) {
            return new ScriptingPipeResponse(false, "The scripting pipe request was canceled.");
        } catch (Exception ex) {
            return new ScriptingPipeResponse(false, ex.Message);
        }
    }

    public void Dispose() {
        if (this._disposed)
            return;

        this._disposed = true;
        this._shutdown.Cancel();
        this._messageHandler.Dispose();
        this._shutdown.Dispose();
    }

    private static async Task WaitForConnectionAsync(
        NamedPipeServerStream pipe,
        CancellationToken cancellationToken
    ) {
#if NET5_0_OR_GREATER
        await pipe.WaitForConnectionAsync(cancellationToken).ConfigureAwait(false);
#else
        using (cancellationToken.Register(() => {
                   try {
                       pipe.Dispose();
                   } catch {
                       // Best effort cancellation for net48.
                   }
               })) {
            await Task.Factory.FromAsync(pipe.BeginWaitForConnection, pipe.EndWaitForConnection, null)
                .ConfigureAwait(false);
        }
#endif
    }

    private static async Task<string?> ReadLineAsync(
        StreamReader reader,
        CancellationToken cancellationToken
    ) {
#if NET8_0_OR_GREATER
        return await reader.ReadLineAsync(cancellationToken).ConfigureAwait(false);
#else
        return await reader.ReadLineAsync().ConfigureAwait(false);
#endif
    }

    private static async Task WriteLineAsync(
        StreamWriter writer,
        string payload,
        CancellationToken cancellationToken
    ) {
#if NET8_0_OR_GREATER
        await writer.WriteLineAsync(payload.AsMemory(), cancellationToken).ConfigureAwait(false);
#else
        await writer.WriteLineAsync(payload).ConfigureAwait(false);
#endif
    }
}
