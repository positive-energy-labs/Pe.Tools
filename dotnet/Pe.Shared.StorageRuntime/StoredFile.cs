using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using Pe.Shared.Product;
using System.Security.Cryptography;
using System.Text;
using System.Runtime.InteropServices;
using System.ComponentModel;
using Serilog;

namespace Pe.Shared.StorageRuntime;

public enum StoredPolicy { Keep, Discard }

/// <summary>ADR 0039's C# boundary. Notices share the TS store's wire format and notice feed.</summary>
public static class StoredFile {
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool MoveFileEx(string existing, string destination, uint flags);

    public static T? Read<T>(string path, StoredPolicy policy, string place, Func<string, T> decode, string? notices = null) =>
        Read(path, policy, place, decode, out _, notices);

    public static T? Read<T>(string path, StoredPolicy policy, string place, Func<string, T> decode, out bool kept, string? notices = null) {
        kept = false;
        string text;
        try { text = File.ReadAllText(path); }
        catch (FileNotFoundException) { return default; }
        catch (DirectoryNotFoundException) { return default; }
        catch (Exception exception) {
            kept = policy == StoredPolicy.Keep;
            Log.Warning(exception, "Could not read {Place} at {Path}", place, path);
            return default;
        }
        try { return decode(text); }
        catch (Exception exception) {
            kept = policy == StoredPolicy.Keep;
            Refuse(path, policy, place, exception, notices);
            return default;
        }
    }

    public static void Refuse(string path, StoredPolicy policy, string place, Exception exception, string? notices = null) {
        Note(path, policy, place, exception, notices);
        if (policy != StoredPolicy.Discard) return;
        try { File.Delete(path); }
        catch (Exception deletion) { Note(path, policy, place, deletion, notices); }
    }

    public static void Note(string path, StoredPolicy policy, string place, Exception exception, string? notices = null) {
        try {
            path = Path.GetFullPath(path);
            string? hash = null;
            try {
                hash = Hash(File.ReadAllBytes(path));
            } catch (Exception read) when (read is IOException or UnauthorizedAccessException) { }
            NoteOrThrow(path, policy, place, exception.Message, hash, notices);
        } catch (Exception) {
            // The notice feed cannot report its own write failure or stop a stored-file reader (ADR 0039).
        }
    }

    /// <summary>Preserve exact model text and publish its recovery notice before the caller can replace it.</summary>
    public static void KeepModelRecord(string stateRoot, string owner, string document, string raw, string reason) {
        var bytes = new UTF8Encoding(false, true).GetBytes(raw);
        var sha256 = Hash(bytes);
        var path = Path.GetFullPath(Path.Combine(stateRoot, "model-recovery", "owner-" + Uri.EscapeDataString(owner), sha256 + ".txt"));
        if (!File.Exists(path)) {
            try { WriteAtomic(path, bytes); }
            catch (IOException) when (File.Exists(path)) { }
        }
        if (!File.ReadAllBytes(path).SequenceEqual(bytes))
            throw new IOException($"Model recovery file '{path}' does not match the stored record.");
        NoteOrThrow(path, StoredPolicy.Keep, $"{document} / {owner}", reason, sha256, Path.Combine(stateRoot, ProductPathNames.StoredNoticesFileName));
    }

    private static string Hash(byte[] bytes) {
        using var sha = SHA256.Create();
        return BitConverter.ToString(sha.ComputeHash(bytes)).Replace("-", "").ToLowerInvariant();
    }

    private static void NoteOrThrow(string path, StoredPolicy policy, string place, string message, string? hash, string? notices) {
        notices ??= Path.Combine(ProductRuntimeLayout.Current.State.RootPath, ProductPathNames.StoredNoticesFileName);
        notices = Path.GetFullPath(notices);
        var noticeFileKey = Hash(Encoding.UTF8.GetBytes(notices.ToUpperInvariant()));
        using var gate = new Mutex(false, @"Global\Pe.Tools.StoredNotice." + noticeFileKey);
        try {
            if (!gate.WaitOne(TimeSpan.FromSeconds(5)))
                throw new IOException($"Timed out waiting to publish a notice to '{notices}'.");
        } catch (AbandonedMutexException) {
            // The previous writer stopped before releasing the gate. This thread now owns it.
        }

        try {
            var separator = "";
            if (File.Exists(notices)) {
                // Keep sharing the feed with the host's reader and writer. The mutex serializes C# scan-and-append.
                using var stream = new FileStream(notices, FileMode.Open, FileAccess.Read, FileShare.ReadWrite);
                if (stream.Length > 0) {
                    stream.Position = stream.Length - 1;
                    if (stream.ReadByte() != '\n') separator = "\n";
                    stream.Position = 0;
                }
                using var reader = new StreamReader(stream);
                while (reader.ReadLine() is { } line) {
                    try {
                        var row = JObject.Parse(line);
                        if (row.Value<string>("path") == path && row.Value<string>("sha256") == hash) return;
                    } catch (JsonException) { }
                }
            }
            Directory.CreateDirectory(Path.GetDirectoryName(notices)!);
            var reason = System.Text.RegularExpressions.Regex.Replace(message, @"\s+", " ");
            var notice = new { @class = policy == StoredPolicy.Keep ? "keep" : "discard", place, path, sha256 = hash,
                reason = reason.Substring(0, Math.Min(reason.Length, 500)), at = DateTimeOffset.UtcNow.ToString("o") };
            var lineBytes = Encoding.UTF8.GetBytes(separator + JsonConvert.SerializeObject(notice) + "\n");
            using var append = new FileStream(notices, FileMode.Append, FileAccess.Write, FileShare.ReadWrite);
            append.Write(lineBytes, 0, lineBytes.Length);
            append.Flush(true);
        } finally {
            gate.ReleaseMutex();
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
