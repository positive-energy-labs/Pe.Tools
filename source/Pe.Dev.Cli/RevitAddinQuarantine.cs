namespace Pe.Dev.Cli;

internal sealed class RevitAddinQuarantine : IDisposable {
    private readonly List<MoveRecord> _movedPaths = [];
    private readonly string _stashRoot;
    private readonly int _revitYear;
    private bool _initialized;

    private RevitAddinQuarantine(int revitYear, string stashRoot) {
        this._revitYear = revitYear;
        this._stashRoot = stashRoot;
    }

    public static RevitAddinQuarantine CreateForPeApp(int revitYear) {
        var localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        var stashRoot = Path.Combine(
            localAppData,
            "Positive Energy",
            "Pe.Tools",
            "State",
            "revit-test",
            "quarantine",
            revitYear.ToString(),
            Guid.NewGuid().ToString("N")
        );
        return new RevitAddinQuarantine(revitYear, stashRoot);
    }

    public void Initialize() {
        if (this._initialized)
            return;

        Directory.CreateDirectory(this._stashRoot);

        var appData = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
        var addinsRoot = Path.Combine(appData, "Autodesk", "Revit", "Addins", this._revitYear.ToString());

        MoveIfPresent(Path.Combine(addinsRoot, "Pe.App.addin"));

        this._initialized = true;
    }

    public string Describe() {
        if (this._movedPaths.Count == 0)
            return $"quarantine deployed-addin none-found revitYear={this._revitYear}";

        return
            $"quarantine deployed-addin moved={this._movedPaths.Count} revitYear={this._revitYear} stash=\"{this._stashRoot}\"";
    }

    public void Dispose() {
        foreach (var movedPath in Enumerable.Reverse(this._movedPaths)) {
            try {
                if (!File.Exists(movedPath.StashPath) && !Directory.Exists(movedPath.StashPath))
                    continue;

                if (File.Exists(movedPath.OriginalPath) || Directory.Exists(movedPath.OriginalPath)) {
                    Console.Error.WriteLine(
                        $"Restore warning: '{movedPath.OriginalPath}' already exists. Leaving quarantined copy at '{movedPath.StashPath}'."
                    );
                    continue;
                }

                var parentDirectory = Path.GetDirectoryName(movedPath.OriginalPath);
                if (!string.IsNullOrWhiteSpace(parentDirectory))
                    Directory.CreateDirectory(parentDirectory);

                MovePath(movedPath.StashPath, movedPath.OriginalPath);
            } catch (Exception ex) {
                Console.Error.WriteLine(
                    $"Restore warning: failed to restore '{movedPath.OriginalPath}' from '{movedPath.StashPath}': {ex.Message}"
                );
            }
        }

        TryDeleteEmptyDirectory(this._stashRoot);
        var revitYearRoot = Path.GetDirectoryName(this._stashRoot);
        if (!string.IsNullOrWhiteSpace(revitYearRoot))
            TryDeleteEmptyDirectory(revitYearRoot);
    }

    private void MoveIfPresent(string originalPath) {
        if (!File.Exists(originalPath) && !Directory.Exists(originalPath))
            return;

        var stashPath = Path.Combine(this._stashRoot, Path.GetFileName(originalPath));
        MovePath(originalPath, stashPath);
        this._movedPaths.Add(new MoveRecord(originalPath, stashPath));
    }

    private static void MovePath(string sourcePath, string destinationPath) {
        if (File.Exists(sourcePath)) {
            File.Move(sourcePath, destinationPath);
            return;
        }

        if (Directory.Exists(sourcePath)) {
            Directory.Move(sourcePath, destinationPath);
            return;
        }

        throw new FileNotFoundException($"Could not find path '{sourcePath}' to move.");
    }

    private static void TryDeleteEmptyDirectory(string directoryPath) {
        try {
            if (!Directory.Exists(directoryPath))
                return;
            if (Directory.EnumerateFileSystemEntries(directoryPath).Any())
                return;

            Directory.Delete(directoryPath);
        } catch {
            // Best effort cleanup.
        }
    }

    private sealed record MoveRecord(string OriginalPath, string StashPath);
}
