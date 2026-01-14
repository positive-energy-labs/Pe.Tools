using Autodesk.Revit.ApplicationServices;

namespace Pe.Global.Utils.Files;

/// <summary>
///     Wrapper for temporary shared parameter files that automatically cleans up on disposal.
///     Use with 'using' statement for automatic file cleanup.
///     Implicitly converts to DefinitionGroup for direct usage.
/// </summary>
public class TempSharedParamFile : IDisposable {
    public TempSharedParamFile(Document doc) {
        this._app = doc.Application;
        this.OriginalFileName = this._app.SharedParametersFilename;

        var tempSharedParamFile = Path.GetTempFileName() + ".txt";
        using (File.Create(tempSharedParamFile)) { } // Create empty file

        this._app.SharedParametersFilename = tempSharedParamFile;

        var tempFile = this._app.OpenSharedParameterFile();
        this.DefinitionFile = tempFile;
        this.TempGroup = tempFile.Groups.get_Item("TempGroup") ?? tempFile.Groups.Create("TempGroup");
        this.TempFileName = tempFile.Filename;
    }

    public DefinitionFile DefinitionFile { get; }
    public DefinitionGroup TempGroup { get; }
    public string TempFileName { get; }
    public string OriginalFileName { get; }
    private Application _app { get; }

    public void Dispose() {
        try {
            // Restore original shared parameters file setting first
            this._app.SharedParametersFilename = this.OriginalFileName;
        } catch {
            Debug.WriteLine("Failed to restore original SharedParametersFilename.");
        }

        try {
            if (!string.IsNullOrWhiteSpace(this.TempFileName) && File.Exists(this.TempFileName))
                File.Delete(this.TempFileName);
        } catch {
            Debug.WriteLine("Failed to delete temporary shared param file.");
        }
    }
}