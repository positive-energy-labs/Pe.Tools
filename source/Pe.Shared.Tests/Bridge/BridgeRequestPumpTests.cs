using Newtonsoft.Json;
using Newtonsoft.Json.Converters;
using Newtonsoft.Json.Serialization;
using Pe.Shared.HostContracts.Bridge;
using System.Net;
using System.Net.Sockets;
using System.Net.WebSockets;

namespace Pe.Shared.Tests.Bridge;

/// <summary>
///     The census the whole cancel story rests on: while one op runs, does the read loop take the
///     next frame off the socket? If it does not, no cancel frame can ever reach a running op.
/// </summary>
[TestFixture]
public sealed class BridgeRequestPumpTests {
    private static readonly TimeSpan Patience = TimeSpan.FromSeconds(5);

    [Test]
    public async Task ReadLoopReadsTheNextFrameWhileTheFirstOpIsStillRunning() {
        using var pair = await WebSocketPair.ConnectAsync();
        var firstStarted = new TaskCompletionSource();
        var releaseFirst = new TaskCompletionSource();
        var secondStarted = new TaskCompletionSource();

        using var shutdown = new CancellationTokenSource();
        var pump = new BridgeRequestPump(pair.Client, async (request, _) => {
            if (request.RequestId == "slow") {
                firstStarted.TrySetResult();
                await releaseFirst.Task;
            } else
                secondStarted.TrySetResult();
        });
        var loop = pump.RunAsync(shutdown.Token);

        await pair.Server.WriteAsync(RequestFrame("slow"), CancellationToken.None);
        await firstStarted.Task.WaitAsync(Patience);
        await pair.Server.WriteAsync(RequestFrame("fast"), CancellationToken.None);

        var read = await Task.WhenAny(secondStarted.Task, Task.Delay(Patience));
        releaseFirst.TrySetResult();
        shutdown.Cancel();

        Assert.That(
            read,
            Is.SameAs(secondStarted.Task),
            "The read loop did not read the second frame while the first op was still running."
        );
    }

    internal static BridgeFrame RequestFrame(string requestId, string operationKey = "test.slow", string payloadJson = "{}") =>
        new(BridgeFrameKind.Request, Request: new BridgeRequest(requestId, operationKey, payloadJson));

    /// <summary>Two real WebSocket ends over loopback TCP — the same transport the bridge runs on.</summary>
    internal sealed class WebSocketPair : IDisposable {
        internal static readonly JsonSerializerSettings SerializerSettings = new() {
            NullValueHandling = NullValueHandling.Ignore,
            ContractResolver = new DefaultContractResolver {
                NamingStrategy = new CamelCaseNamingStrategy {
                    ProcessDictionaryKeys = false,
                    OverrideSpecifiedNames = false
                }
            },
            Converters = [new StringEnumConverter()]
        };

        private readonly TcpClient _clientSocket;
        private readonly TcpClient _serverSocket;

        private WebSocketPair(TcpClient clientSocket, TcpClient serverSocket, BridgeTransportSession client, BridgeTransportSession server) {
            this._clientSocket = clientSocket;
            this._serverSocket = serverSocket;
            this.Client = client;
            this.Server = server;
        }

        /// <summary>The Revit-side end (the agent reads here).</summary>
        public BridgeTransportSession Client { get; }

        /// <summary>The host-side end (the test writes request frames here).</summary>
        public BridgeTransportSession Server { get; }

        public static async Task<WebSocketPair> ConnectAsync() {
            var listener = new TcpListener(IPAddress.Loopback, 0);
            listener.Start();
            try {
                var clientSocket = new TcpClient();
                var connect = clientSocket.ConnectAsync(IPAddress.Loopback, ((IPEndPoint)listener.LocalEndpoint).Port);
                var serverSocket = await listener.AcceptTcpClientAsync();
                await connect;
                return new WebSocketPair(
                    clientSocket,
                    serverSocket,
                    new BridgeTransportSession(
                        WebSocket.CreateFromStream(clientSocket.GetStream(), isServer: false, null, TimeSpan.FromSeconds(30)),
                        SerializerSettings
                    ),
                    new BridgeTransportSession(
                        WebSocket.CreateFromStream(serverSocket.GetStream(), isServer: true, null, TimeSpan.FromSeconds(30)),
                        SerializerSettings
                    )
                );
            } finally {
                listener.Stop();
            }
        }

        public void Dispose() {
            this.Client.Dispose();
            this.Server.Dispose();
            this._clientSocket.Dispose();
            this._serverSocket.Dispose();
        }
    }
}
