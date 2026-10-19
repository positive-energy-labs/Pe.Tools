using System.IO.Pipes;
using System.Text.Json;

namespace Pe.Host.Tray;

// One window belongs to one verified parent incarnation, never to a reused port.
internal sealed class TraySingleton : IDisposable {
    private readonly Mutex _mutex;
    private readonly string _name;
    private readonly CancellationTokenSource _stop = new();
    public bool IsOwner { get; }

    public TraySingleton(TrayLaunch launch) {
        _name = "PeTools.Tray." + launch.ProfileKey + "." + launch.ParentPid + "." + launch.ParentStart.UtcTicks;
        _mutex = new Mutex(false, "Local\\" + _name);
        try { IsOwner = _mutex.WaitOne(0); } catch (AbandonedMutexException) { IsOwner = true; }
    }

    public async Task<bool> ShowAsync(string? route) {
        using var client = new NamedPipeClientStream(".", _name, PipeDirection.InOut, PipeOptions.Asynchronous);
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(3));
        try {
            await client.ConnectAsync(timeout.Token);
            using var writer = new StreamWriter(client, leaveOpen: true) { AutoFlush = true };
            using var reader = new StreamReader(client, leaveOpen: true);
            await writer.WriteLineAsync(JsonSerializer.Serialize(route));
            return await reader.ReadLineAsync(timeout.Token) == "shown";
        } catch (Exception error) when (error is IOException or OperationCanceledException) { return false; }
    }

    public async Task ListenAsync(Action<string?> show) {
        while (!_stop.IsCancellationRequested) {
            try {
                using var pipe = new NamedPipeServerStream(_name, PipeDirection.InOut, 1,
                    PipeTransmissionMode.Byte, PipeOptions.Asynchronous | PipeOptions.CurrentUserOnly);
                await pipe.WaitForConnectionAsync(_stop.Token);
                using var reader = new StreamReader(pipe, leaveOpen: true);
                using var writer = new StreamWriter(pipe, leaveOpen: true) { AutoFlush = true };
                using var request = CancellationTokenSource.CreateLinkedTokenSource(_stop.Token);
                request.CancelAfter(TimeSpan.FromSeconds(3));
                var value = await reader.ReadLineAsync(request.Token);
                var route = JsonSerializer.Deserialize<string?>(value ?? "");
                if (route is not null && !TrayLaunch.IsCanonicalRoute(route)) continue;
                show(route);
                await writer.WriteLineAsync("shown");
            } catch (Exception error) when (error is IOException or OperationCanceledException or JsonException) { }
        }
    }

    public void Dispose() {
        _stop.Cancel();
        if (IsOwner) _mutex.ReleaseMutex();
        _mutex.Dispose();
    }
}
