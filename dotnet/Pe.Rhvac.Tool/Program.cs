using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using Pe.Shared.Rhvac;

namespace Pe.Rhvac.Tool;

internal static class Program {
    public static int Main(string[] args) {
        try {
            if (args.Length == 0) throw new ArgumentException("Use inspect, compare, serve or selftest.");
            string Option(string name) { var index = Array.IndexOf(args, name); if (index < 0 || index + 1 >= args.Length) throw new ArgumentException("Missing " + name); return args[index + 1]; }
            if (args[0] == "selftest") { SelfTest.Run(); return 0; }
            if (args[0] == "serve") { LocalServer.Run(Option("--root"), int.Parse(Option("--port"))); return 0; }
            var inputPath = Option("--input"); var outputPath = Option("--output");
            var inputBytes = File.ReadAllBytes(inputPath); var request = ParseObject(System.Text.Encoding.UTF8.GetString(inputBytes).TrimStart('\uFEFF'));
            if (args[0] == "compare") {
                // The comparison JSON keeps its UI contract; its exact consumed input is a sidecar in the output set.
                Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(outputPath))!);
                File.WriteAllBytes(outputPath + ".input.json", inputBytes);
            }
            var result = args[0] switch {
                "inspect" => SnapshotReader.Read((string?)request["filePath"] ?? throw new ArgumentException("filePath required.")),
                "compare" => Compare(request),
                _ => throw new ArgumentException("Unknown command.")
            };
            AtomicWrite(outputPath, result); return 0;
        } catch (Exception e) { Console.Error.WriteLine(new JObject { ["error"] = e.Message }.ToString(Formatting.None)); return 1; }
    }
    internal static JObject Compare(JObject request) => Comparison.Compare(RequiredObject(request, "before"), RequiredObject(request, "after"), RequiredObject(request, "registry"));
    internal static JObject RequiredObject(JObject request, string field) => request[field] as JObject ?? throw new ArgumentException(field + " object required.");
    internal static JObject ParseObject(string json) => JObject.Parse(json, new JsonLoadSettings { DuplicatePropertyNameHandling = DuplicatePropertyNameHandling.Error });
    internal static JObject ReadObject(string path) => ParseObject(File.ReadAllText(path));
    internal static void AtomicWrite(string path, JToken value) {
        path = Path.GetFullPath(path); Directory.CreateDirectory(Path.GetDirectoryName(path)!); var temp = path + "." + Guid.NewGuid().ToString("N") + ".tmp";
        try { File.WriteAllText(temp, value.ToString(Formatting.None)); File.Move(temp, path, true); }
        finally { if (File.Exists(temp)) File.Delete(temp); }
    }
}
