using Newtonsoft.Json;
using System.Net.WebSockets;
using System.Text;

namespace Pe.Shared.HostContracts.Bridge;

public sealed class BridgeTransportSession : IDisposable {
    public const int MaxFrameBytes = 16 * 1024 * 1024;

    private readonly JsonSerializerSettings _serializerSettings;
    private readonly WebSocket _webSocket;
    private readonly SemaphoreSlim _writeLock = new(1, 1);

    public BridgeTransportSession(
        WebSocket webSocket,
        JsonSerializerSettings serializerSettings,
        string? connectionId = null
    ) {
        this.ConnectionId = connectionId ?? Guid.NewGuid().ToString("N");
        this._webSocket = webSocket;
        this._serializerSettings = serializerSettings;
    }

    public string ConnectionId { get; }

    public bool IsConnected =>
        this._webSocket.State is WebSocketState.Open or WebSocketState.CloseSent;

    public void Dispose() {
        this._writeLock.Dispose();
        this._webSocket.Dispose();
    }

    public async Task<BridgeFrame?> ReadAsync(CancellationToken cancellationToken) {
        var buffer = new byte[8192];
        using var stream = new MemoryStream();

        while (true) {
            var result = await this._webSocket.ReceiveAsync(
                new ArraySegment<byte>(buffer),
                cancellationToken
            ).ConfigureAwait(false);

            if (result.MessageType == WebSocketMessageType.Close)
                return null;

            if (result.MessageType != WebSocketMessageType.Text)
                throw new InvalidOperationException($"Unsupported bridge WebSocket message type '{result.MessageType}'.");

            if (stream.Length + result.Count > MaxFrameBytes)
                throw new InvalidOperationException(
                    $"Bridge WebSocket frame exceeded the {MaxFrameBytes} byte limit."
                );

            stream.Write(buffer, 0, result.Count);
            if (!result.EndOfMessage)
                continue;

            var json = Encoding.UTF8.GetString(stream.ToArray());
            return JsonConvert.DeserializeObject<BridgeFrame>(json, this._serializerSettings);
        }
    }

    public async Task WriteAsync(BridgeFrame frame, CancellationToken cancellationToken) {
        await this._writeLock.WaitAsync(cancellationToken).ConfigureAwait(false);
        try {
            var json = JsonConvert.SerializeObject(frame, this._serializerSettings);
            var bytes = Encoding.UTF8.GetBytes(json);
            if (bytes.Length > MaxFrameBytes)
                throw new InvalidOperationException(
                    $"Bridge WebSocket frame exceeded the {MaxFrameBytes} byte limit."
                );

            await this._webSocket.SendAsync(
                new ArraySegment<byte>(bytes),
                WebSocketMessageType.Text,
                true,
                cancellationToken
            ).ConfigureAwait(false);
        } finally {
            _ = this._writeLock.Release();
        }
    }

    public void Write(BridgeFrame frame) =>
        this.WriteAsync(frame, CancellationToken.None).GetAwaiter().GetResult();
}
