using System.Security.Cryptography;
using Newtonsoft.Json.Linq;
using Serilog;

namespace Pe.Revit.Takeoff;

/// <summary>
///     Where one rooms.partition run keeps its zone traces: <c>&lt;state&gt;/rooms/&lt;sha256(runId)&gt;/&lt;zoneGuid:N&gt;.json</c>.
///     The folder is the id's hash, so any id is a folder name: a run id is an action admission id and may carry
///     <c>:</c> or <c>%</c>. The id itself rides in every trace as data.
/// </summary>
internal static class RoomsRunTraces
{
    private const string PendingPrefix = ".pending-";

    internal static string Folder(string root, string runId)
    {
        using var sha = SHA256.Create();
        return Path.Combine(root, BitConverter.ToString(sha.ComputeHash(Encoding.UTF8.GetBytes(runId))).Replace("-", "").ToLowerInvariant());
    }

    internal static string RunId(string traceJson) =>
        (string?)JObject.Parse(traceJson)["runId"] ?? throw new InvalidOperationException("trace names no run");

    internal static IReadOnlyList<FileInfo> Find(string root, string? runId, IReadOnlyCollection<string> zoneFiles)
    {
        var runs = runId != null ? [new DirectoryInfo(Folder(root, runId))]
            : new DirectoryInfo(root).EnumerateDirectories()
                .Where(d => !d.Name.StartsWith(PendingPrefix, StringComparison.Ordinal)).ToList();
        return runs.Where(d => d.Exists)
            .Select(d => d.EnumerateFiles("*.json").Where(f => zoneFiles.Contains(f.Name)).ToList())
            .Where(files => files.Count > 0)
            .OrderByDescending(files => files.Max(f => f.LastWriteTimeUtc))
            .FirstOrDefault() ?? [];
    }

    internal sealed class Pending(string root, string runId) : IDisposable
    {
        private string? _staged;

        internal void Write(string fileName, JObject trace)
        {
            this._staged ??= Directory.CreateDirectory(Path.Combine(root, PendingPrefix + Guid.NewGuid().ToString("N"))).FullName;
            trace["runId"] = runId;
            File.WriteAllText(Path.Combine(this._staged, fileName), trace.ToString(Newtonsoft.Json.Formatting.None));
        }

        internal void Publish()
        {
            if (this._staged is not { } staged) return;
            Directory.Move(staged, Folder(root, runId));
            this._staged = null;
        }

        public void Dispose()
        {
            if (this._staged is not { } staged) return;
            try { Directory.Delete(staged, true); }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
            {
                Log.Warning(ex, "Could not discard unpublished rooms traces for {RunId}", runId);
            }
        }
    }
}
