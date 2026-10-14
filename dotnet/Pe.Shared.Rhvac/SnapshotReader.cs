using Pe.Shared.Product;
using System.Diagnostics;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using Newtonsoft.Json.Linq;

namespace Pe.Shared.Rhvac;

public static class SnapshotReader {
    public const int MaxSourceBytes = 32 * 1024 * 1024;
    public static string Hash(byte[] bytes) { using var hash = SHA256.Create(); return string.Concat(hash.ComputeHash(bytes).Select(x => x.ToString("x2"))); }
    public static JObject Read(string path) {
        var extension = Path.GetExtension(path).ToLowerInvariant();
        if (extension != ".rh9" && extension != ".rh10" && extension != ".r10") throw new ArgumentException("Expected .rh9, .rh10 or .r10.");
        var info = new FileInfo(path);
        if (info.Length > MaxSourceBytes) throw new ArgumentException("Source exceeds 32 MiB.");
        return ReadBytes(info.Name, File.ReadAllBytes(info.FullName));
    }
    public static JObject ReadBytes(string fileName, byte[] bytes) {
        if (bytes.Length > MaxSourceBytes) throw new ArgumentException("Source exceeds 32 MiB.");
        var extension = Path.GetExtension(fileName).ToLowerInvariant();
        if (extension != ".rh9" && extension != ".rh10" && extension != ".r10") throw new ArgumentException("Expected .rh9, .rh10 or .r10.");
        // Capture the original before the driver is invoked. The driver only sees an owned copy.
        bytes = (byte[])bytes.Clone();
        var source = new JObject { ["fileName"] = Path.GetFileName(fileName), ["sha256"] = Hash(bytes), ["bytesBase64"] = Convert.ToBase64String(bytes) };
        var temp = Path.Combine(ProductRuntimeLayout.ForCurrentUser().ScratchPath, "pe-rhvac-" + Guid.NewGuid().ToString("N")); Directory.CreateDirectory(temp);
        try {
            var script = Path.Combine(temp, "ReadJet.ps1");
            using (var stream = typeof(SnapshotReader).GetTypeInfo().Assembly.GetManifestResourceStream("Pe.Shared.Rhvac.ReadJet.ps1") ?? throw new InvalidOperationException("Jet reader resource missing."))
            using (var output = File.Create(script)) stream.CopyTo(output);
            var diagnostics = new JArray(); var embedded = new JArray();
            var raw = ReadJet(bytes, temp, script);
            var decoded = DecodeTables(raw, temp, script, diagnostics, embedded, null, 0);
            foreach (var required in new[] { "Room", "System", "Project" }) if (raw[required] == null) diagnostics.Add(ValueCodec.Diagnostic("missing-table", "Required user table not found: " + required));
            return new JObject { ["schemaVersion"] = 1, ["source"] = source, ["tables"] = decoded, ["rawTables"] = raw, ["embedded"] = embedded, ["diagnostics"] = diagnostics };
        } finally { Directory.Delete(temp, true); }
    }
    private static JObject ReadJet(byte[] bytes, string temp, string script) {
        if (bytes.Length > MaxSourceBytes) throw new ArgumentException("Embedded database exceeds 32 MiB.");
        var name = Guid.NewGuid().ToString("N"); var input = Path.Combine(temp, name + ".mdb"); var output = Path.Combine(temp, name + ".json");
        File.WriteAllBytes(input, bytes);
        var executable = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Windows), "SysWOW64", "WindowsPowerShell", "v1.0", "powershell.exe");
        if (!File.Exists(executable)) throw new PlatformNotSupportedException("32-bit Windows PowerShell and the Jet ODBC driver are required.");
        var start = new ProcessStartInfo(executable) { UseShellExecute = false, CreateNoWindow = true, RedirectStandardError = true, RedirectStandardOutput = true };
        // Arguments are only generated owned paths, never JSON, SQL, file names or user text.
        start.Arguments = "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File " + Quote(script) + " -InputPath " + Quote(input) + " -OutputPath " + Quote(output);
        using var process = Process.Start(start) ?? throw new InvalidOperationException("Could not start Jet reader.");
        var error = process.StandardError.ReadToEndAsync(); var stdout = process.StandardOutput.ReadToEndAsync();
        if (!process.WaitForExit(60000)) { process.Kill(); process.WaitForExit(); throw new TimeoutException("32-bit Jet reader exceeded 60 seconds."); }
        if (process.ExitCode != 0) throw new InvalidOperationException("Jet reader failed: " + error.GetAwaiter().GetResult());
        stdout.GetAwaiter().GetResult();
        return JObject.Parse(File.ReadAllText(output));
    }
    private static string Quote(string generatedPath) => "\"" + generatedPath.Replace("\"", "\\\"") + "\"";
    private static bool IsJet(byte[] bytes) => bytes.Length >= 19 && Encoding.ASCII.GetString(bytes, 4, 15) == "Standard Jet DB";
    private static JObject DecodeTables(JObject raw, string temp, string script, JArray diagnostics, JArray embedded, string? parent, int depth, string? rootTable = null, int? rootNumber = null) {
        var decoded = (JObject)raw.DeepClone();
        foreach (var table in decoded.Properties()) {
            var rows = (JArray)table.Value["rows"]!;
            for (var index = 0; index < rows.Count; index++) {
                var row = (JObject)rows[index];
                foreach (var field in row.Properties().ToArray()) {
                    if (field.Value is not JObject binary || binary["binary"]?.Type != JTokenType.String) continue;
                    var bytes = Convert.FromBase64String((string)binary["binary"]!);
                    if (IsJet(bytes)) {
                        var location = parent == null ? field.Name : parent + "/" + table.Name + "/" + index + "/" + field.Name;
                        try {
                            if (depth >= 4) throw new InvalidOperationException("Embedded database recursion exceeds four levels.");
                            var nestedRaw = ReadJet(bytes, temp, script);
                            var owningTable = rootTable ?? table.Name; var owningNumber = rootNumber ?? (int?)row["Number"] ?? index;
                            var nested = DecodeTables(nestedRaw, temp, script, diagnostics, embedded, location, depth + 1, owningTable, owningNumber);
                            embedded.Add(new JObject { ["table"] = owningTable, ["recordNumber"] = owningNumber, ["column"] = location, ["tables"] = nested });
                        } catch (Exception e) { var diagnostic = ValueCodec.Diagnostic("unsupported-blob", e.Message); diagnostic["table"] = table.Name; diagnostic["column"] = location; diagnostic["recordNumber"] = row["Number"] ?? new JValue(index); diagnostics.Add(diagnostic); }
                        continue;
                    }
                    var result = ValueCodec.Decode(bytes); field.Value = result.Value;
                    foreach (var item in result.Diagnostics) { item["table"] = table.Name; item["column"] = field.Name; item["recordNumber"] = row["Number"] ?? new JValue(index); diagnostics.Add(item); }
                }
            }
        }
        return decoded;
    }
}
