using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using Pe.Revit.ServiceClient;
using Pe.Shared.HostContracts.Transport;
using Pe.Shared.Product;
using Serilog;
using Serilog.Core;
using Serilog.Events;
using System.IO;
using System.Net.Http;
using System.Reflection;
using System.Text;

namespace Pe.App.Analytics;

/// <summary>
///     PostHog usage analytics for the internal beta. The installed product manifest carries the key;
///     a checkout without one reads Documents\Pe.Tools\preferences.json:
///     { "posthog": { "apiKey": "phc_...", "host": "https://us.i.posthog.com" } }
///     No key → every call is a no-op. The key is a public write-only ingest key.
///     Mirrors ts/packages/runtime/src/analytics.ts (event shapes must match).
/// </summary>
internal static class PostHogAnalytics {
    // ponytail: char cap, not bytes — close enough for a truncation signal.
    private const int PayloadBudget = 256 * 1024;

    private static readonly HttpClient Http = new() { Timeout = TimeSpan.FromSeconds(10) };
    private static string? _apiKey;
    private static string _host = "https://us.i.posthog.com";

    /// <summary>Set from the document tracker so events carry the active model's title.</summary>
    internal static string? CurrentDocumentTitle { get; set; }

    /// <summary>The add-in's own release version ("dev" on a checkout build).</summary>
    internal static readonly string AppVersion = typeof(PostHogAnalytics).Assembly
        .GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion ?? "unknown";

    private static string? _reportedHostVersion;

    private static readonly string ProductRoot = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "Positive Energy", "Pe.Tools");

    private static string? _installId;

    internal static bool Enabled => _apiKey != null;

    internal static void Initialize() {
        try {
            // Installed product manifest is AUTHORITATIVE (the key rides the release, so
            // installed machines need zero seeding); preferences.json stays the dev/override
            // fallback. Mirrors analytics.ts — resolution order must match.
            var manifest = Path.Combine(ProductRoot, "product.payloads.json");
            if (!TryAdopt(manifest, root => root["telemetry"]?["posthog"]))
                TryAdopt(ProductUserContentLayout.ForCurrentUser().PreferencesPath, root => root["posthog"]);
        } catch {
            // Analytics must never affect startup.
        }
    }

    private static bool TryAdopt(string path, Func<JObject, JToken?> select) {
        try {
            if (!File.Exists(path)) return false;
            var posthog = select(JObject.Parse(File.ReadAllText(path)));
            var apiKey = posthog?["apiKey"]?.ToString()?.Trim();
            if (string.IsNullOrEmpty(apiKey)) return false;
            _apiKey = apiKey;
            _host = posthog?["host"]?.ToString()?.TrimEnd('/') ?? _host;
            return true;
        } catch {
            return false;
        }
    }

    /// <summary>
    ///     One stable id per machine install, shared with the host (analytics.ts):
    ///     state\install.json = {"installId":"&lt;uuid v4&gt;"}. Exclusive create; a lost race re-reads. Never throws.
    /// </summary>
    private static string InstallId() => _installId ??= ReadOrCreateInstallId();

    private static string ReadOrCreateInstallId() {
        try {
            var path = Path.Combine(ProductRoot, "state", "install.json");
            string? Read() {
                try {
                    return File.Exists(path) ? JObject.Parse(File.ReadAllText(path))["installId"]?.ToString() : null;
                } catch {
                    return null;
                }
            }
            var existing = Read();
            if (!string.IsNullOrEmpty(existing)) return existing;
            Directory.CreateDirectory(Path.GetDirectoryName(path)!);
            var id = Guid.NewGuid().ToString();
            try {
                using var stream = new FileStream(path, FileMode.CreateNew, FileAccess.Write, FileShare.Read);
                var bytes = new UTF8Encoding(false).GetBytes(new JObject { ["installId"] = id }.ToString(Formatting.None));
                stream.Write(bytes, 0, bytes.Length);
                return id;
            } catch {
                var raced = Read();
                return string.IsNullOrEmpty(raced) ? "unknown" : raced;
            }
        } catch {
            return "unknown";
        }
    }

    /// <summary>Fire-and-forget event capture. Never throws, never blocks the caller.</summary>
    internal static void Capture(string eventName, Dictionary<string, object?> properties) {
        if (_apiKey == null) return;
        try {
            // Every event names what sent it (mirrors baseProperties in analytics.ts).
            properties["machine"] = Environment.MachineName;
            properties.TryAdd("component", "revit");
            properties["version"] = AppVersion;
            properties["lane"] = HostEndpoint.ConfiguredLane ?? "unknown";
            properties["install_id"] = InstallId();
            if (CurrentDocumentTitle != null) properties["doc_title"] = CurrentDocumentTitle;
            var body = JsonConvert.SerializeObject(new {
                api_key = _apiKey,
                @event = eventName,
                distinct_id = $"{Environment.MachineName}\\{Environment.UserName}",
                timestamp = DateTimeOffset.UtcNow.ToString("o"),
                properties,
            });
            _ = Http.PostAsync($"{_host}/i/v0/e/",
                new StringContent(body, Encoding.UTF8, "application/json"));
        } catch {
            // Swallow: telemetry is best-effort.
        }
    }

    /// <summary>
    ///     An installed add-in beside a host of another version is the stale-host install defect
    ///     (host ledger 2026-10-12: a 0.7.0 host survived two upgrades under a 0.7.17 add-in). The
    ///     host's service file carries the version it booted with; one event per differing version.
    /// </summary>
    internal static void ReportHostVersion() {
        try {
            var host = PeServiceDiscovery.TryDiscover(ProductRuntimeLayout.ForCurrentUser().RootPath, HostEndpoint.ServiceName)?.Version;
            if (host == null || host == AppVersion || host == _reportedHostVersion) return;
            _reportedHostVersion = host;
            Log.Warning("Installed host {HostVersion} does not match add-in {AppVersion}.", host, AppVersion);
            Capture("version_mismatch", new Dictionary<string, object?> { ["host_version"] = host });
        } catch {
            // Telemetry is best-effort.
        }
    }

    internal static void CaptureException(Exception exception, string source) {
        Capture("$exception", new Dictionary<string, object?> {
            ["component"] = "revit",
            ["source"] = source,
            ["$exception_list"] = new[] {
                new {
                    type = exception.GetType().Name,
                    value = Truncate(exception.Message),
                    mechanism = new { handled = true, synthetic = false },
                    stacktrace = new { type = "raw", frames = Array.Empty<object>() },
                },
            },
            ["$exception_stack_trace_raw"] = Truncate(exception.ToString()),
        });
    }

    internal static string Truncate(string value) =>
        value.Length <= PayloadBudget ? value : value.Substring(0, PayloadBudget);
}

/// <summary>Ships Error/Fatal log events (with exceptions) to PostHog error tracking.</summary>
internal sealed class PostHogExceptionSink : ILogEventSink {
    public void Emit(LogEvent logEvent) {
        if (logEvent.Level < LogEventLevel.Error || logEvent.Exception == null) return;
        PostHogAnalytics.CaptureException(logEvent.Exception, logEvent.RenderMessage());
    }
}
