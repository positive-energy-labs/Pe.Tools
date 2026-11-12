using System.Security.Cryptography;
using Newtonsoft.Json.Linq;

namespace Pe.Revit.Takeoff;

/// <summary>
///     Where one rooms.partition run keeps its zone traces: <c>&lt;state&gt;/rooms/&lt;sha256(runId)&gt;/&lt;zoneGuid:N&gt;.json</c>.
///     The folder is the id's hash, so any id is a folder name: a run id is an action admission id and may carry
///     <c>:</c> or <c>%</c>. The id itself rides in every trace as data.
/// </summary>
internal static class RoomsRunTraces
{
    internal static string Folder(string root, string runId)
    {
        using var sha = SHA256.Create();
        return Path.Combine(root, BitConverter.ToString(sha.ComputeHash(Encoding.UTF8.GetBytes(runId))).Replace("-", "").ToLowerInvariant());
    }

    internal static void Write(string root, string runId, string fileName, JObject trace)
    {
        trace["runId"] = runId;
        var dir = Directory.CreateDirectory(Folder(root, runId)).FullName;
        File.WriteAllText(Path.Combine(dir, fileName), trace.ToString(Newtonsoft.Json.Formatting.None));
    }

    internal static string RunId(string traceJson) =>
        (string?)JObject.Parse(traceJson)["runId"] ?? throw new InvalidOperationException("trace names no run");
}
