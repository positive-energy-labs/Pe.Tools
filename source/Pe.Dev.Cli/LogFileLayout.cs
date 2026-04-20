namespace Pe.Dev.Cli;

internal static class LogFileLayout {
    private const string StorageDirectoryName = "Pe.App";
    private const string GlobalDirectoryName = "Global";

    public static string GlobalDirectoryPath => Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments),
        StorageDirectoryName,
        GlobalDirectoryName
    );

    public static string HostLogPath => Path.Combine(GlobalDirectoryPath, "host.log.txt");

    public static string RevitAppLogPath => Path.Combine(GlobalDirectoryPath, "revit.log.txt");
}
