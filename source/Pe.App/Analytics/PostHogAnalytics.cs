using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using Serilog.Core;
using Serilog.Events;
using System.IO;
using System.Net.Http;
using System.Text;

namespace Pe.App.Analytics;

/// <summary>
///     PostHog usage analytics for the internal beta. Configured via
///     Documents\Pe.Tools\settings\Global\settings.json:
///     { "posthog": { "apiKey": "phc_...", "host": "https://us.i.posthog.com" } }
///     No key → every call is a no-op. The key is a public write-only ingest key.
///     Mirrors source/pe-tools/packages/runtime/src/analytics.ts (event shapes must match).
/// </summary>
internal static class PostHogAnalytics {
    // ponytail: char cap, not bytes — close enough for a truncation signal.
    private const int PayloadBudget = 256 * 1024;

    private static readonly HttpClient Http = new() { Timeout = TimeSpan.FromSeconds(10) };
    private static string? _apiKey;
    private static string _host = "https://us.i.posthog.com";

    /// <summary>Set from the document tracker so events carry the active model's title.</summary>
    internal static string? CurrentDocumentTitle { get; set; }

    internal static bool Enabled => _apiKey != null;

    internal static void Initialize() {
        try {
            // Installed product manifest is AUTHORITATIVE (the key rides the release, so
            // installed machines need zero settings seeding); Documents settings.json stays
            // the dev/override fallback. Mirrors analytics.ts — resolution order must match.
            var manifest = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "Positive Energy", "Pe.Tools", "product.payloads.json");
            if (!TryAdopt(manifest, root => root["telemetry"]?["posthog"])) {
                var settings = Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments),
                    "Pe.Tools", "settings", "Global", "settings.json");
                TryAdopt(settings, root => root["posthog"]);
            }
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

    /// <summary>Fire-and-forget event capture. Never throws, never blocks the caller.</summary>
    internal static void Capture(string eventName, Dictionary<string, object?> properties) {
        if (_apiKey == null) return;
        try {
            properties["machine"] = Environment.MachineName;
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
