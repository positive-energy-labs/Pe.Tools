using System.Globalization;
using System.Text.Json;
using System.Diagnostics;
using System.Security.Cryptography;
using System.Text;

namespace Pe.Host.Tray;

internal sealed record TrayLaunch(int ParentPid, DateTimeOffset ParentStart, string ServiceFile) {
    public string? SupervisorFile { get; init; }
    public string? SourceRoot { get; init; }
    public string? SupervisorInstance { get; init; }
    public bool IsDev => SupervisorFile is not null;
    public bool ShowOnStart { get; init; }
    public string? Route { get; init; }
    public string ProfileKey => IsDev ? "dev-" + Convert.ToHexString(SHA256.HashData(
        Encoding.UTF8.GetBytes(SourceRoot!.ToLowerInvariant())))[..12].ToLowerInvariant() : "installed";

    public static TrayLaunch Parse(string[] args) {
        var show = Array.IndexOf(args, "--show");
        string? route = null;
        if (show >= 0) {
            var tail = args[show..];
            if (tail.Length == 3 && tail[1] == "--route" && IsCanonicalRoute(tail[2])) route = tail[2];
            else if (tail.Length != 1) throw new ArgumentException("Expected --show [--route <canonical path>].");
            args = args[..show];
        }
        var launch = ParseOwner(args);
        return launch with { ShowOnStart = launch.ShowOnStart || show >= 0, Route = route };
    }

    internal static bool IsCanonicalRoute(string route) => route.StartsWith('/') && !route.StartsWith("//")
        && !route.Contains('\\') && !route.Any(char.IsControl)
        && TrayContext.TryGetWindowUrl("http://127.0.0.1" + route, "http://127.0.0.1", out var canonical)
        && canonical == "http://127.0.0.1" + route;

    private static TrayLaunch ParseOwner(string[] args) {
        if (args.Length == 3 && args[0] == "--dev" && args[1] == "--supervisor-file"
            && Path.IsPathFullyQualified(args[2])) {
            using var json = JsonDocument.Parse(File.ReadAllText(args[2]));
            var root = json.RootElement;
            var source = Path.GetFullPath(root.GetProperty("sourceRoot").GetString()!);
            if (root.GetProperty("schemaVersion").GetInt32() != 1
                || !File.Exists(Path.Combine(source, "Pe.Tools.slnx"))
                || !Path.GetFullPath(args[2]).Equals(Path.Combine(source, ".artifacts", "dev-tray", "supervisor.json"),
                    StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("Invalid dev supervisor checkout.");
            return new TrayLaunch(root.GetProperty("pid").GetInt32(),
                ParseStart(root.GetProperty("processStartUtc").GetString()!), "") {
                SupervisorFile = args[2], SourceRoot = source,
                SupervisorInstance = root.GetProperty("instanceId").GetString(),
                ShowOnStart = root.TryGetProperty("showWindow", out var show) && show.GetBoolean()
            };
        }
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
        if (IsDev) return ReadDevService();
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

    private ServiceRecord ReadDevService() {
        using var supervisor = JsonDocument.Parse(File.ReadAllText(SupervisorFile!));
        var owner = supervisor.RootElement;
        if (owner.GetProperty("schemaVersion").GetInt32() != 1
            || owner.GetProperty("pid").GetInt32() != ParentPid
            || ParseStart(owner.GetProperty("processStartUtc").GetString()!) != ParentStart
            || owner.GetProperty("instanceId").GetString() != SupervisorInstance
            || !SameCheckout(owner.GetProperty("sourceRoot").GetString()!))
            throw new InvalidDataException("Dev supervisor changed identity.");
        using var session = JsonDocument.Parse(File.ReadAllText(Path.Combine(SourceRoot!, ".artifacts", "dev-tray", "session.json")));
        var pair = session.RootElement;
        if (pair.GetProperty("schemaVersion").GetInt32() != 1 || !SameCheckout(pair.GetProperty("sourceRoot").GetString()!))
            throw new InvalidDataException("Dev frontend belongs to another checkout.");
        using var service = JsonDocument.Parse(File.ReadAllText(pair.GetProperty("serviceFile").GetString()!));
        var host = service.RootElement;
        var frontend = pair.GetProperty("frontendOrigin").GetString()!;
        if (host.GetProperty("schemaVersion").GetInt32() != 3 || host.GetProperty("lane").GetString() != "dev"
            || !SameCheckout(host.GetProperty("sourceRoot").GetString()!)
            || host.GetProperty("instanceId").GetString() != pair.GetProperty("hostInstanceId").GetString()
            || !Alive(host.GetProperty("pid").GetInt32(), ParseStart(host.GetProperty("processStartUtc").GetString()!))
            || !Alive(pair.GetProperty("frontendPid").GetInt32(), ParseStart(pair.GetProperty("frontendStartUtc").GetString()!))
            || !Uri.TryCreate(frontend, UriKind.Absolute, out var uri) || uri.Scheme != "http"
            || uri.Host != "127.0.0.1" || uri.GetLeftPart(UriPartial.Authority) != frontend)
            throw new InvalidDataException("Dev frontend/backend pair is stale or foreign.");
        var port = host.GetProperty("port").GetInt32();
        var token = host.GetProperty("token").GetString()!;
        var health = host.GetProperty("health").GetString()!;
        if (port is < 1 or > 65535 || string.IsNullOrWhiteSpace(token) || token.Any(char.IsControl)
            || !health.StartsWith('/') || health.StartsWith("//") || health.Contains('\\'))
            throw new InvalidDataException("Invalid dev service transport.");
        return new ServiceRecord(host.GetProperty("instanceId").GetString()!, port,
            host.GetProperty("version").GetString()!, token, health) { FrontendOrigin = frontend };
    }

    private bool SameCheckout(string value) => Path.GetFullPath(value).Equals(SourceRoot, StringComparison.OrdinalIgnoreCase);
    public string? ReadShowRequest() {
        if (!IsDev) return null;
        try {
            using var json = JsonDocument.Parse(File.ReadAllText(Path.Combine(SourceRoot!, ".artifacts", "dev-tray", "show.json")));
            return json.RootElement.GetProperty("instanceId").GetString() == SupervisorInstance
                ? json.RootElement.GetProperty("nonce").GetString() : null;
        } catch (Exception error) when (error is IOException or JsonException or InvalidOperationException or KeyNotFoundException) { return null; }
    }
    private static bool Alive(int pid, DateTimeOffset start) {
        try { using var process = Process.GetProcessById(pid);
            return !process.HasExited && Math.Abs((process.StartTime.ToUniversalTime() - start.UtcDateTime).TotalMilliseconds) <= 2_000;
        } catch (ArgumentException) { return false; }
    }
}

internal sealed record ServiceRecord(string InstanceId, int Port, string Version, string Token, string Health) {
    public string Origin => $"http://127.0.0.1:{Port}";
    public string? FrontendOrigin { get; init; }
    public string ViewOrigin => FrontendOrigin ?? Origin;
}
