using System.Collections.Concurrent;

namespace Pe.Global.Services.SignalR;

/// <summary>
///     Tracks active SignalR hub connection ids for settings-editor notifications.
/// </summary>
public static class HubConnectionTracker {
    private static readonly ConcurrentDictionary<string, byte> ActiveConnections = new(StringComparer.Ordinal);

    public static int ActiveConnectionCount => ActiveConnections.Count;
    public static bool HasActiveConnections => !ActiveConnections.IsEmpty;

    public static void Add(string? connectionId) {
        if (string.IsNullOrWhiteSpace(connectionId))
            return;
        ActiveConnections[connectionId] = 0;
    }

    public static void Remove(string? connectionId) {
        if (string.IsNullOrWhiteSpace(connectionId))
            return;
        _ = ActiveConnections.TryRemove(connectionId, out _);
    }
}
