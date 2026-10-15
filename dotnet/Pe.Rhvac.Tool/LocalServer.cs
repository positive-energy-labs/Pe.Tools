using System.Net;
using System.Net.Sockets;
using System.Security.Cryptography;
using System.Text;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using Pe.Shared.Rhvac;

namespace Pe.Rhvac.Tool;

internal static class LocalServer {
    private const int MaxPayload = 64 * 1024 * 1024;
    public static void Run(string root, int port) {
        root = Path.GetFullPath(root); Directory.CreateDirectory(root);
        if (port < 0 || port > 65535) throw new ArgumentException("Invalid port.");
        if (port == 0) { var probe = new TcpListener(IPAddress.Loopback, 0); probe.Start(); port = ((IPEndPoint)probe.LocalEndpoint).Port; probe.Stop(); }
        var token = Convert.ToHexString(RandomNumberGenerator.GetBytes(32)); var url = "http://127.0.0.1:" + port;
        var receipt = new JObject { ["url"] = url, ["token"] = token };
        using var listener = new HttpListener(); listener.Prefixes.Add(url + "/"); listener.Start();
        Program.AtomicWrite(Path.Combine(root, "pages", "compare", "runtime.json"), receipt);
        Console.WriteLine(receipt.ToString(Formatting.None)); Console.Out.Flush();
        Console.CancelKeyPress += (_, e) => { e.Cancel = true; listener.Stop(); };
        try { while (listener.IsListening) { var context = listener.GetContext(); Handle(context, root, token, receipt); } }
        catch (HttpListenerException) when (!listener.IsListening) { }
        finally { listener.Stop(); }
    }
    private static void Handle(HttpListenerContext context, string root, string token, JObject receipt) {
        var request = context.Request; var response = context.Response;
        try {
            if (request.Url!.Host != "127.0.0.1" && request.Url.Host != "localhost") throw new ArgumentException("Host must be loopback.");
            var origin = request.Headers["Origin"];
            if (origin != null) {
                if (!Uri.TryCreate(origin, UriKind.Absolute, out var parsed) || parsed.Scheme != "http" || parsed.Host != "127.0.0.1" && parsed.Host != "localhost" || parsed.AbsolutePath != "/") throw new ArgumentException("Origin must be loopback HTTP.");
                response.Headers["Access-Control-Allow-Origin"] = origin; response.Headers["Vary"] = "Origin";
                response.Headers["Access-Control-Allow-Headers"] = "Authorization, Content-Type"; response.Headers["Access-Control-Allow-Methods"] = "GET, POST, PUT, OPTIONS";
            }
            if (request.HttpMethod == "OPTIONS") { response.StatusCode = 204; return; }
            var path = request.Url!.AbsolutePath;
            if (request.HttpMethod == "GET" && path == "/runtime.json") { Json(response, receipt); return; }
            if (path == "/inspect" || path == "/compare" || path == "/registry" || path == "/snapshots") {
                if (request.Headers["Authorization"] != "Bearer " + token) { response.StatusCode = 401; Json(response, new JObject { ["error"] = "Bearer token required." }); return; }
                var registryPath = Path.Combine(root, "registry.json"); var dataPath = Path.Combine(root, "data");
                if (path == "/registry" && request.HttpMethod == "GET") { Json(response, File.Exists(registryPath) ? Program.ReadObject(registryPath) : Comparison.EmptyRegistry()); return; }
                if (path == "/snapshots" && request.HttpMethod == "GET") { Json(response, new JArray(LoadSnapshots(dataPath))); return; }
                if (path == "/registry" && request.HttpMethod == "PUT") {
                    var registry = Body(request); Comparison.ValidateRegistry(registry, LoadSnapshots(dataPath)); Program.AtomicWrite(registryPath, registry); Json(response, registry); return;
                }
                if (path == "/inspect" && request.HttpMethod == "POST") {
                    var body = Body(request); var name = (string?)body["fileName"] ?? throw new ArgumentException("fileName required.");
                    var bytes = Convert.FromBase64String((string?)body["bytesBase64"] ?? throw new ArgumentException("bytesBase64 required."));
                    var snapshot = SnapshotReader.ReadBytes(name, bytes); Program.AtomicWrite(Path.Combine(dataPath, (string)snapshot["source"]!["sha256"]! + ".json"), snapshot); Json(response, snapshot); return;
                }
                if (path == "/compare" && request.HttpMethod == "POST") {
                    var body = Body(request); var result = Program.Compare(body);
                    foreach (var field in new[] { "before", "after" }) { var snapshot = Program.RequiredObject(body, field); Program.AtomicWrite(Path.Combine(dataPath, (string)snapshot["source"]!["sha256"]! + ".json"), snapshot); }
                    Json(response, result); return;
                }
                throw new ArgumentException("Unsupported API method.");
            }
            if (request.HttpMethod != "GET") throw new ArgumentException("Unsupported method.");
            var page = Path.GetFullPath(Path.Combine(root, "pages", "compare"));
            string relative;
            if (path == "/") relative = "index.html";
            else if (path.StartsWith("/pages/compare/", StringComparison.Ordinal)) relative = Uri.UnescapeDataString(path.Substring("/pages/compare/".Length));
            else { response.StatusCode = 404; Json(response, new JObject { ["error"] = "Not found." }); return; }
            if (relative.IndexOfAny(new[] { '\\', ':', '\0' }) >= 0 || relative.Split('/').Any(s => s == ".." || s == ".")) throw new ArgumentException("Invalid page path.");
            var file = Path.GetFullPath(Path.Combine(page, relative));
            if (!file.StartsWith(page + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase) || !File.Exists(file)) { response.StatusCode = 404; Json(response, new JObject { ["error"] = "Page asset not found." }); return; }
            for (var current = new FileInfo(file) as FileSystemInfo; current != null && current.FullName.Length >= page.Length; current = current is FileInfo fi ? fi.Directory : ((DirectoryInfo)current).Parent)
                if ((current.Attributes & FileAttributes.ReparsePoint) != 0) throw new ArgumentException("Page symlinks are not served.");
            response.ContentType = Path.GetExtension(file).ToLowerInvariant() switch { ".html" => "text/html; charset=utf-8", ".js" => "text/javascript; charset=utf-8", ".css" => "text/css; charset=utf-8", ".json" => "application/json", ".svg" => "image/svg+xml", ".png" => "image/png", _ => "application/octet-stream" };
            var content = File.ReadAllBytes(file); response.ContentLength64 = content.Length; response.OutputStream.Write(content);
        } catch (Exception e) { response.StatusCode = e is InvalidOperationException ? 409 : 400; Json(response, new JObject { ["error"] = e.Message }); }
        finally { response.Close(); }
    }
    private static JObject[] LoadSnapshots(string path) => Directory.Exists(path) ? Directory.GetFiles(path, "*.json").OrderBy(x => x, StringComparer.Ordinal).Select(Program.ReadObject).ToArray() : Array.Empty<JObject>();
    private static JObject Body(HttpListenerRequest request) {
        if (request.ContentLength64 > MaxPayload) throw new ArgumentException("Payload exceeds 64 MiB.");
        using var bytes = new MemoryStream(); var buffer = new byte[8192]; int read;
        while ((read = request.InputStream.Read(buffer, 0, buffer.Length)) > 0) { if (bytes.Length + read > MaxPayload) throw new ArgumentException("Payload exceeds 64 MiB."); bytes.Write(buffer, 0, read); }
        return Program.ParseObject(Encoding.UTF8.GetString(bytes.ToArray()));
    }
    private static void Json(HttpListenerResponse response, JToken value) { var bytes = Encoding.UTF8.GetBytes(value.ToString(Formatting.None)); response.ContentType = "application/json; charset=utf-8"; response.ContentLength64 = bytes.Length; response.OutputStream.Write(bytes); }
}
