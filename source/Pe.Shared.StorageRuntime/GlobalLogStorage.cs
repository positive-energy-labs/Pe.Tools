namespace Pe.Shared.StorageRuntime;

public sealed class GlobalLogStorage(string directoryPath) {
    private const int DefaultMaxLines = 3000;
    private const int ProcessLogMaxLines = 2000;
    private const long TrimThresholdBytes = 1_048_576;

    public string DirectoryPath { get; } = EnsureDirectory(directoryPath);

    public string FilePath => this.Log().FilePath;

    public void Append(string message) => this.Log().AppendTimestampedMessage(message);

    public ManagedLogFile Log() => this.CreateManagedLogFile("log.txt", DefaultMaxLines);

    public ManagedLogFile RevitAppLog() => this.CreateManagedLogFile("revit.log.txt", ProcessLogMaxLines);

    private ManagedLogFile CreateManagedLogFile(string fileName, int maxLines) =>
        new(Path.Combine(this.DirectoryPath, fileName), maxLines, TrimThresholdBytes);

    private static string EnsureDirectory(string directoryPath) {
        if (string.IsNullOrWhiteSpace(directoryPath))
            throw new ArgumentException("Directory path is required.", nameof(directoryPath));

        var fullPath = Path.GetFullPath(directoryPath);
        _ = Directory.CreateDirectory(fullPath);
        return fullPath;
    }
}