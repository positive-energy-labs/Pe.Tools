using System.Text.Json;

namespace Pe.Host.Tray;

/**
 * Notices wait for a page that can show them. The card says `notice-ready` once it listens; until
 * then every notice is held, and dedupe (`id:revision`, against the host's one-minute replay on each
 * connect) happens on delivery, never on arrival, so nothing that came early is lost.
 */
internal sealed class NoticeInbox {
    private const int Bound = 64;
    private readonly object _gate = new();
    private readonly List<(string Key, string Json)> _held = new();
    private readonly Queue<string> _shownOrder = new();
    private readonly HashSet<string> _shown = new();
    private bool _ready;

    /** Hands each `data:` line of the host's SSE feed to `receive` until the feed ends. */
    public static async Task ReadFeedAsync(Stream feed, Action<string> receive, CancellationToken token) {
        using var reader = new StreamReader(feed);
        while (await reader.ReadLineAsync(token) is { } line)
            if (line.StartsWith("data: ", StringComparison.Ordinal)) receive(line[6..]);
    }

    /** The notices to hand the page now: none while no page listens. */
    public IReadOnlyList<string> Receive(string json) {
        // Parsed first, so only a JSON value ever reaches the page as script.
        if (!TryRead(json, out var notice)) return [];
        lock (_gate) {
            if (_ready) return Deliver([notice]);
            if (_held.Count == Bound) _held.RemoveAt(0);
            _held.Add(notice);
            return [];
        }
    }

    public IReadOnlyList<string> PageReady() {
        lock (_gate) {
            _ready = true;
            var held = _held.ToList();
            _held.Clear();
            return Deliver(held);
        }
    }

    /** A document navigation: the next page must say it listens before it is handed anything. */
    public void PageGone() {
        lock (_gate) _ready = false;
    }

    private List<string> Deliver(IEnumerable<(string Key, string Json)> notices) {
        var shown = new List<string>();
        foreach (var (key, json) in notices) {
            if (!_shown.Add(key)) continue;
            _shownOrder.Enqueue(key);
            if (_shownOrder.Count > Bound) _shown.Remove(_shownOrder.Dequeue());
            shown.Add(json);
        }
        return shown;
    }

    private static bool TryRead(string json, out (string Key, string Json) notice) {
        notice = default;
        try {
            using var document = JsonDocument.Parse(json);
            var root = document.RootElement;
            if (root.ValueKind != JsonValueKind.Object
                || !root.TryGetProperty("id", out var id) || id.ValueKind != JsonValueKind.String
                || !root.TryGetProperty("revision", out var revision) || !revision.TryGetInt32(out var number)) return false;
            notice = (id.GetString() + ":" + number, root.GetRawText());
            return true;
        } catch (Exception error) when (error is JsonException or InvalidOperationException or FormatException) {
            return false;
        }
    }
}
