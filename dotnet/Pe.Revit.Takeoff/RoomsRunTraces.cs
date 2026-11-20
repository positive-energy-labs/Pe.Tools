using System.Security.Cryptography;
using Newtonsoft.Json;
using Pe.Shared.StorageRuntime;
using Newtonsoft.Json.Linq;
using Serilog;

namespace Pe.Revit.Takeoff;

internal sealed record RoomsTraceRun(string View, string RunId, string Attempt, int Zones);

internal static class RoomsRunTraces
{
    private const string PendingPrefix = ".pending-";

    internal const string OriginalUnavailable = "original not on this machine";
    internal static readonly AsyncLocal<string?> RootOverride = new();
    internal static string Root => RootOverride.Value ?? new ModuleStorage("rooms").State().DirectoryPath;

    // Create-only evidence. Its digest in a committed region row is the authority to read it.
    internal static string KeepOriginal(string root, string document, string json)
    {
        var digest = Hash(json);
        var path = OriginalPath(root, document, digest);
        while (true)
        {
            if (File.Exists(path))
            {
                if (File.ReadAllText(path) == json) break;
                try { File.Move(path, path + ".damaged-" + Guid.NewGuid().ToString("N")); }
                catch (FileNotFoundException) { }
            }
            try { StoredFile.WriteAtomic(path, Encoding.UTF8.GetBytes(json)); }
            catch (IOException) when (File.Exists(path)) { }
        }
        return digest;
    }

    internal static Pe.Revit.Partition.Room? ReadOriginal(string root, string document, string digest)
    {
        if (digest.Length != 64 || digest.Any(c => !Uri.IsHexDigit(c))) return null;
        var path = OriginalPath(root, document, digest);
        if (!File.Exists(path)) return null;
        try
        {
            var json = File.ReadAllText(path);
            return Hash(json) == digest ? JsonConvert.DeserializeObject<Pe.Revit.Partition.Room>(json) : null;
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or JsonException)
        {
            Log.Warning(ex, "Could not read Rooms solver original {Digest}", digest);
            return null;
        }
    }

    private static string OriginalPath(string root, string document, string digest) =>
        Path.Combine(root, Hash(document), "originals", digest + ".json");

    internal static string Hash(string value)
    {
        using var sha = SHA256.Create();
        return BitConverter.ToString(sha.ComputeHash(Encoding.UTF8.GetBytes(value))).Replace("-", "").ToLowerInvariant();
    }

    internal static string Folder(string root, string document, string view, string runId) =>
        Path.Combine(root, Hash(document), Hash(view), Hash(runId));

    internal static IReadOnlyList<FileInfo> Find(
        string root, string document, string view, string runId, RoomsTraceRun? committed)
    {
        if (committed == null || committed.View != view || committed.RunId != runId || committed.Zones == 0
            || !Guid.TryParseExact(committed.Attempt, "N", out _))
            return [];
        var folder = Folder(root, document, view, runId);
        var destination = Path.Combine(folder, committed.Attempt);
        Promote(folder, committed.Attempt);
        if (!Directory.Exists(destination)) return [];
        var files = Files(destination);
        return files.Count == committed.Zones ? files : [];
    }

    private static List<FileInfo> Files(string folder) => new DirectoryInfo(folder)
        .EnumerateFiles("*.json").OrderBy(file => file.Name, StringComparer.Ordinal).ToList();

    private static void Promote(string folder, string attempt)
    {
        var from = Path.Combine(folder, PendingPrefix + attempt);
        var to = Path.Combine(folder, attempt);
        if (!Directory.Exists(from) || Directory.Exists(to)) return;
        try { Directory.Move(from, to); }
        catch (IOException) when (Directory.Exists(to) && !Directory.Exists(from)) { }
    }

    internal sealed class Pending(string root, string document, string view, string runId) : IDisposable
    {
        private readonly string _folder = Folder(root, document, view, runId);
        private readonly string _attempt = Guid.NewGuid().ToString("N");
        private int _zones;
        private bool _committed;

        private string Staged => Path.Combine(this._folder, PendingPrefix + this._attempt);

        internal RoomsTraceRun Reference => new(view, runId, this._attempt, this._zones);

        internal void Write(string zone, JObject trace)
        {
            Directory.CreateDirectory(this.Staged);
            trace["runId"] = runId;
            File.WriteAllText(Path.Combine(this.Staged, Hash(zone) + ".json"), trace.ToString(Newtonsoft.Json.Formatting.None));
            this._zones++;
        }

        internal void MarkCommitted() => this._committed = true;

        internal void Publish()
        {
            if (!this._committed) throw new InvalidOperationException("Only a committed Rooms run can publish its trace.");
            Promote(this._folder, this._attempt);
        }

        public void Dispose()
        {
            if (this._committed || !Directory.Exists(this.Staged)) return;
            try { Directory.Delete(this.Staged, true); }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
            {
                Log.Warning(ex, "Could not discard unpublished rooms traces for {RunId}", runId);
            }
        }
    }
}
