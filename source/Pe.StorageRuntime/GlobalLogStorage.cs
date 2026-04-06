namespace Pe.StorageRuntime;

public sealed class GlobalLogStorage(string directoryPath) {
    private const string DateTimeFormat = "yyyy-MM-dd HH:mm:ss";
    private const int MaxLines = 500;

    public string DirectoryPath { get; } = EnsureDirectory(directoryPath);

    public string FilePath => Path.Combine(this.DirectoryPath, "log.txt");

    public void Append(string message) {
        this.Trim();
        var logEntry = $"({DateTime.Now.ToString(DateTimeFormat)}) {message}{Environment.NewLine}{Environment.NewLine}";
        File.AppendAllText(this.FilePath, logEntry);
    }

    private void Trim() {
        if (!File.Exists(this.FilePath))
            return;

        var lines = File.ReadAllLines(this.FilePath);
        if (lines.Length <= MaxLines)
            return;

        File.WriteAllLines(this.FilePath, lines.Skip(lines.Length - MaxLines).ToArray());
    }

    private static string EnsureDirectory(string directoryPath) {
        if (string.IsNullOrWhiteSpace(directoryPath))
            throw new ArgumentException("Directory path is required.", nameof(directoryPath));

        var fullPath = Path.GetFullPath(directoryPath);
        _ = Directory.CreateDirectory(fullPath);
        return fullPath;
    }
}
