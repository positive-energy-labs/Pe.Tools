using System.Globalization;
using System.Text.Json;

namespace Pe.Host.Tray;

internal sealed record TrayLaunch(int ParentPid, DateTimeOffset ParentStart, string ServiceFile) {
    public static TrayLaunch Parse(string[] args) {
        if (args.Length != 6 || args[0] != "--parent-pid" || args[2] != "--parent-start" || args[4] != "--service-file"
            || !int.TryParse(args[1], out var pid) || pid <= 0 || !Path.IsPathFullyQualified(args[5]))
            throw new ArgumentException("Expected --parent-pid <pid> --parent-start <iso> --service-file <absolute path>.");
        return new TrayLaunch(pid, ParseStart(args[3]), args[5]);
    }

    internal static DateTimeOffset ParseStart(string value) =>
        DateTimeOffset.ParseExact(value, "yyyy-MM-dd'T'HH:mm:ss.FFFFFFFK", CultureInfo.InvariantCulture,
            DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal);

    // The SDK records Node's uptime-derived start, and uses the same 2-second OS-start tolerance.
    public bool MatchesParent(int pid, DateTimeOffset start) =>
        pid == ParentPid && Math.Abs((start - ParentStart).TotalMilliseconds) <= 2_000;

    public ServiceRecord ReadService() {
        using var json = JsonDocument.Parse(File.ReadAllText(ServiceFile));
        var root = json.RootElement;
        string Required(string name) {
            var text = root.GetProperty(name).GetString();
            if (string.IsNullOrWhiteSpace(text) || text.Any(char.IsControl))
                throw new InvalidDataException($"Invalid service {name}.");
            return text;
        }
        var start = ParseStart(Required("processStartUtc"));
        var port = root.GetProperty("port").GetInt32();
        var health = Required("health");
        if (root.GetProperty("schemaVersion").GetInt32() != 3 || root.GetProperty("pid").GetInt32() != ParentPid
            || start != ParentStart || port is < 1 or > 65535 || Required("lane") != "installed"
            || !health.StartsWith('/') || health.StartsWith("//") || health.Contains('\\'))
            throw new InvalidDataException("The service file does not name this installed parent incarnation.");
        return new ServiceRecord(Required("instanceId"), port, Required("version"), Required("token"), health);
    }
}

internal sealed record ServiceRecord(string InstanceId, int Port, string Version, string Token, string Health) {
    public string Origin => $"http://127.0.0.1:{Port}";
}
