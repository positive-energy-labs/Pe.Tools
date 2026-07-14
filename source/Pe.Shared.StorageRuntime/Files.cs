using System.Diagnostics;

namespace Pe.Shared.StorageRuntime;

public static class FileUtils {
    public static bool OpenInDefaultApp(string filePath) {
        try {
            if (!File.Exists(filePath) && !Directory.Exists(filePath))
                return false;

            var processStartInfo = new ProcessStartInfo { FileName = filePath, UseShellExecute = true };
            _ = Process.Start(processStartInfo);
            return true;
        } catch {
            return false;
        }
    }
}