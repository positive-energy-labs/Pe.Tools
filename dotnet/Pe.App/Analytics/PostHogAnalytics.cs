using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using Pe.Revit.Global.Services.Host;
using Pe.Revit.ServiceClient;
using Pe.Shared.HostContracts.Transport;
using Pe.Shared.Product;
using Serilog;
using Serilog.Core;
using Serilog.Events;
using System.Reflection;

namespace Pe.App.Analytics;

/// <summary>Local-first native facts. Only the admitted host owns export identity and vendor egress.</summary>
internal static class RevitReceipts {
    private static readonly NativeReceiptBuffer Pending = new();
    private static CancellationTokenSource Shutdown = new();
    private static readonly SemaphoreSlim DrainGate = new(1, 1);
    private static readonly Assembly Payload = typeof(RevitReceipts).Assembly;
    internal static readonly string AppVersion = Payload
        .GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion ?? "unknown";
    private static string? _reportedHostVersion;

    internal static void Start() {
        if (Shutdown.IsCancellationRequested) Shutdown = new CancellationTokenSource();
    }

    private static JObject Emitter() => new() {
        ["version"] = AppVersion,
        ["build"] = Metadata("Pe.Build"),
        ["commit"] = Metadata("Pe.Commit"),
    };

    private static string? Metadata(string key) => Payload.GetCustomAttributes<AssemblyMetadataAttribute>()
        .SingleOrDefault(value => value.Key == key)?.Value;

    internal static void Boot(string revitVersion) {
        Log.Information("Native app boot: Version={Version}, RevitVersion={RevitVersion}", AppVersion, revitVersion);
        Submit(ReceiptEventIds.Usage(ReceiptEventIds.AppBoot, new JObject { ["revitVersion"] = revitVersion }));
    }

    internal static void RibbonClick(string id) {
        var command = Payload.GetTypes().FirstOrDefault(type =>
            typeof(Autodesk.Revit.UI.IExternalCommand).IsAssignableFrom(type) &&
            type.FullName != null && id.EndsWith(type.FullName, StringComparison.Ordinal));
        if (command != null)
            Submit(ReceiptEventIds.Usage(ReceiptEventIds.RibbonClick, new JObject { ["commandCode"] = command.Name }));
    }

    internal static void PaletteAction(ReceiptPaletteTab tab, bool? ok = null, ReceiptPaletteMode? mode = null) =>
        Submit(ReceiptEventIds.Palette(tab, ok, mode));

    internal static void Fault(LogEvent logEvent) {
        var code = logEvent.Level == LogEventLevel.Fatal ? "process.uncaught" : "native.failed";
        Submit(new JObject { ["kind"] = "diagnostic", ["code"] = code }, RevitReceiptTransport.CurrentRequestId);
    }

    private static void Submit(JObject body, string? requestId = null) {
        if (Shutdown.IsCancellationRequested) return;
        try {
            Pending.Enqueue(ReceiptEventIds.Producer(body, Emitter(), requestId));
            FlushPending();
        } catch {
            // The raw boot/error record was already written locally. Never recurse through the error sink.
        }
    }

    internal static void FlushPending() => _ = DrainAsync();

    private static async Task DrainAsync() {
        if (!await DrainGate.WaitAsync(0).ConfigureAwait(false)) return;
        var shutdown = Shutdown;
        var drained = false;
        try {
            while (!shutdown.IsCancellationRequested && Pending.Peek() is { } fact) {
                using var deadline = CancellationTokenSource.CreateLinkedTokenSource(shutdown.Token);
                deadline.CancelAfter(TimeSpan.FromSeconds(2));
                var forward = RevitReceiptTransport.ForwardAsync(fact.ToString(Formatting.None), deadline.Token);
                if (await Task.WhenAny(forward, Task.Delay(TimeSpan.FromSeconds(2), shutdown.Token)).ConfigureAwait(false) != forward) {
                    _ = forward.ContinueWith(task => { _ = task.Exception; }, TaskContinuationOptions.OnlyOnFaulted);
                    return;
                }
                if (!await forward.ConfigureAwait(false)) return;
                Pending.Delivered(fact);
            }
            drained = true;
        } catch {
            // Host unavailable: retain the bounded memory queue; reconnect triggers another drain.
        } finally {
            DrainGate.Release();
            if ((drained || !ReferenceEquals(shutdown, Shutdown)) && !Shutdown.IsCancellationRequested && Pending.Peek() != null)
                FlushPending();
        }
    }

    internal static void Stop() => Shutdown.Cancel();

    internal static void ReportHostVersion() {
        try {
            var host = PeServiceDiscovery.TryDiscover(ProductRuntimeLayout.ForCurrentUser().RootPath,
                HostEndpoint.ConfiguredServiceName ?? HostEndpoint.ServiceName)?.Version;
            if (host == null || host == AppVersion || host == _reportedHostVersion) return;
            _reportedHostVersion = host;
            Log.Warning("Installed host {HostVersion} does not match add-in {AppVersion}.", host, AppVersion);
            Submit(ReceiptEventIds.Usage(ReceiptEventIds.VersionMismatch, new JObject { ["hostVersion"] = host }));
        } catch {
            // Service discovery must never affect native startup or reconnection.
        }
    }
}

/// <summary>The file sink precedes this sink. Free text, stack traces and source paths remain there.</summary>
internal sealed class RevitReceiptExceptionSink : ILogEventSink {
    public void Emit(LogEvent logEvent) {
        if (logEvent.Level >= LogEventLevel.Error && logEvent.Exception != null)
            RevitReceipts.Fault(logEvent);
    }
}
