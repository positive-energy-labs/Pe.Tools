using System.Text.Json;
using System.Text.RegularExpressions;

namespace Pe.Host.Tray;

/**
 * Where the window was when its host went away, so an update reopens the app where the person was.
 * The tray dies with its host and the successor host starts a new one: the old tray writes the route
 * it was showing, the new one takes it once, within the time an update takes. Nothing else reads it.
 */
internal static class TrayResume {
    internal static readonly TimeSpan MaxAge = TimeSpan.FromMinutes(5);
    private sealed record Memory(string Route, DateTimeOffset SavedAtUtc);

    internal static void Save(string path, string route, DateTimeOffset now) {
        try {
            Directory.CreateDirectory(Path.GetDirectoryName(path)!);
            File.WriteAllText(path, JsonSerializer.Serialize(new Memory(route, now)));
        } catch (Exception error) when (error is IOException or UnauthorizedAccessException) { }
    }

    /** The saved route when it is fresh and a canonical window path; the file is consumed either way. */
    internal static string? Take(string path, DateTimeOffset now) {
        try {
            if (!File.Exists(path)) return null;
            var memory = JsonSerializer.Deserialize<Memory>(File.ReadAllText(path), new JsonSerializerOptions(JsonSerializerDefaults.Web));
            File.Delete(path);
            return memory is { Route: { } route } && now - memory.SavedAtUtc is { } age && age >= TimeSpan.Zero && age <= MaxAge
                && TrayLaunch.IsCanonicalRoute(route) ? route : null;
        } catch (Exception error) when (error is IOException or UnauthorizedAccessException or JsonException) {
            return null;
        }
    }

    /** The window's page as a route: the shell marker the tray itself adds is not where the person was. */
    internal static string RouteOf(Uri source) {
        var query = Regex.Replace(source.Query, @"(?<=[?&])shell=tray(&|$)", "").TrimEnd('&');
        return source.AbsolutePath + (query is "" or "?" ? "" : query) + source.Fragment;
    }
}
