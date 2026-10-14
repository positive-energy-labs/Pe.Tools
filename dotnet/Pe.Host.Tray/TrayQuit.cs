using System.Text.Json;

namespace Pe.Host.Tray;

/** Quitting the host cuts every Pea turn in flight, so the tray asks before it does. */
internal static class TrayQuit {
    /** Threads the host reports running a turn or waiting on an answer; unreadable means none to protect. */
    internal static int ActiveTurns(string threadsJson) {
        try {
            using var json = JsonDocument.Parse(threadsJson);
            if (json.RootElement.ValueKind != JsonValueKind.Array) return 0;
            return json.RootElement.EnumerateArray().Count(thread =>
                thread.TryGetProperty("activity", out var activity)
                && activity.TryGetProperty("state", out var state)
                && state.GetString() is "running" or "waiting");
        } catch (Exception error) when (error is JsonException or InvalidOperationException) {
            return 0;
        }
    }

    internal static string Question(int turns) =>
        $"{(turns == 1 ? "1 Pea turn is running" : $"{turns} Pea turns are running")}. Quitting the host stops "
        + $"{(turns == 1 ? "it" : "them")} where {(turns == 1 ? "it is" : "they are")}. Quit anyway?";
}
