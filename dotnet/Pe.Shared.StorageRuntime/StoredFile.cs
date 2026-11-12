using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using Pe.Shared.Product;
using System.Security.Cryptography;
using System.Text;
using System.Runtime.InteropServices;
using System.ComponentModel;

namespace Pe.Shared.StorageRuntime;

public enum StoredPolicy { Keep, Discard }

/// <summary>ADR 0039's C# boundary. Notices share the TS store's wire format and notice feed.</summary>
public static class StoredFile {
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool MoveFileEx(string existing, string destination, uint flags);
    private static readonly object NoticeLock = new();

    public static T? Read<T>(string path, StoredPolicy policy, string place, Func<string, T> decode, string? notices = null) {
        try { return decode(File.ReadAllText(path)); }
        catch (FileNotFoundException) { return default; }
        catch (DirectoryNotFoundException) { return default; }
        catch (Exception exception) {
            Refuse(path, policy, place, exception, notices);
            return default;
        }
    }

    public static void Refuse(string path, StoredPolicy policy, string place, Exception exception, string? notices = null) {
        Note(path, policy, place, exception, notices);
        if (policy != StoredPolicy.Discard) return;
        try { File.Delete(path); }
        catch (Exception deletion) { Note(path, policy, place, deletion); }
    }

    public static void Note(string path, StoredPolicy policy, string place, Exception exception, string? notices = null) {
        try {
            path = Path.GetFullPath(path);
            string? hash = null;
            try {
                using var sha = SHA256.Create();
                hash = BitConverter.ToString(sha.ComputeHash(File.ReadAllBytes(path))).Replace("-", "").ToLowerInvariant();
            } catch (Exception read) when (read is IOException or UnauthorizedAccessException) { }
            notices ??= Path.Combine(ProductRuntimeLayout.Current.State.RootPath, "stored-notices.jsonl");
            lock (NoticeLock) {
                if (File.Exists(notices)) {
                    foreach (var line in File.ReadLines(notices)) {
                        try {
                            var row = JObject.Parse(line);
                            if (row.Value<string>("path") == path && row.Value<string>("sha256") == hash) return;
                        } catch (JsonException) { }
                    }
                }
                Directory.CreateDirectory(Path.GetDirectoryName(notices)!);
                var reason = System.Text.RegularExpressions.Regex.Replace(exception.Message, @"\s+", " ");
                var notice = new { @class = policy == StoredPolicy.Keep ? "keep" : "discard", place, path, sha256 = hash,
                    reason = reason.Substring(0, Math.Min(reason.Length, 500)), at = DateTimeOffset.UtcNow.ToString("o") };
                File.AppendAllText(notices, JsonConvert.SerializeObject(notice) + "\n", new UTF8Encoding(false));
            }
        } catch (Exception) {
            // The notice feed cannot report its own write failure or stop a caller (ADR 0039).
        }
    }

    /// <summary>Publish complete bytes from the same directory. Create-only callers never overwrite a winner.</summary>
    public static void WriteAtomic(string path, byte[] bytes, bool overwrite = false) {
        Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(path))!);
        var temporary = path + "." + Guid.NewGuid().ToString("N") + ".tmp";
        try {
            using (var stream = new FileStream(temporary, FileMode.CreateNew, FileAccess.Write, FileShare.None)) {
                stream.Write(bytes, 0, bytes.Length);
                stream.Flush(true);
            }
            // ReplaceFile briefly removes the destination on Windows. MoveFileEx replaces its directory entry.
            // The native call also supports net48, which has no File.Move(..., overwrite) overload.
            if (overwrite) {
                if (!MoveFileEx(temporary, path, 1)) throw new IOException("Atomic replace failed", new Win32Exception(Marshal.GetLastWin32Error()));
            } else File.Move(temporary, path);
        } finally { if (File.Exists(temporary)) File.Delete(temporary); }
    }
}
