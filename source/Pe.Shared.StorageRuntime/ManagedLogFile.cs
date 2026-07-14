using Microsoft.Win32.SafeHandles;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;

namespace Pe.Shared.StorageRuntime;

public sealed class ManagedLogFile {
    private const uint FileAttributeNormal = 0x00000080;
    private const uint GenericRead = 0x80000000;
    private const uint GenericWrite = 0x40000000;
    private const uint OpenAlways = 4;
    private const uint OpenExisting = 3;
    private const string TimestampFormat = "yyyy-MM-dd HH:mm:ss";
    private readonly int _maxLines;
    private readonly string _mutexName;
    private readonly long _trimThresholdBytes;

    public ManagedLogFile(string filePath, int maxLines, long trimThresholdBytes) {
        if (string.IsNullOrWhiteSpace(filePath))
            throw new ArgumentException("File path is required.", nameof(filePath));
        if (maxLines <= 0)
            throw new ArgumentOutOfRangeException(nameof(maxLines), "Max lines must be greater than zero.");
        if (trimThresholdBytes <= 0) {
            throw new ArgumentOutOfRangeException(
                nameof(trimThresholdBytes),
                "Trim threshold must be greater than zero.");
        }

        this.FilePath = EnsureFileDirectory(filePath);
        this._mutexName = CreateMutexName(this.FilePath);
        this._maxLines = maxLines;
        this._trimThresholdBytes = trimThresholdBytes;
    }

    public string FilePath { get; }

    public void Append(string text) {
        if (string.IsNullOrEmpty(text))
            return;

        // Revit instances intentionally share this log. FileShare prevents ordinary readers from
        // blocking writers; the named mutex also makes trim + append one cross-process operation.
        using var mutex = new Mutex(false, this._mutexName);
        var acquired = false;
        try {
            try {
                acquired = mutex.WaitOne(TimeSpan.FromSeconds(1));
            } catch (AbandonedMutexException) {
                acquired = true;
            }

            if (!acquired)
                return;

            try {
                using var handle = OpenFile(this.FilePath, GenericRead | GenericWrite, OpenAlways);
                // Mixed-version Revit processes may still deny writers with FileShare.Read.
                // CreateFile reports that contention without throwing the IOException Rider breaks on.
                if (handle.IsInvalid)
                    return;

                using var stream = new FileStream(handle, FileAccess.ReadWrite);
                this.TrimIfNeeded(stream);
                stream.Position = stream.Length;
                var bytes = Encoding.UTF8.GetBytes(text);
                stream.Write(bytes, 0, bytes.Length);
            } catch (IOException) { }
        } finally {
            if (acquired)
                mutex.ReleaseMutex();
        }
    }

    public void AppendTimestampedMessage(string message) {
        var logEntry =
            $"({DateTime.Now.ToString(TimestampFormat)}) {message}{Environment.NewLine}{Environment.NewLine}";
        this.Append(logEntry);
    }

    public string[] ReadAllLines() {
        using var handle = OpenFile(this.FilePath, GenericRead, OpenExisting);
        if (handle.IsInvalid)
            return [];

        using var stream = new FileStream(handle, FileAccess.Read);
        using var reader = new StreamReader(stream, Encoding.UTF8, true);
        var lines = new List<string>();
        while (reader.ReadLine() is { } line)
            lines.Add(line);
        return lines.ToArray();
    }

    private void TrimIfNeeded(FileStream stream) {
        if (stream.Length <= this._trimThresholdBytes)
            return;

        using var reader = new StreamReader(stream, Encoding.UTF8, true, 1024, true);
        var lines = new List<string>();
        while (reader.ReadLine() is { } line)
            lines.Add(line);
        if (lines.Count <= this._maxLines)
            return;

        stream.Position = 0;
        stream.SetLength(0);
        using var writer = new StreamWriter(stream, new UTF8Encoding(false), 1024, true);
        foreach (var line in lines.Skip(lines.Count - this._maxLines))
            writer.WriteLine(line);
    }

    private static SafeFileHandle OpenFile(string path, uint access, uint disposition) =>
        CreateFile(
            path,
            access,
            FileShare.ReadWrite | FileShare.Delete,
            IntPtr.Zero,
            disposition,
            FileAttributeNormal,
            IntPtr.Zero
        );

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, EntryPoint = "CreateFileW", SetLastError = true)]
    private static extern SafeFileHandle CreateFile(
        string fileName,
        uint desiredAccess,
        FileShare shareMode,
        IntPtr securityAttributes,
        uint creationDisposition,
        uint flagsAndAttributes,
        IntPtr templateFile
    );

    private static string CreateMutexName(string path) {
        using var sha256 = SHA256.Create();
        var hash = sha256.ComputeHash(Encoding.UTF8.GetBytes(path.ToUpperInvariant()));
        return $"Local\\Pe.ManagedLog.{BitConverter.ToString(hash).Replace("-", string.Empty)}";
    }

    private static string EnsureFileDirectory(string filePath) {
        var fullPath = Path.GetFullPath(filePath);
        var directoryPath = Path.GetDirectoryName(fullPath)
                            ?? throw new InvalidOperationException("Log file directory could not be resolved.");
        _ = Directory.CreateDirectory(directoryPath);
        return fullPath;
    }
}
