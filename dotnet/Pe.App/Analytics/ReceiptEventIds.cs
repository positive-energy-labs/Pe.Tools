using Newtonsoft.Json.Linq;

namespace Pe.App.Analytics;

// TS owns the schema. ReceiptEnvelopeTests validates these names against its registry.
internal static class ReceiptEventIds {
    internal const string AppBoot = "app_boot";
    internal const string VersionMismatch = "version_mismatch";
    internal const string RibbonClick = "ribbon_click";
    internal const string PaletteAction = "palette_action";
    internal const string TelemetryDropped = "telemetry_dropped";

    internal static JObject Usage(string eventId, JObject counters) => new() {
        ["kind"] = "usage", ["event"] = eventId, ["counters"] = counters,
    };

    internal static JObject Palette(ReceiptPaletteTab tab, bool? ok, ReceiptPaletteMode? mode) {
        var counters = new JObject {
            ["palette"] = "do",
            ["tab"] = tab.ToString().ToLowerInvariant(),
            ["itemKind"] = tab switch {
                ReceiptPaletteTab.Commands => "command", ReceiptPaletteTab.Tasks => "task", _ => "script",
            },
        };
        // PostCommand only queues intent; scripts have not run yet. Neither certifies execution success.
        if (ok.HasValue && tab != ReceiptPaletteTab.Scripts)
            counters["outcome"] = !ok.Value ? "failed" : tab == ReceiptPaletteTab.Commands ? "incomplete" : "succeeded";
        if (mode.HasValue) counters["mode"] = mode == ReceiptPaletteMode.ReadOnly ? "read-only" : "write";
        return Usage(PaletteAction, counters);
    }

    internal static JObject Producer(JObject body, JObject emitter, string? requestId = null) => new() {
        ["schema"] = 1, ["id"] = Guid.NewGuid().ToString(), ["at"] = DateTime.UtcNow.ToString("o"),
        ["join"] = new JObject { ["requestId"] = Guid.TryParse(requestId, out var id) ? id.ToString() : Guid.NewGuid().ToString() },
        ["body"] = body, ["emitter"] = emitter,
    };
}

internal enum ReceiptPaletteTab { Commands, Tasks, Scripts }
internal enum ReceiptPaletteMode { ReadOnly, Write }

/// <summary>No durable delivery queue. An unavailable host costs at most 64 pending facts.</summary>
internal sealed class NativeReceiptBuffer {
    private readonly Queue<JObject> _pending = new();
    private readonly object _gate = new();
    private long _dropped;
    private JObject? _dropFact;

    internal void Enqueue(JObject fact) {
        lock (this._gate) {
            if (this._pending.Count == 64) {
                this._pending.Dequeue();
                this._dropped++;
            }
            this._pending.Enqueue(fact);
        }
    }

    internal JObject? Peek() {
        lock (this._gate) {
            if (this._pending.Count == 0) return null;
            if (this._dropped == 0) return this._pending.Peek();
            var next = this._pending.Peek();
            return this._dropFact ??= ReceiptEventIds.Producer(ReceiptEventIds.Usage(ReceiptEventIds.TelemetryDropped,
                new JObject { ["producer"] = "revit", ["count"] = this._dropped }), (JObject)next["emitter"]!.DeepClone());
        }
    }

    internal void Delivered(JObject fact) {
        lock (this._gate) {
            if (ReferenceEquals(fact, this._dropFact)) {
                this._dropped = Math.Max(0, this._dropped - (long)fact["body"]!["counters"]!["count"]!);
                this._dropFact = null;
            }
            else if (this._pending.Count > 0 && ReferenceEquals(this._pending.Peek(), fact))
                this._pending.Dequeue();
        }
    }
}
