using System.Text.Json;

namespace Pe.Host.Tray;

/**
 * Where the tray got to in the host's `notices` Reading: the log id of the last item it handed to a
 * page, kept across restarts so a tray that was away is replayed exactly what it missed.
 */
internal static class NoticeCursor {
    internal static long? Load(string path) {
        try { return long.TryParse(File.ReadAllText(path).Trim(), out var id) && id >= 0 ? id : null; }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException) { return null; }
    }

    internal static void Save(string path, long id) {
        try {
            Directory.CreateDirectory(Path.GetDirectoryName(path)!);
            File.WriteAllText(path, id.ToString());
        } catch (Exception error) when (error is IOException or UnauthorizedAccessException) { }
    }
}

/**
 * Follows the host's `notices` Reading (SSE of Reading frames, each item carrying its log id). An item
 * waits for a page that can show it: the card says `notice-ready` once it listens, and until then every
 * item is held. `Received` is what a reconnect resumes after, so the host never repeats an item to a live
 * tray; the persisted cursor moves only when an item is handed to a page, so a crash with items held
 * replays them. A gap (first run, a lost log) moves the cursor to the log's current id and owes nothing.
 */
internal sealed class NoticeInbox {
    private const int Bound = 64;
    private readonly object _gate = new();
    private readonly Action<long> _persist;
    private readonly List<(long Id, string Json)> _held = new();
    private long? _received;
    private long? _delivered;
    private bool _ready;

    public NoticeInbox(long? cursor, Action<long> persist) {
        _received = _delivered = cursor;
        _persist = persist;
    }

    /** The log id a reconnect resumes after; none until a cursor or a gap says where the log is. */
    public long? Received { get { lock (_gate) return _received; } }

    /** The query the tray's stream opens with: the `notices` Reading as the tray, after the cursor. */
    public static string StreamQuery(long? after) =>
        "keys=" + Uri.EscapeDataString("[{\"kind\":\"notices\",\"as\":\"tray\"}]") + (after is { } id ? "&after=" + id : "");

    /** Hands each `data:` line of the host's SSE feed to `receive` until the feed ends. */
    public static async Task ReadFeedAsync(Stream feed, Action<string> receive, CancellationToken token) {
        using var reader = new StreamReader(feed);
        while (await reader.ReadLineAsync(token) is { } line)
            if (line.StartsWith("data: ", StringComparison.Ordinal)) receive(line[6..]);
    }

    /** The notices to hand the page now: none while no page listens. */
    public IReadOnlyList<string> Receive(string frame) {
        // Parsed first, so only a JSON value ever reaches the page as script.
        if (!TryRead(frame, out var id, out var notice)) return [];
        lock (_gate) {
            if (notice is null) {
                // A gap is the log's own word for where it is, even when that is behind a cursor from a lost
                // log: nothing earlier is owed. Held items stay owed; the cursor catches up when they land.
                _received = id;
                if (_held.Count == 0 && _delivered != id) { _delivered = id; _persist(id); }
                return [];
            }
            if (id <= (_received ?? -1)) return [];
            _received = id;
            if (_ready) { Advance(id); return [notice]; }
            if (_held.Count == Bound) _held.RemoveAt(0);
            _held.Add((id, notice));
            return [];
        }
    }

    public IReadOnlyList<string> PageReady() {
        lock (_gate) {
            _ready = true;
            var held = _held.ToList();
            _held.Clear();
            if (held.Count > 0) Advance(Math.Max(held[^1].Id, _received ?? 0));
            return held.Select(h => h.Json).ToList();
        }
    }

    /** A document navigation: the next page must say it listens before it is handed anything. */
    public void PageGone() {
        lock (_gate) _ready = false;
    }

    private void Advance(long id) {
        if (id <= (_delivered ?? -1)) return;
        _delivered = id;
        _persist(id);
    }

    private static bool TryRead(string frame, out long id, out string? notice) {
        id = 0; notice = null;
        try {
            using var document = JsonDocument.Parse(frame);
            var root = document.RootElement;
            if (root.ValueKind != JsonValueKind.Object
                || !root.TryGetProperty("kind", out var kind) || kind.ValueKind != JsonValueKind.String
                || !root.TryGetProperty("id", out var number) || !number.TryGetInt64(out id) || id < 0) return false;
            if (kind.GetString() == "gap") return true;
            if (kind.GetString() != "event" || !root.TryGetProperty("value", out var value)
                || !NativeAdapterContract.Accepts("notice", value) || value.ValueKind == JsonValueKind.Null) return false;
            notice = value.GetRawText();
            return true;
        } catch (Exception error) when (error is JsonException or InvalidOperationException or FormatException) {
            return false;
        }
    }
}
